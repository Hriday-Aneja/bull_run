// End-to-end browser test (needs Playwright + Chromium; not part of `npm test`). Usage: node tests/e2e.js [outDir]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), os = require('os');
const out = process.argv[2] || os.tmpdir();
const PORT = 3917;
const env = { ...process.env, PORT: String(PORT), DB_PATH: path.join(os.tmpdir(), `bullrun-e2e-${Date.now()}.sqlite`), AI_API_KEY: '' };
(async () => {
  const srv = spawn('node', ['--no-warnings', 'server/index.js'], { env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1360, height: 900 } }); const page = await ctx.newPage(); await page.addInitScript(() => { localStorage.setItem('bullrun.newssync', 'false'); localStorage.setItem('bullrun.sound', 'false'); }); // the test plays at full speed, so do not hold the clock for news
  const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const ok = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
  const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') });
  await page.goto(`http://localhost:${PORT}/`);
  ok((await page.locator('.land').count()) === 1, 'a new visitor lands on the landing page'); ok((await page.locator('.land-stage .talent').count()) === 1, 'landing page shows the live studio preview');
  await page.click('.l-cta [data-act=enter]'); await page.waitForSelector('#uname');
  await page.fill('#uname', 'Asha'); await page.click('[data-act=dur][data-v=quick]'); await page.fill('#uname', 'Asha'); await shot('1-start');
  await page.click('[data-act=start]'); await page.waitForSelector('.hero');
  ok(await page.locator('text=Built-in generator').count() > 0, 'fallback notice shown with no AI key');
  ok((await page.locator('table.tbl tbody tr').count()) >= 5, 'company table has 5+ rows');
  await shot('2-home');
  await page.click('[data-act=tourskip]').catch(() => {});
  await page.click('.nav[data-to=terminal]'); await page.waitForSelector('#pricechart'); await page.waitForTimeout(300);
  const box = await page.locator('#pricechart').boundingBox(); ok(box.height > 200, 'chart rendered');
  ok(!!(await page.locator('.closedbn').count()) && (await page.isDisabled('[data-act=submit]')), 'orders are blocked before the 9:15 AM open');
  ok((await page.textContent('.clk')).includes('8:15 AM'), 'day starts one hour before the open (8:15 AM)');
  await page.click('[data-act=play]'); await page.waitForSelector('#clockbar .mkt.open', { timeout: 20000 }); ok((await page.textContent('.clk')).includes('9:15 AM'), 'Play stops at the 9:15 AM open so you can trade');
  await page.fill('#oqty', '40'); await page.waitForSelector('.receipt .tot'); ok((await page.textContent('.receipt')).includes('Total payable'), 'order preview shows total payable');
  await shot('3-terminal');
  await page.click('[data-act=submit]');
  if (await page.locator('[data-act=confirm]').count()) { ok(true, 'large order asks for confirmation'); await page.click('[data-act=confirm]'); }
  await page.waitForSelector('text=Last trade', { timeout: 5000 }).catch(() => {});
  ok(await page.locator('#ticket >> text=LAST TRADE').count() > 0, 'buy executed and trade summary shown');
  await page.click('[data-act=ind][data-k=ma]'); await page.click('summary:has-text("More indicators")'); for (const k of ['bb', 'rsi', 'macd', 'sr', 'trend']) await page.click(`[data-act=ind][data-k=${k}]`);
  await page.waitForTimeout(200); await shot('4-indicators');
  await page.click('[data-act=learnmode][data-v="1"]'); await page.click('[data-act=guess]'); ok(await page.locator('.ci').count() > 0, 'learning mode reveals explanation after guess');
  // play
  if ((await page.getAttribute('[data-act=play]', 'aria-pressed')) === 'true') await page.click('[data-act=play]'); /* the first trade starts the clock by itself */ await page.click('.ctl .btn.sm[data-act=step]'); await page.waitForTimeout(2500); await page.waitForFunction(() => !document.querySelector('[data-act=step][disabled]'), null, { timeout: 15000 });
  await page.click('.nav[data-to=news]'); await page.waitForSelector('.story'); ok((await page.locator('.story').count()) > 3, 'newsroom shows stories');
  for (const ch of ['flashwire', 'marketline', 'undercurrent', 'dailypulse']) { await page.click(`.chbtn[data-v=${ch}]`); }
  await page.click('.chbtn[data-v=all]'); await shot('5-news');
  await page.click('.nav[data-to=portfolio]'); await page.waitForSelector('#eqchart'); ok((await page.locator('table.tbl').count()) >= 2, 'portfolio tables'); await shot('6-portfolio');
  await page.click('.nav[data-to=learn]'); await page.click('[data-act=learntab][data-v=reviews]'); ok(await page.locator('.rv').count() > 0, 'trade review exists'); await shot('7-learn');
  // refresh keeps the game
  const before = await page.textContent('.clk'); await page.reload(); await page.waitForSelector('.clk'); ok((await page.textContent('.clk')) === before, 'refresh preserves the session');
  // mobile
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(300); await page.click('.nav[data-to=home]'); await shot('8-mobile'); const sw = await page.evaluate(() => document.documentElement.scrollWidth); ok(sw <= 392, 'no horizontal overflow on mobile (' + sw + ')');
  await page.setViewportSize({ width: 1360, height: 900 });
  // finish via autoplay to the end
  await page.click('.nav[data-to=history]'); await page.click('[data-act=endgame]'); await page.click('[data-act=endconfirm]'); await page.waitForSelector('.grade'); ok(true, 'report reached'); await shot('9-report');
  ok((await page.textContent('.grade')).trim().length === 1, 'grade shown');
  // full session through the UI with the Play button, no AI key
  await page.click('.nav[data-to=history]'); await page.click('[data-act=newgame]'); await page.click('[data-act=dur][data-v=quick]'); await page.click('[data-act=start]'); await page.waitForSelector('.hero');
  await page.click('[data-act=speed][data-n="4"]');
  // each day: Play to the open, Play again through the session, then Next day after the close, until the report appears
  const t0 = Date.now(); let sawClose = false;
  while (!(await page.locator('.grade').count()) && Date.now() - t0 < 170000) {
    if (await page.locator('[data-act=nextday]').count()) { sawClose = true; await page.click('[data-act=nextday]'); }
    else if ((await page.locator('[data-act=play]').count()) && (await page.getAttribute('[data-act=play]', 'aria-pressed')) === 'false') await page.click('[data-act=play]');
    await page.waitForTimeout(400);
  }
  ok(sawClose, 'the day ends at 3:30 PM and Next day moves to the next morning');
  await page.waitForSelector('.grade', { timeout: 20000 }); ok(true, 'full session played to the end with Play at 4x');
  ok((await page.textContent('body')).includes('Performance report'), 'final report displayed');
  // IPOs: a standard session plans several; they show on the IPO page with their results once the session is over
  await page.click('.nav[data-to=ipo]'); await page.waitForSelector('.ipo-card', { timeout: 10000 }); ok((await page.locator('.ipo-card').count()) >= 1, 'the IPO page lists the IPOs that came to market'); ok((await page.locator('.ipo-steps li').count()) === 4, 'an IPO shows its four-step timeline');
  // Truth Mode after the session: everything unlocked, the X-ray chart, the ledger and the rival lab with the three bots
  await page.click('.nav[data-to=truth]'); await page.waitForSelector('.tchart', { timeout: 15000 });
  ok((await page.textContent('.tstatus')).includes('everything is unlocked'), 'Truth Mode unlocks everything when the session ends');
  ok((await page.locator('.tled tbody tr').count()) > 3, 'the ledger lists stories with the truth'); ok((await page.locator('.tbot').count()) === 4, 'rival lab shows you and three bots');
  await page.locator('.tmk').first().click(); ok((await page.locator('.tstory .chip').count()) > 0, 'tapping a story marker shows what really happened');
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nno console errors');
  await br.close(); srv.kill(); process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('E2E crashed:', e.message); process.exit(2); });
