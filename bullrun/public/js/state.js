// Single client-side store. The server is the source of truth; this only caches the latest view and UI preferences.
const pref = (k, d) => { try { const v = localStorage.getItem('bullrun.' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } };
export const save = (k, v) => { try { localStorage.setItem('bullrun.' + k, JSON.stringify(v)); } catch (_) { /* private mode */ } };
export const S = {
  user: null, health: null, view: null, sessions: [], route: 'home', selected: null, modal: null, busy: false, playing: false, speed: pref('speed', 1),
  alert: null, netError: null, loadingMsg: null, preview: null, previewErr: null, lastTrade: null, explain: {}, learnTab: 'situations', newsChannel: 'all', newsCompany: '', newsLimit: 40,
  ticket: { side: 'buy', type: 'market', qty: '', limit: '', stop: '', key: null },
  chart: { type: pref('ctype', 'candle'), range: pref('crange', 60), ind: pref('cind', { vol: true, ma: false, bb: false, rsi: false, macd: false, sr: false, trend: false }), learn: pref('clearn', false), guess: {} },
  open: {}, tour: pref('tour', null), tourStep: 0, seenNews: pref('seenNews', {}),
  boardTab: 'return', startSpeed: 'normal', landing: true, startMode: 'solo', startBots: 3, startRoomBots: 0, ipoSel: null, ipoLots: 0, noticeSession: null, seenN: new Set(), truth: null, truthConfirm: false, truthBusy: false, truthKey: '', truthCo: null, truthStory: null, truthBots: true, truthMine: true, truthLimit: 30, startCode: '', offline: 0, doneNotified: {},
  studio: { sound: pref('sound', true), sync: pref('newssync', true), look: pref('look', 'photo'), voice: pref('voice', 'ai') }, live: null,
};
export const co = (id) => S.view && S.view.companies.find((c) => c.id === id);
export const coByTicker = (t) => S.view && S.view.companies.find((c) => c.ticker === t);
export const CHANNELS = () => (S.health && S.health.channels) || {};
export const chOrder = ['flashwire', 'marketline', 'undercurrent', 'dailypulse'];
export const chColor = (id) => ({ flashwire: '#D93035', marketline: '#1F6FD1', undercurrent: '#7B4FC9', dailypulse: '#C47F00' }[id] || '#565D6A');
export const chName = (id) => (CHANNELS()[id] && CHANNELS()[id].name) || id.toUpperCase();
