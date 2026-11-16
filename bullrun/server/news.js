'use strict';
// Four channel personalities. Each composes text in its own voice from the same underlying event facts.
const CHANNELS = {
  flashwire: { id: 'flashwire', name: 'FLASHWIRE', tagline: 'Breaking. Fast. Loud.', color: '#ff4d4f', anchor: 'Jax Rourke', reach: 0.75,
    desc: 'Aggressive and dramatic. First to every story, but sometimes runs unverified reports, exaggerates, or gets it wrong.' },
  marketline: { id: 'marketline', name: 'MARKETLINE', tagline: 'Verified. Measured. Analytical.', color: '#4da3ff', anchor: 'Meera Kapoor', reach: 0.6,
    desc: 'Calm and careful. Checks facts before reporting, so it is usually right, but often arrives after the market has already reacted.' },
  undercurrent: { id: 'undercurrent', name: 'THE UNDERCURRENT', tagline: 'What they are not telling you.', color: '#b07cff', anchor: 'Nadia Voss', reach: 0.4,
    desc: 'Investigative and suspicious. Digs up rumours and hidden problems others miss, but can misread the evidence.' },
  dailypulse: { id: 'dailypulse', name: 'DAILY PULSE', tagline: 'Your day, in a minute.', color: '#ffb020', anchor: 'Sunny & Tara', reach: 0.2,
    desc: 'Friendly mainstream news: politics, sports, weather, technology and entertainment, with a little business on the side.' },
};
const up = (s) => s.toUpperCase();
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const stripDot = (s) => s.replace(/[.\s]+$/, '');

function compose(channel, treat, ev) {
  const t = ev.text; const neg = ev.dir < 0; const A = CHANNELS[channel].anchor;
  const fact = stripDot(t.fact || ''); const rumor = stripDot(t.rumor || ''); const deny = stripDot(t.deny || ''); const ctx = t.ctx || '';
  const subject = ev.coName || (ev.industries && ev.industries.length === 1 ? ev.industries[0] + ' sector' : 'the market');
  switch (channel) {
    case 'flashwire':
      switch (treat) {
        case 'exaggerated': return neg
          ? { label: 'Breaking', headline: `SHOCK: ${up(fact)} — INVESTORS REELING`, body: `${A}: "This could be a catastrophe. ${cap(fact)}. Insiders say the damage may be far bigger than anyone expects. Stay with us."` }
          : { label: 'Breaking', headline: `SURGE ALERT: ${up(fact)} — SET TO SOAR?`, body: `${A}: "A jackpot moment. ${cap(fact)}. Traders are calling this a game-changer. Stay with us."` };
        case 'misleading': return { label: 'Breaking', headline: `BREAKING: ${up(fact)}${neg ? ' — HALF OF REVENUE AT RISK?' : ' — SALES COULD DOUBLE, SAY INSIDERS'}`, body: `${A}: "${cap(fact)}. We are hearing the sums involved are enormous, though details are still thin."` };
        case 'unverified': return { label: 'Unverified', headline: `BREAKING (UNVERIFIED): ${up(rumor)}`, body: `${A}: "Unconfirmed, but sources close to the matter say: ${rumor}. We are chasing confirmation right now."` };
        case 'retraction': return { label: 'Correction', headline: `CORRECTION: EARLIER REPORT WAS WRONG — ${up(deny)}`, body: `${A}: "We need to set the record straight. Our earlier report did not hold up. ${cap(deny)}."` };
        case 'general': return { label: 'General', headline: `${up(fact)}!`, body: `${A}: "${cap(fact)}! The whole country is watching. More after the break."` };
        default: return { label: 'Breaking', headline: `BREAKING: ${up(fact)}`, body: `${A}: "We are getting this as we go to air. ${cap(fact)}. Markets could move fast, so stay with us."` };
      }
    case 'marketline':
      switch (treat) {
        case 'denial': return { label: 'Denial', headline: `Verified: ${deny}`, body: `${A}: "${cap(deny)}. Earlier reports of this story were not supported by our checks. Nothing has changed at the company."` };
        case 'general': return { label: 'General', headline: cap(fact), body: `${A}: "${cap(fact)}. Analysts see limited direct impact on markets but will watch for second-round effects."` };
        default: return { label: 'Verified', headline: cap(fact), body: `${A}: "${cap(fact)}. ${ctx} We have verified the details with the company or official sources.${ev.flashExag ? ' The impact appears more limited than some early reports suggested.' : ''}"` };
      }
    case 'undercurrent':
      switch (treat) {
        case 'leak': return { label: 'Sources say', headline: `Sources suggest: ${rumor}`, body: `${A}: "Our team has reviewed documents and spoken to people familiar with the matter. ${cap(rumor)}. We have not been able to confirm this with the company."` };
        case 'echo': return { label: 'Rumour', headline: `Sources suggest: ${rumor}`, body: `${A}: "We are hearing the same thing from two sources. The evidence is thin, but the pattern is hard to ignore: ${rumor}."` };
        case 'misread_over': return { label: 'Analysis', headline: `Our reading: ${subject} may be in ${neg ? 'deeper trouble' : 'a stronger position'} than it admits`, body: `${A}: "We studied filings and supplier emails. In our view ${fact}, and the full picture is ${neg ? 'worse' : 'better'} than official statements suggest."` };
        case 'misread_wrong': return { label: 'Analysis', headline: neg ? `Documents suggest the damage may be smaller than feared: ${fact}` : `Documents suggest the hype is ahead of reality: ${fact}`, body: `${A}: "Reading the paperwork closely, we think the market may be overreacting. We could be wrong, and the company has not commented."` };
        default: return { label: 'Sources say', headline: `Inside story: ${fact}`, body: `${A}: "Our investigation points to the same conclusion: ${fact}. Questions remain about how early the company knew."` };
      }
    default: // dailypulse
      switch (treat) {
        case 'general': {
          const link = ev.links && Object.keys(ev.links).length ? ` Traders say it could ripple into ${Object.keys(ev.links).slice(0, 2).join(' and ')} stocks.` : '';
          return { label: 'General', headline: cap(fact), body: `Tara: "${cap(fact)}! Everyone is talking about it." Sunny: "We will bring you more after the break."${link}` };
        }
        case 'chatter': return { label: 'Chatter', headline: `Online chatter: ${rumor}`, body: `Sunny: "Social media is buzzing, but nothing is confirmed." Tara: "Keep calm and wait for official word."` };
        default: return ev.kind === 'company' || ev.kind === 'earnings'
          ? { label: 'Business', headline: `Business buzz: ${fact}`, body: `Sunny: "And in business news — ${fact}." Tara: "${ctx}"` }
          : { label: 'Economy', headline: `${cap(fact)}: what it means for your wallet`, body: `Sunny: "${cap(fact)}." Tara: "${ctx}"` };
      }
  }
}
module.exports = { CHANNELS, compose, cap, stripDot };
