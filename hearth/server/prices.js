// Price watching. Only the product URL / search term leaves the server — never any financial data.
// Providers (each can be toggled in Settings → Integrations):
//  - url:         any product page; reads the price from schema.org Product/Offer data that most UK shops publish
//  - pricerunner: a PriceRunner product page; reads the lowest offer across all retailers and which shop has it
const { q, getSetting } = require('./db');
const { runRules } = require('./rules');
const { notify } = require('./notify');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

function extractOffers(html) {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return JSON.parse(m[1].trim()); } catch { return null; } }).filter(Boolean);
  const offers = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const t = [].concat(n['@type'] || []);
    if (t.includes('AggregateOffer')) offers.push({ price: Number(n.lowPrice ?? n.price), store: n.seller?.name || 'Lowest across shops', url: n.url });
    else if (t.includes('Offer') && (n.price ?? n.priceSpecification?.price) != null) offers.push({ price: Number(n.price ?? n.priceSpecification.price), store: n.seller?.name, url: n.url });
    Object.values(n).forEach(walk);
  };
  blocks.forEach(walk);
  if (!offers.length) {
    const meta = html.match(/(?:product:price:amount|og:price:amount|itemprop="price")[^>]*content="([\d.,]+)"/i);
    if (meta) offers.push({ price: Number(meta[1].replace(',', '')), store: null });
  }
  return offers.filter((o) => o.price > 0).sort((a, b) => a.price - b.price);
}

// Seasonal UK buying hints for "when is the right time to buy"
function timingAdvice(history, now = new Date()) {
  const m = now.getMonth(), d = now.getDate();
  const hints = [];
  if (m === 10 || (m === 11 && d < 3)) hints.push('Black Friday / Cyber Monday is the biggest discount window of the year — expect the low point in late November.');
  if (m === 9) hints.push('Black Friday is close; unless this price is a new all-time low, waiting a few weeks often pays.');
  if (m === 11 && d >= 20 || m === 0) hints.push('Boxing Day and January sales are on — good time for clothing, home and tech.');
  if (m === 5 || m === 6) hints.push('Amazon Prime Day usually lands in July; other retailers match prices around it.');
  if (history.length >= 5) {
    const prices = history.map((h) => h.price), low = Math.min(...prices), avg = prices.reduce((s, x) => s + x, 0) / prices.length;
    const cur = prices[prices.length - 1];
    if (cur <= low) hints.unshift('This is the lowest price we have seen — a strong time to buy.');
    else if (cur <= avg * 0.93) hints.unshift(`Below its usual price (avg £${avg.toFixed(2)}) — a good deal.`);
    else if (cur >= avg * 1.05) hints.unshift(`Above its usual price (avg £${avg.toFixed(2)}) — worth waiting.`);
  }
  return hints;
}

async function checkWatch(w) {
  const integ = getSetting(w.household_id, 'integrations', { pricerunner: true, url: true });
  if (integ[w.provider] === false) return { skipped: 'provider disabled' };
  if (!w.url) return { skipped: 'no url — search link only' };
  try {
    const r = await fetch(w.url, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-GB' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Shop returned ${r.status}`);
    const offers = extractOffers(await r.text());
    if (!offers.length) throw new Error('No price found on that page');
    const best = offers[0];
    const history = JSON.parse(w.history || '[]');
    history.push({ date: new Date().toISOString().slice(0, 10), price: best.price, store: best.store });
    const trimmed = history.slice(-365);
    const lowest = Math.min(best.price, w.lowest_price ?? Infinity);
    q.run('UPDATE watches SET last_price=?, lowest_price=?, best_store=?, best_url=?, last_checked=?, last_error=NULL, history=? WHERE id=?',
      best.price, lowest, best.store, best.url || w.url, new Date().toISOString(), JSON.stringify(trimmed), w.id);
    const hitTarget = w.target_price && best.price <= w.target_price;
    const newLow = trimmed.length > 3 && best.price < (w.lowest_price ?? Infinity);
    const recentlyNotified = w.notified_at && Date.now() - new Date(w.notified_at) < 3 * 86400000;
    if ((hitTarget || newLow) && !recentlyNotified) {
      const ctx = { id: w.id, query: w.query, price: best.price, store: best.store || 'a retailer', merchant: w.query, amount: -best.price };
      const matched = await runRules(w.household_id, 'price_target', ctx);
      if (!matched.length) await notify(w.household_id, { title: `Good time to buy: ${w.query}`, body: `£${best.price.toFixed(2)} at ${ctx.store}${hitTarget ? ' — at or under your target' : ' — lowest price yet'}`, url: '/#/watch' }, { userIds: w.user_id ? [w.user_id] : undefined });
      q.run('UPDATE watches SET notified_at=? WHERE id=?', new Date().toISOString(), w.id);
    }
    return { price: best.price, store: best.store, offers: offers.slice(0, 5), advice: timingAdvice(trimmed) };
  } catch (e) {
    q.run('UPDATE watches SET last_error=?, last_checked=? WHERE id=?', e.message, new Date().toISOString(), w.id);
    throw e;
  }
}

function searchLinks(query) {
  const s = encodeURIComponent(query);
  return [
    { name: 'PriceRunner', url: `https://www.pricerunner.com/results?q=${s}`, provider: 'pricerunner' },
    { name: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${s}` },
    { name: 'Amazon UK', url: `https://www.amazon.co.uk/s?k=${s}` },
    { name: 'Argos', url: `https://www.argos.co.uk/search/${s}/` },
    { name: 'Currys', url: `https://www.currys.co.uk/search?q=${s}` },
    { name: 'CamelCamelCamel (Amazon history)', url: `https://uk.camelcamelcamel.com/search?sq=${s}` },
  ];
}

module.exports = { checkWatch, extractOffers, timingAdvice, searchLinks };
