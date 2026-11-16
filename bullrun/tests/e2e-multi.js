// Multiplayer + AI anchor browser test. Usage: node tests/e2e-multi.js [outDir]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), os = require('os');
const out = process.argv[2] || os.tmpdir();
const PORT = 3918;
const env = { ...process.env, PORT: String(PORT), DB_PATH: path.join(os.tmpdir(), `bullrun-e2em-${Date.now()}.sqlite`), AI_API_KEY: '', TICK_SCALE: '0.05' };
(async () => {
  const srv = spawn('node', ['--no-warnings', 'server/index.js'], { env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const br = await chromium.launch(); const errors = [];
  const mk = async (name) => { const ctx = await br.newContext({ viewport: { width: 1360, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); }); return p; };
  const ok = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
  const A = await mk('host'), B = await mk('guest');
  await A.goto(`http://localhost:${PORT}/`); await A.click('.l-cta [data-act=enter]'); await A.fill('#uname', 'Asha'); await A.click('[data-act=startmode][data-v=host]'); await A.click('[data-act=dur][data-v=quick]'); await A.click('[data-act=startspeed][data-v=fast]'); await A.click('[data-act=roomcreate]');
  await A.waitForSelector('.lobby .code'); const code = (await A.textContent('.lobby .code')).trim(); ok(/^[A-Z0-9]{5}$/.test(code), 'room code shown: ' + code);
  await A.screenshot({ path: path.join(out, 'm1-lobby.png') });
  // guest joins through the invite link
  await B.goto(`http://localhost:${PORT}/?room=${code}`); ok((await B.inputValue('#codein')) === code, 'invite link prefills the code');
  await B.fill('#uname', 'Ravi'); await B.click('[data-act=roomjoin]'); await B.waitForSelector('.lobby .code');
  await A.waitForFunction(() => document.querySelectorAll('.lobby .who .chip').length === 2, null, { timeout: 8000 }); ok(true, 'host sees the guest join the lobby');
  ok((await B.locator('[data-act=rctl][data-v=start]').count()) === 0, 'guest has no start button');
  // nobody can trade before the 9:15 AM open, even in the lobby; the host starts and the shared clock reaches the open
  await B.click('.nav[data-to=terminal]'); await B.fill('#oqty', '10'); ok((await B.locator('.closedbn').count()) > 0 && (await B.isDisabled('[data-act=submit]')), 'orders are blocked in the lobby');
  await A.click('[data-act=rctl][data-v=start]');
  await B.waitForFunction(() => /Day \d/.test(document.querySelector('.clk .dayno')?.textContent || ''), null, { timeout: 15000 }); ok(true, 'market started for the guest through the shared clock');
  await B.waitForSelector('#clockbar .mkt.open', { timeout: 30000 }); await B.fill('#oqty', '10'); await B.waitForSelector('.receipt .tot'); await B.click('[data-act=submit]'); if (await B.locator('[data-act=confirm]').count()) await B.click('[data-act=confirm]');
  await B.waitForSelector('#ticket >> text=LAST TRADE', { timeout: 8000 }); ok(true, 'guest traded once the room reached 9:15 AM');
  // leaderboard both sides
  await A.click('.nav[data-to=board]'); await A.waitForSelector('table.tbl'); ok((await A.locator('table.tbl tbody tr').count()) === 2, 'leaderboard lists both players');
  await A.click('[data-act=boardtab][data-v=risk]'); await A.waitForSelector('#boardchart', { timeout: 15000 }); await A.screenshot({ path: path.join(out, 'm2-board.png') });
  const hostBody = await A.textContent('body'); ok(!hostBody.includes('holdings of Ravi'), 'no peeking at other holdings');
  // live studio
  await B.click('.nav[data-to=news]'); await B.waitForSelector('#live .stage'); ok((await B.locator('.chbtn').count()) === 5, 'channel picker shows all channels plus the live mix');
  await B.waitForTimeout(900); ok((await B.locator('.stage .onair', { hasText: 'LIVE' }).count()) === 1, 'studio is on air'); await B.screenshot({ path: path.join(out, 'm4-studio.png') });
  // mobile overflow
  await B.setViewportSize({ width: 390, height: 800 }); await B.waitForTimeout(300); const sw = await B.evaluate(() => document.documentElement.scrollWidth); ok(sw <= 392, 'studio fits on mobile (' + sw + ')'); await B.screenshot({ path: path.join(out, 'm5-studio-mobile.png') });
  await B.setViewportSize({ width: 1360, height: 900 });
  // room completes for both
  await A.waitForSelector('.grade', { timeout: 120000 }); await B.waitForSelector('.grade', { timeout: 30000 }); ok(true, 'both players reach their report when the room ends');
  ok((await A.textContent('body')).includes('Final standings'), 'standings shown in the report'); await A.screenshot({ path: path.join(out, 'm6-report.png') });
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nno console errors');
  await br.close(); srv.kill(); process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('E2E crashed:', e.message); process.exit(2); });
