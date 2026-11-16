# BullRun

A stock market simulation game for people who have never traded. Every new game builds a fictional market: 5 to 10 invented companies, an economic scenario, four news channels that do not always tell the truth, and ₹1,00,000 of virtual money. You read the news, study charts, trade, and get a review of how you *decided*, not only how you *did*.

You can play alone or **race your friends in the same market** (multiplayer rooms), and each news channel is read by its own **AI anchor**, an animated virtual presenter.

Everything is fictional. No real money, no real companies, no real brokerage, and nothing here is investment advice.

## Quick start

You need **Node.js 22.13 or newer** (https://nodejs.org). There is nothing else to install: the project has **zero npm dependencies**.

```bash
cd bullrun
npm start
```

Open http://localhost:3000, type a name, pick a session length and press **Start a solo market**, or use **Play with friends** (see below).

No Docker, no database server and no API key are needed. The database is a single SQLite file created at `data/bullrun.sqlite` on first run.

## Running without an AI key (the default)

Leave `AI_API_KEY` empty (or do not create a `.env` at all). The built-in generator then creates the market name, scenario, companies, descriptions, news and explanations from a large library of seeded components. A small "Built-in generator" label appears in the top bar. The game is identical to play. You can even run it offline.

## Optional: AI-written scenario text

```bash
cp .env.example .env     # then set AI_API_KEY
npm start
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Web server port |
| `DB_PATH` | `data/bullrun.sqlite` | SQLite file |
| `AI_API_KEY` | empty | Enables AI text. Server side only; never sent to the browser |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` (OpenAI-compatible) |
| `AI_MODEL` | `claude-sonnet-4-6` | Model name for your provider |
| `AI_BASE_URL` | provider default | Override, e.g. a local OpenAI-compatible server |
| `AI_TIMEOUT_MS` | `8000` | Give up after this long and fall back |

The AI may only change **words**: scenario title and bullets, company names and descriptions, and optional "explain this another way" text. Every response is parsed and validated against a strict schema (names, lengths, duplicates, forbidden characters). On a timeout, rate limit, network error, malformed JSON or failed validation, the server logs the technical error to `logs/app.log`, shows the player a friendly one-line notice, and uses the built-in generator. Prices, orders, portfolios, news timing and game progress never call any AI service.

## How to play

1. **Market Home** shows your money, the market, today's scenario and suggested next steps.
2. Press **Play** (or the step button) to move time. One tick is one trading hour; a day is 7 ticks. Play pauses itself when a fill happens or breaking news hits a company you own.
3. **Newsroom**: FLASHWIRE is fast and sometimes exaggerates or runs unverified reports. MARKETLINE verifies first, so it is accurate but late. THE UNDERCURRENT surfaces rumours and hidden problems, and sometimes misreads them. DAILY PULSE covers everyday life, with occasional indirect links to companies. Stories that were later contradicted are marked as disputed.
4. **Trading Terminal**: charts (candles or line, volume, moving averages, plus Bollinger Bands, RSI, MACD, support and resistance, trendline), **Chart Intelligence** (explains the chart without telling you to buy or sell), an optional **learning mode** (guess the pattern first), and an order ticket that shows the full cost before you commit. Market, limit and stop-loss orders are supported; large orders ask for confirmation.
5. **Decision Intelligence** explains big moves as they happen and reviews every trade. A review scores your *process* (verification, position size, concentration, chasing price spikes, panic selling, overtrading, liquidity) separately from the *outcome*, so a sound decision with bad luck is still rewarded and a lucky bad decision is flagged.
6. At the end you get a **performance report**: skill grade, return against the market index, risk, costs and what stood out.

Session lengths: Quick (10 trading days), Standard (20), Extended (40). Use the seed field to replay an exact market.

## BullRun Live (24/7 newsroom)

A TV-style studio that never stops: an illustrated AI anchor behind a desk, an LED wall with live price tiles, lower-third headlines, rolling captions and a headline ticker. Stories are read out loud the moment they land (breaking news interrupts), and between stories the channel carries on with market wraps, sector watch, economy desk, tips, portfolio checks and recaps built from live game data. Speech is on by default and keeps going on every page (the rail has a small on-air player with a mute button). If the browser blocks audio before the first tap, a "Tap to hear the anchors" button appears. Everything that has aired collects in **Previously**; tap an item to replay it. Logic is in `public/js/live.js`; the anchors are the built-in illustrated characters in `public/js/anchors.js`.

## News and prices

Prices react to news in the engine (`server/engine.js`): when a story is published, traders start to believe it straight away, and the real effect on the company arrives a few ticks later. Rumours move the price too, but if they are false the move fades or reverses after a denial. In the studio, tiles show how a company has moved *since the story*, and a "Market reaction" segment follows important stories a couple of ticks later. By default the market clock waits (up to 10 seconds per tick) until a new story has been read on air, so you hear news before prices react. Switch this off with "Market waits for news".

## Realistic anchors

See `ANCHOR_PHOTOS.md` for how to use realistic AI-generated presenters instead of the illustrated ones.

## Landing page and start flow

A new visit opens on a landing page (hero with a live studio preview, how it works, the four channels, market hours, learning features, solo vs friends, FAQ). Press **Start playing** to reach the name and mode screen: enter a name, choose **Solo**, **Host a room** or **Join a room**, then set the session length. Refreshing in the middle of a game resumes it; opening the site in a new tab or visit goes back to the landing page, with a "Continue" button if you have a game in progress. Invite links (`/?room=CODE`) skip the landing page and open the join screen. The page is `landing()` in `public/js/views.js`.

## IPOs

A few times per game (1 in a quick session, about 3 in a standard one, about 5 in an extended one) a new company comes to market. An achievement-style popup ("New IPO", with a **See** button) appears on whatever page you are on; **IPOs** in the menu has the full page.

- **Bid** (9:15 AM to 3:30 PM on the IPO day): choose 1 to 10 lots. The money is deducted from your cash immediately (it still counts in net worth).
- **Lucky draw** (at the close): if demand is higher than the shares on offer, a draw decides who is allotted; the hotter the IPO, the lower the odds, and bidding for more lots does not improve your chance. You get a "Congratulations, you got the IPO" or "Sorry, you didn't get the IPO" popup.
- **Refund and listing** (next morning, 9:15 AM): refunds are credited, allotted shares arrive, and the company joins the company list (it is not part of the market index) at its listing price.
- **Outcomes:** about 85% of IPOs list above the issue price (about 15% on average, sometimes 30% or more) and about 14% list lower. Hype fades over the following days toward the company's real value. Weak IPOs show warning signs beforehand (a high P/E, heavy debt, weak balance sheet); a grey-market-premium hint is shown but can be wrong, and the live demand figure rises until the close.
- **Bots** take part with their own styles. Code: `server/ipo.js` (lifecycle), `planIpos()` in `server/generator.js` (hidden quality and listing gain, from a separate seed stream so existing seeds are unchanged), `ipo()` and `achvHtml()` in `public/js/views.js`.

## Bots and Truth Mode

**Bots.** Computer players trade in the same market, by the same rules (market hours, fees, slippage). They see only what a human sees, and their decisions are deterministic for a given seed. Six styles: *Headline Hari* (hears the news and bids at once, trusts every channel), *Careful Kavya* (acts only on verified Marketline reports, waits an hour, uses stop-losses), *Coin-Flip Chintu* (random), *Trend Tanmay* (follows the chart, ignores news), *Value Vihaan* (buys healthy, fairly priced companies and holds), *Panic Pooja* (buys good news, sells at the first drop). Choose 0, 3 or 6 on the solo start screen, or 0, 2 or 4 when hosting a room. Their results appear on the leaderboard; their trades stay hidden until Truth Mode reveals them. Code: `server/bots.js`.

**Truth Mode.** Because BullRun invents the market, it knows why every price moved. Truth Mode (nav item) shows, per company, the price, the *real value* and what the market *believed*, with the gap between them shaded; every story marked true, false rumour, overstated, wrong-way, correction or noise; how the price moved after each story; your trades and the bots' trades with reasons; channel track records and plain-English lessons. To stop the truth being used to trade, a day unlocks only once the market closes, a story unlocks only when its event has fully played out, and the value lines are cut where an unresolved event still influences a company. Everything unlocks when the session ends. In a solo game you can press "Reveal everything now" (spoiler mode; not available in rooms). Code: `server/truth.js`, `truth()` in `public/js/views.js`.

## Market hours (like the NSE and BSE)

The market trades **9:15 AM to 3:30 PM IST** (the real NSE/BSE regular session; the exchange pre-open runs 9:00 to 9:15). You can buy and sell only inside those hours; before the open and after the close the order ticket is locked, and the server refuses orders too.

- Each day starts at **8:15 AM, one hour before the open**. Overnight and pre-open news is already out, so you can read it and plan. Press Play: the clock runs to 9:15 AM, the opening prices appear (gaps happen here) and Play stops so you can trade.
- Press Play again to run the day. The clock stops by itself at **3:30 PM**. After that you cannot trade.
- Press **Next day** to jump to 8:15 AM the next morning. The top bar shows the time, whether the market is open, and a timeline of the session (8:15, 9:15 ... 3:30).
- Your first trade ever also starts the clock, so you do not need to press Play first.
- In multiplayer rooms the shared clock does this automatically (a pause at the close, then the next morning), and the same trading hours apply to everyone.

## Design system ("Ledger")

Warm paper background, ink typography, one blue accent, green and red only for market direction. Newsreader (editorial headings), IBM Plex Sans (UI) and IBM Plex Mono (numbers), all self-hosted in `public/fonts`, so the game still works offline. Motion: staggered page entrances, price flashes, net-worth count-up, chart wipe-in, studio lower-thirds and tiles; everything switches off under `prefers-reduced-motion`. Accessibility basics from the Front-End Checklist are in place (skip link, focus management, contrast, touch targets, print styles, security headers).

## Architecture

```
server/
  index.js      HTTP server, auth, REST API, static files
  engine.js     THE source of truth: prices, orders, portfolio, news delivery, report
  events.js     event schedule + news planning (actual truth vs what channels report)
  generator.js  seeded market generator (companies, scenario, history)
  news.js       the four channel voices
  learn.js      trade reviews, situations, concepts (all local, rule based)
  ai.js         optional LLM layer: words only, schema-validated, always falls back
  data.js       fallback content library
  db.js         SQLite persistence (transactional)
db/schema.sql   relational schema
public/         browser app (ES modules, no build step) with a dependency-free canvas chart engine
tests/          backend.test.js (node:test) and e2e.js (browser, optional)
```

**One source of truth.** The engine owns all state. The browser only sends intents (place order, advance time) and receives a view. Hidden company attributes (management quality, growth potential, health) and event truth are never sent to the client. Balances cannot be edited from the client.

**News truth system.** Every event stores its actual truth and real financial effect (with a lag and a ramp). News publications are planned separately: accurate, exaggerated, misleading, unverified, misread, denied or corrected, each with its own delay and channel voice. Investor belief follows what was *reported*, and the price follows a blend of belief and the real effect. So a false FLASHWIRE rumour moves a stock for a while, a MARKETLINE denial reverses it, and a true story that is reported late is already partly priced in. Company vulnerability (debt, cash, management) changes how hard the same event hits different companies.

**Reproducible.** Every random decision comes from the session seed (`server/rng.js`), so the same seed gives the same market, news and price path for the same actions.

**Persistence.** The whole session is saved to SQLite in a transaction after every action, with relational projections (`companies`, `price_candles`, `orders`, `transactions`, `holdings`, `cash_balances`, `news_publications`, `economic_events`, `learning_records`, `game_results`). Refreshing the browser resumes your game. Orders carry an idempotency key, so a double click or a retry cannot execute twice.

## Multiplayer

1. One person picks a session length and a pace (Fast, Normal or Relaxed) and presses **Create a room**. They are the host and see a 5-character **room code** and an invite link.
2. Friends open the same address, type their name and either enter the code under **Join room** or open the invite link (the code is pre-filled). Up to 8 players; joining is possible until the host starts.
3. The host presses **Start the market**. The server then runs one shared clock: everyone sees the same prices, the same news at the same moment and the same events, while each player has their own cash, orders and portfolio. Only the host can pause, resume, change pace or end the session for everyone. You can place orders in the lobby and while paused.
4. The **Leaderboard** ranks by return, by **risk-adjusted** return (steady gains beat a lucky gamble) or by **decision quality** (the average process score from trade reviews), and charts everyone against the market. Other players' holdings and cash are never shown. At the end every player gets their own report with the final standings.

Friends on the same Wi-Fi can join by opening `http://<your-computer's-LAN-IP>:3000`. For friends elsewhere you need to expose the port yourself (a tunnel such as Cloudflare Tunnel or ngrok); this project does not do that for you. There are no accounts or passwords, only a name, so do not expose it to the open internet for anything but casual play.

Technically a room is one game session whose state holds `room` and a `players` map, with a server-side ticker advancing the market and a revision counter so clients poll cheaply.

## AI anchors

Each channel has a virtual presenter (Jax Rourke, Meera Kapoor, Nadia Voss, and the Daily Pulse duo Sunny and Tara). They are original, fictional, **illustrated** characters drawn as animated vector art (blinking, lip movement while speaking, subtle head motion), with a teleprompter that types out the story and an optional **Sound** switch that reads it aloud with your browser's built-in voice. They are not photoreal and nothing is generated by an image model. To use your own picture for an anchor, see `public/img/anchors/README.txt`.

## Tests

```bash
npm test          # 16 backend tests, no extra installs
npm run e2e       # optional single-player and two-browser multiplayer tests; needs `npm i -g playwright` and a Chromium
```

The backend tests cover: 25 unique valid sessions with 5 to 10 companies, reproducibility from a seed, prices never negative or unbounded, buy and sell accounting and fees, refusal to overspend, idempotent orders, limit and stop-loss orders and reservations, news timing and channel voices, rumours moving prices then reversing on correction, hidden attributes never leaking, a complete session with no AI, AI validation rejecting bad output, fallback on an unreachable API and on malformed AI JSON, the HTTP API including session privacy and refresh persistence, and multiplayer: rooms, joining rules, a shared clock that runs a two-player room to completion, leaderboard privacy and migration of older saves.

## Troubleshooting

- **`No such built-in module: node:sqlite`**: your Node is too old. Install Node 22.13 or newer (`node -v`).
- **Port already in use**: set `PORT=3001` in `.env`, or run `PORT=3001 npm start`.
- **A banner says "Built-in generator"**: no AI key is set, or the AI service failed. The game is unaffected. Details are in `logs/app.log`.
- **"Cannot reach the game server"**: the Node process stopped. Restart `npm start`; your game is saved and resumes automatically.
- **Start over completely**: stop the server and delete the `data/` folder.
- **Friends cannot join**: they need to reach your computer's address and port, and the room must still be in the lobby (before the host presses Start).
- **Playback stops by itself**: intended. It pauses on fills and on breaking news about companies you own, and when the tab is hidden.

## Differences from the original brief

The brief preferred React, TypeScript, Vite, Tailwind, Express, Prisma/PostgreSQL, Socket.IO and TradingView Lightweight Charts, while also asking for a local mode with no mandatory external services and no unnecessary dependencies. This build was produced in an environment that could not reach the npm registry, so it deliberately uses what runs with no installs: Node's built-in HTTP server and `node:sqlite`, plain ES modules in the browser, a custom canvas charting engine (candles, volume, MA, Bollinger, RSI, MACD, support and resistance, trendline, crosshair), and short HTTP requests instead of Socket.IO. The server-authoritative design, schema and API are the same ones those libraries would sit on top of. The three extra game modes are not included. Multiplayer rooms use short polling (about once a second) instead of WebSockets.

## License

MIT. All companies, people and events are fictional.

## Anchor voices, newsroom style and ad breaks (BullRun Live)

**How the anchors speak.** `public/js/broadcast.js` writes what an anchor would *say*, not just what the story says:
a lead-in ("Breaking news."), the facts in short spoken sentences, hand-overs between anchors ("Thanks, Meera."), a slower
first line, a falling last line, slower delivery on figures, and a steady small variation so it never sounds monotone.
DAILY PULSE is a two-voice conversation (Sunny and Tara). Numbers are spoken the Indian way ("one lakh", "four point one percent").
Shouted words and channel names are spoken as words (this fixes voices spelling out "U N D E R C U R R E N T"); real acronyms
(IPO, GDP) and tickers are spelled on purpose.

**Smooth speech.** `public/js/anchors.js` queues every sentence with the browser at once (no waiting between sentences), keeps
utterances referenced so Chrome cannot drop them, ranks voices (natural/neural first, novelty voices never, a different voice
per anchor) and has a watchdog that recovers when a voice freezes. Best results: Microsoft Edge with its "Natural" voices, or Chrome on a
device with good local voices.

**Lip-sync.** `public/js/lipsync.js` moves the mouth syllable by syllable (wide for "ah", round for "oo"), locked to the voice when
it reports word boundaries and to an estimated timeline when it does not. With sound off, the mouth follows the captions.

**Realistic presenter video (optional).** Put a short looping, muted clip of a presenter in `public/img/anchors/` named
`flashwire.mp4`, `marketline.mp4`, `undercurrent.mp4` or `dailypulse.mp4` (`.webm` also works). It plays only while that anchor is speaking.
Photos (`.png`, `.jpg`, `.webp`) still work as before.

**Ad breaks.** News always has priority. An ad (a fictional sponsor or a BullRun house promo, about 6 to 9 seconds) airs only in a
content gap: nothing is waiting, at least two filler segments have run, at least 2.5 minutes since the last ad, and ads are under 7 percent of airtime.
Any story that arrives cuts the ad short. If a voice stalls, a short "Please stand by" slate covers it. Tune this in `AD_RULES` in `broadcast.js`.

### Using a Gemini or ChatGPT key

Put the key in `.env` (copy `.env.example`). Nothing else is needed.

| You have | Set |
|---|---|
| Gemini key (Google AI Studio) | `AI_PROVIDER=gemini` and `AI_API_KEY=...` |
| ChatGPT / OpenAI API key | `AI_PROVIDER=openai` and `AI_API_KEY=...` |

The one key does two jobs. It writes the scenario and company text (words only; prices, orders and news timing never use AI),
and it gives the anchors natural voices (OpenAI `gpt-4o-mini-tts` or Gemini TTS) through `POST /api/tts`. The key stays on the server.
In the studio a **Voice: AI / browser** button switches between them. If the AI voice fails or is rate limited (free Gemini
tiers have low speech limits), the browser voice takes over for three minutes and the page tells you. Repeated lines are cached,
each signed-in user is capped at 45 voice requests a minute, and a Claude/Anthropic key never switches the voice on.
A ChatGPT Plus or Gemini app subscription is not an API key; you need a key from platform.openai.com or aistudio.google.com.

### Emotion: anchors that perform the news (ported from dualcast)

dualcast's casters sound alive because every line carries its own emotion, and the lines are written to be spoken. BullRun now does the same.

- **Emotion per sentence** (`public/js/emotion.js`). It is picked from the story: breaking news is urgent (or excited if the claim is good for prices),
  a rumour is sceptical, a correction is reassuring, big verified bad news is grave. It then moves within the story: the lead-in is the loudest line,
  questions and hedges sound doubtful, and the last line is a steady sign-off.
- **The voice performs it.** OpenAI and Gemini get a spoken brief ("urgent and alert, strong intensity"). Fish Audio gets a tag such as `[tense]` plus
  speed and volume, and ElevenLabs gets lower stability for stronger feelings. The browser voice approximates it with rate and pitch.
- **The face follows it.** Brows and eyes change with the emotion on the illustrated anchors.
- **AI-written lines** (`server/newsroom.js`). With a Gemini or OpenAI key, each anchor writes the story in its own persona (Jax is fast and punchy, Meera calm,
  Nadia sceptical). The server rejects any line with an invented number or name, advice to buy or sell, a firm prediction, a rumour told as fact, or a confirmed story
  that sounds unconfirmed. If the model is slow or rejected, the built-in script is used, so nothing unchecked reaches the screen.

### Everyday news and scam arcs (random in every game)

Both kinds are scheduled from each game's seed with their own random stream (`scheduleStories` in `server/events.js`): the company, the wording,
the size and the timing all change from game to game, and nothing is tied to one company. Edit the tables in `server/data.js` to add more.

- **People news** (`PEOPLE_EVENTS`): a CEO in a personal scandal, a CEO linked to a suspected foreign spy, a leaked video, a fake degree, a boycott,
  a whistleblower, and some good press (an award, a viral advert, a donation). A scandal usually costs a company 2 to 8 percent and fades.
  About one story for every two trading days.
- **Scam arcs** (`FRAUD_ARCS`): stage 1 is a big claim (for example a range marketed as 100 percent natural). FLASHWIRE and DAILY PULSE run with it and the price rises on
  belief alone (typically about 11 percent), but MARKETLINE stays silent because it cannot verify it. One to two days later the government or a regulator finds it was a
  scam: the price falls hard (about 30 to 40 percent for a holder at the exposure). THE UNDERCURRENT often leaks a warning first. Truth Mode marks the hype as false, the
  earlier loud stories are marked as disputed, and Learn explains "claims that sound too good". Six scam types: natural claims, phantom export orders, a miracle battery, a fake AI,
  a miracle cure, and guaranteed returns. Each game gets zero to a few, so players see them happen without ever being told.

`tests/stories.test.js` checks that these appear at random, do not repeat, and move prices as described.
