// Virtual news presenters. Each channel has a fictional AI anchor drawn as a vector portrait with a studio backdrop, blinking,
// lip-sync while "speaking", a teleprompter and optional text-to-speech. To use your own AI-generated photos instead, drop
// flashwire.png / marketline.png / undercurrent.png / dailypulse.png into public/img/anchors/ and they replace the drawings.
import { esc } from './util.js';
import { lip } from './lipsync.js';
import { stopNeural } from './neural.js';

export const ANCHORS = {
  flashwire: { name: 'Jax Rourke', role: 'Lead anchor', intro: 'Good evening, I am Jax Rourke and this is FLASHWIRE. We go where the story goes, and we go first.', wps: 3.6, voice: { pitch: 0.8, rate: 1.12, hint: ['male', 'david', 'daniel', 'alex', 'google uk english male'] } },
  marketline: { name: 'Meera Kapoor', role: 'Markets editor', intro: 'Good evening, I am Meera Kapoor. This is MARKETLINE, where we confirm the facts before we report them.', wps: 2.5, voice: { pitch: 1.05, rate: 0.96, hint: ['female', 'zira', 'samantha', 'google uk english female', 'veena', 'heera'] } },
  undercurrent: { name: 'Nadia Voss', role: 'Investigations', intro: 'I am Nadia Voss. This is THE UNDERCURRENT, and the story is rarely the one they told you.', wps: 2.1, voice: { pitch: 0.92, rate: 0.9, hint: ['female', 'karen', 'moira', 'tessa', 'google uk english female'] } },
  dailypulse: { name: 'Sunny and Tara', role: 'Morning hosts', intro: 'Hi everyone, I am Sunny. And I am Tara. Welcome to DAILY PULSE, your day in a minute.', wps: 3.0, voice: { pitch: 1.2, rate: 1.05, hint: ['female', 'samantha', 'zira', 'google us english'] } },
};

const BACKDROPS = {
  flashwire: { a: '#3a0f16', b: '#12060a', glow: '#ff4d4f', extra: `<g opacity=".5"><path d="M-10 40 L70 -10 L100 -10 L10 60Z" fill="#ff4d4f" opacity=".35"/><path d="M130 250 L210 190 L210 250Z" fill="#ff4d4f" opacity=".3"/><rect x="0" y="206" width="200" height="4" fill="#ff4d4f"/></g>` },
  marketline: { a: '#0f2a52', b: '#071226', glow: '#4da3ff', extra: `<g opacity=".55" stroke="#4da3ff" fill="none" stroke-width="1"><path d="M0 60 L200 60M0 100 L200 100M0 140 L200 140" opacity=".25"/><path d="M8 118 L34 96 L52 108 L80 70 L104 84 L130 50 L158 62 L190 30" stroke-width="1.6" opacity=".7"/></g>` },
  undercurrent: { a: '#26123f', b: '#0a0614', glow: '#b07cff', extra: `<g opacity=".4" fill="#b07cff"><rect x="12" y="0" width="10" height="240" opacity=".35"/><rect x="40" y="0" width="10" height="240" opacity=".25"/><rect x="150" y="0" width="10" height="240" opacity=".25"/><rect x="178" y="0" width="10" height="240" opacity=".35"/></g><circle cx="168" cy="48" r="30" fill="#b07cff" opacity=".18"/>` },
  dailypulse: { a: '#5a3b0c', b: '#2a1a05', glow: '#ffb020', extra: `<g opacity=".6"><rect x="12" y="22" width="52" height="64" rx="4" fill="#ffd27a" opacity=".35"/><path d="M38 22 V86 M12 54 H64" stroke="#2a1a05" stroke-width="2" opacity=".5"/><circle cx="172" cy="196" r="22" fill="#6fb26a" opacity=".5"/><circle cx="154" cy="206" r="14" fill="#8fd18a" opacity=".5"/></g>` },
};

// One person, centred at x=100 in a 200 x 240 box. All colours are parameters so each anchor looks different.
function person(o, cx = 100, top = 0, s = 1) {
  const { skin, shade, hair, suit, suitDark, shirt, tie, eye = '#2a1a12', lip = '#b4565a', brow, glasses, style, collar, ear } = o;
  const tr = `translate(${cx - 100 * s} ${top}) scale(${s})`;
  const back = {
    bob: `<path d="M56 106 C50 58 80 40 100 40 C124 40 150 58 144 106 L150 168 C132 180 68 180 50 168 Z" fill="${hair}"/>`,
    curly: `<g fill="${hair}"><circle cx="62" cy="82" r="22"/><circle cx="80" cy="56" r="24"/><circle cx="104" cy="50" r="25"/><circle cx="128" cy="58" r="24"/><circle cx="142" cy="84" r="22"/><circle cx="54" cy="112" r="16"/><circle cx="146" cy="112" r="16"/></g>`,
    pixie: `<path d="M58 98 C54 58 80 42 104 44 C130 46 148 66 142 100 C136 78 118 66 98 68 C80 70 64 82 58 98Z" fill="${hair}"/>`,
  }[style] || '';
  const front = {
    quiff: `<path d="M60 96 C56 62 74 44 100 44 C114 40 136 44 141 66 C146 78 142 90 140 98 C136 80 126 70 104 66 C84 64 68 76 60 96Z" fill="${hair}"/>`,
    short: `<path d="M60 96 C56 60 78 44 102 44 C128 44 146 62 140 98 C136 80 122 68 100 68 C80 68 64 80 60 96Z" fill="${hair}"/>`,
    bob: `<path d="M58 100 C64 66 96 54 124 62 C140 68 144 86 142 102 C130 80 108 74 82 78 C70 80 62 90 58 100Z" fill="${hair}"/>`,
    pixie: `<path d="M55 104 C52 64 82 42 114 46 C142 50 152 80 142 108 C140 92 132 80 120 74 C110 70 100 74 94 82 C86 92 70 92 55 104Z" fill="${hair}"/><path d="M94 82 C104 70 124 72 134 88" stroke="${hair}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
    curly: `<path d="M64 88 C70 66 90 58 112 62 C128 66 138 76 138 90 C124 76 104 72 84 76 C74 78 68 82 64 88Z" fill="${hair}"/>`,
  }[style] || '';
  const body = `<path d="M18 244 C18 198 52 180 100 180 C148 180 182 198 182 244Z" fill="${suit}"/>` +
    (collar === 'turtle' ? `<path d="M70 176 C72 156 128 156 130 176 C124 196 76 196 70 176Z" fill="${shirt}"/>` : `<path d="M76 181 L100 222 L124 181 Z" fill="${shirt}"/>`) +
    `<path d="M76 181 L52 244 L88 244 L100 222Z M124 181 L148 244 L112 244 L100 222Z" fill="${suitDark}"/>` +
    (tie ? `<path d="M94 190 L106 190 L110 238 L100 246 L90 238Z" fill="${tie}"/><path d="M96 184 L104 184 L106 192 L94 192Z" fill="${tie}"/>` : '') +
    `<rect x="132" y="204" width="5" height="9" rx="2" fill="#0b0b10"/><path d="M134 204 C134 190 126 186 118 186" stroke="#0b0b10" stroke-width="1" fill="none"/>`;
  const neck = `<path d="M86 148 h28 v36 q-14 10 -28 0z" fill="${shade}"/>`;
  const head = `<ellipse cx="62" cy="108" rx="6" ry="10" fill="${skin}"/><ellipse cx="138" cy="108" rx="6" ry="10" fill="${skin}"/><ellipse cx="100" cy="104" rx="39" ry="47" fill="${skin}"/>` +
    `<path d="M70 130 C80 152 120 152 130 130 C124 142 112 150 100 150 C88 150 76 142 70 130Z" fill="${shade}" opacity=".35"/>` +
    (ear ? `<circle cx="61" cy="118" r="2.6" fill="${ear}"/><circle cx="139" cy="118" r="2.6" fill="${ear}"/>` : '');
  const eyeSvg = (x) => `<g class="eye"><ellipse cx="${x}" cy="104" rx="6.4" ry="4" fill="#fff"/><circle cx="${x}" cy="104.3" r="3" fill="${eye}"/><circle cx="${x + 0.9}" cy="103.3" r=".9" fill="#fff"/></g>`;
  const face = eyeSvg(84) + eyeSvg(116) +
    `<path class="brows" d="M74 94 C80 89 88 89 94 92 M106 92 C112 89 120 89 126 94" stroke="${brow}" stroke-width="3.2" stroke-linecap="round" fill="none"/>` +
    `<path d="M100 108 C98 116 96 120 100 122 C103 122 104 121 102 118" stroke="${shade}" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="74" cy="122" rx="7" ry="4" fill="#ff7a6a" opacity=".13"/><ellipse cx="126" cy="122" rx="7" ry="4" fill="#ff7a6a" opacity=".13"/>` +
    `<path d="M89 133 C94 131 98 132 100 133 C102 132 106 131 111 133 C108 139 92 139 89 133Z" fill="${lip}" opacity=".95"/>` +
    `<path d="M91 133.6 Q100 136.4 109 133.6" stroke="#4a1418" stroke-width="1" fill="none" opacity=".45"/>` +
    `<ellipse class="mouth" cx="100" cy="134.6" rx="6.6" ry="1.5" fill="#3a0f13"/>` +
    (glasses ? `<g fill="none" stroke="${glasses}" stroke-width="2"><rect x="70" y="95" width="28" height="19" rx="7"/><rect x="102" y="95" width="28" height="19" rx="7"/><path d="M98 103 H102"/></g>` : '');
  return `<g transform="${tr}">${back}${body}${neck}<g class="head">${head}${face}${front}</g></g>`;
}
const LOOKS = {
  flashwire: { skin: '#dba983', shade: '#b98462', hair: '#1c1512', brow: '#1c1512', suit: '#252c3d', suitDark: '#151a27', shirt: '#f3f4f7', tie: '#e0363b', style: 'quiff', lip: '#a85b55' },
  marketline: { skin: '#c68a63', shade: '#a2694a', hair: '#15100e', brow: '#15100e', suit: '#1f4a8c', suitDark: '#163663', shirt: '#dbe9ff', style: 'bob', glasses: '#2a2f3a', ear: '#f4f1ea', lip: '#a34a58' },
  undercurrent: { skin: '#f0d1bb', shade: '#d3ad94', hair: '#2b1a4a', brow: '#241438', suit: '#3a2766', suitDark: '#221544', shirt: '#14101f', collar: 'turtle', style: 'pixie', eye: '#2a3a52', lip: '#7b2e5c' },
};
function artFor(ch) {
  if (ch === 'dailypulse') {
    const sunny = { skin: '#8d5a3b', shade: '#6e442b', hair: '#17110d', brow: '#17110d', suit: '#c98a1b', suitDark: '#a26d10', shirt: '#fbf3e0', style: 'short', lip: '#9a4a45' };
    const tara = { skin: '#b07a55', shade: '#8d5d3e', hair: '#241410', brow: '#241410', suit: '#e0674f', suitDark: '#b8503b', shirt: '#fff0e4', style: 'curly', ear: '#ffe08a', lip: '#b33a52' };
    return person(sunny, 62, 24, 0.8) + person(tara, 140, 20, 0.84);
  }
  return person(LOOKS[ch], 100, 0, 1);
}
let custom = {}, videos = {};
let usePhotos = true;
export const setCustomAnchors = (m) => { custom = {}; videos = {}; for (const [k, v] of Object.entries(m || {})) { if (k.endsWith(':video')) videos[k.slice(0, -6)] = v; else custom[k] = v; } };
export const setAnchorLook = (photo) => { usePhotos = !!photo; };
export const hasPhotos = () => Object.keys(custom).length > 0 || Object.keys(videos).length > 0;
const videoOf = (ch) => (usePhotos ? videos[ch] : null);
const photoOf = (ch) => (usePhotos ? custom[ch] : null);

export function art(ch, { crop = false } = {}) {
  const b = BACKDROPS[ch]; const vb = crop ? '36 26 128 128' : '0 0 200 240';
  return `<svg class="anchor-art" viewBox="${vb}" role="img" aria-label="${esc((ANCHORS[ch] || {}).name || ch)}, virtual anchor" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="bg-${ch}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.a}"/><stop offset="1" stop-color="${b.b}"/></linearGradient><radialGradient id="gl-${ch}" cx=".5" cy=".38" r=".6"><stop offset="0" stop-color="${b.glow}" stop-opacity=".42"/><stop offset="1" stop-color="${b.glow}" stop-opacity="0"/></radialGradient></defs>
    <rect width="200" height="240" fill="url(#bg-${ch})"/><rect width="200" height="240" fill="url(#gl-${ch})"/>${b.extra}${artFor(ch)}</svg>`;
}
// Full portrait (studio) or a round face thumbnail (story headers).
export function portrait(ch, { speaking = false, crop = false } = {}) {
  const a = ANCHORS[ch] || { name: ch };
  const inner = photoOf(ch) ? `<img class="anchor-img" src="${esc(photoOf(ch))}" alt="${esc(a.name)}, virtual anchor">` : art(ch, { crop });
  return `<div class="anchor ${crop ? 'face' : ''} ${speaking ? 'speaking' : ''}" data-anchor="${ch}">${inner}</div>`;
}

// ---- speech -----------------------------------------------------------------------------------------------------------------
// Design notes (the old engine spoke one sentence at a time and waited for each to finish, which caused the pauses and stalls):
//  - every sentence of a story is queued with the browser at once, so there is no round trip between sentences
//  - utterances are kept in a list so the browser cannot garbage-collect them mid-speech (a known Chrome bug that drops "end" events)
//  - sentences are short (see chunksOf), which also avoids the 15 second cut-off on online voices
//  - a watchdog notices a voice that never starts, or stops reporting, and moves on instead of freezing the channel
//  - voices are ranked: natural / neural voices first, novelty voices never, and each anchor gets a different voice when possible
let voices = [];
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const FEMALE = /\b(female|zira|samantha|aria|jenny|sonia|libby|neerja|heera|veena|karen|moira|tessa|susan|hazel|catherine|fiona|victoria|kalpana|ava|allison|emma|michelle|natasha|clara|swara|raveena|lekha)\b/i;
const MALE = /\b(male|david|daniel|alex|guy|ryan|mark|george|james|ravi|prabhat|rishi|thomas|oliver|arthur|aaron|christopher|eric|roger|steffan|brian|liam|hemant|madhur)\b/i;
const NOVELTY = /(compact|eloquence|novelty|whisper|bad news|good news|bells|boing|cellos|trinoids|zarvox|organ|albert|junior|kathy|ralph|fred|bubbles|superstar|jester|hysterical|deranged|pipe)/i;
const genderOf = (v) => (FEMALE.test(v.name) ? 'f' : MALE.test(v.name) ? 'm' : 'u');
const quality = (v) => {
  const n = v.name.toLowerCase(); let q = 0;
  if (/natural|neural|online/.test(n)) q += 60; if (v.localService) q += 10; if (/google/.test(n)) q += 15;
  if (/en-in/i.test(v.lang)) q += 12; else if (/en-(gb|us|au)/i.test(v.lang)) q += 6; if (NOVELTY.test(n)) q -= 200; return q;
};
// Which kind of voice each presenter wants. Order matters: earlier presenters choose first.
const SLOTS = [['marketline', 'f'], ['flashwire', 'm'], ['undercurrent', 'f'], ['tara', 'f'], ['sunny', 'm'], ['announcer', 'm']];
let assigned = {};
function assignVoices() {
  assigned = {}; const english = voices.filter((v) => /^en/i.test(v.lang) && !NOVELTY.test(v.name)).sort((a, b) => quality(b) - quality(a)); if (!english.length) return;
  const used = new Set();
  for (const [key, g] of SLOTS) {
    const pick = english.find((v) => !used.has(v) && (genderOf(v) === g)) || english.find((v) => !used.has(v) && genderOf(v) === 'u') || english.find((v) => genderOf(v) === g) || english[0];
    assigned[key] = pick; used.add(pick);
  }
}
if (synth) { const load = () => { voices = synth.getVoices() || []; assignVoices(); }; load(); if (synth.addEventListener) synth.addEventListener('voiceschanged', load); }
export const canSpeak = () => !!synth && typeof SpeechSynthesisUtterance !== 'undefined';
export const voiceName = (key) => (assigned[key] ? assigned[key].name : null);

let speakToken = 0, watchdog = null, keep = [];
const killWatch = () => { clearInterval(watchdog); watchdog = null; };
// Speaks planned chunks (see planItem in broadcast.js). Handlers:
//   h.onChunk(i, chunk)  a sentence started        h.onWord(charIndexInAll, precise)  word boundary, when the voice reports one
//   h.onEnd()            everything was spoken     h.onFail(reason)                   'not-allowed' (needs a tap) or 'stalled'
export function speakChunks(chunks, h = {}) {
  if (!canSpeak() || !chunks.length) return false;
  const token = ++speakToken; killWatch(); keep = [];
  try { synth.cancel(); if (synth.paused) synth.resume(); } catch (_) { /* ignore */ }
  let started = false, done = 0, finished = false, last = Date.now(); const t0 = Date.now();
  const finish = () => { if (finished || token !== speakToken) return; finished = true; killWatch(); keep = []; if (h.onEnd) h.onEnd(); };
  setTimeout(() => { // a short wait after cancel() makes the first sentence reliable in Chrome
    if (token !== speakToken) return;
    try {
      chunks.forEach((c, i) => {
        const u = new SpeechSynthesisUtterance(c.say); const v = assigned[c.key] || assigned[c.who] || null; if (v) { u.voice = v; u.lang = v.lang; }
        u.rate = c.rate; u.pitch = c.pitch; u.volume = 1;
        u.onstart = () => { if (token !== speakToken) return; started = true; last = Date.now(); lip.chunkStart(c); if (h.onChunk) h.onChunk(i, c); };
        u.onboundary = (e) => { if (token !== speakToken || e.name !== 'word') return; last = Date.now(); lip.word(c, e.charIndex); if (h.onWord) h.onWord(c.off + e.charIndex, true); };
        u.onend = () => { if (token !== speakToken) return; last = Date.now(); done++; lip.chunkEnd(c); if (done >= chunks.length) finish(); };
        u.onerror = (e) => {
          if (token !== speakToken || e.error === 'canceled' || e.error === 'interrupted') return;
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { speakToken++; killWatch(); if (h.onFail) h.onFail('not-allowed'); return; }
          done++; if (done >= chunks.length) finish();
        };
        keep.push(u); synth.speak(u);
      });
    } catch (_) { if (h.onFail) h.onFail('stalled'); return; }
    watchdog = setInterval(() => {
      if (token !== speakToken) return killWatch(); const now = Date.now();
      if (started && !synth.speaking && !synth.pending && now - last > 1500) return finish(); // finished without telling us
      if (!started && now - t0 > 4500) { speakToken++; killWatch(); try { synth.cancel(); } catch (_) { /* ignore */ } if (h.onFail) h.onFail('stalled'); return; } // the voice never began
      if (started && now - last > 12000) { speakToken++; killWatch(); try { synth.cancel(); } catch (_) { /* ignore */ } if (h.onFail) h.onFail('stalled'); } // the voice froze mid-story
    }, 500);
  }, 45);
  return true;
}
export const stopSpeaking = () => { speakToken++; killWatch(); keep = []; stopNeural(); lip.stop(); try { if (synth) synth.cancel(); } catch (_) { /* ignore */ } };
// What the anchor actually says: headline, then the script without the "Name:" label or quote marks.
export function scriptOf(n) { return `${n.headline.replace(/\s+/g, ' ')}. ${n.body.replace(/^[^:"]{2,24}:\s*/, '').replace(/\b(Sunny|Tara):\s*/g, '').replace(/["“”]/g, '')}`; }

// Full-height illustrated anchor with a transparent background, for the live studio set (the desk and wall are drawn around it).
export function figure(ch, { speaking = false } = {}) {
  const a = ANCHORS[ch] || { name: ch };
  // A looping, muted video of a realistic presenter (public/img/anchors/<channel>.mp4 or .webm) plays only while the anchor is speaking.
  const inner = videoOf(ch) ? `<video class="figure-img figure-video" src="${esc(videoOf(ch))}" loop muted playsinline preload="auto"${speaking ? ' autoplay' : ''} aria-label="${esc(a.name)}, AI-generated anchor"></video>`
    : photoOf(ch) ? `<img class="figure-img" src="${esc(photoOf(ch))}" alt="${esc(a.name)}, AI-generated anchor">`
    : `<svg class="figure-art" viewBox="0 0 200 240" role="img" aria-label="${esc(a.name)}, virtual anchor" preserveAspectRatio="xMidYMax meet">${artFor(ch)}</svg>`;
  const real = videoOf(ch) || photoOf(ch);
  return `<div class="talent${real ? ' photo' : ''}${speaking ? ' speaking' : ''}" data-anchor="${ch}">${inner}</div>`;
}
