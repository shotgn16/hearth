// Tiny dependency-free SVG charts (nothing loaded from the internet).
import { fmt0, esc } from './core.js';

const niceMax = (v) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p * 2) / 2 * p; };

// Soft forecast horizon for the home screen. The line stretches to fit; labels and the low-point marker are HTML so they never distort.
export function horizon(points, { low } = {}) {
  if (!points?.length) return '';
  const W = 600, H = 120;
  const vals = points.map((p) => p.balance);
  const min = Math.min(...vals, 0), max = Math.max(...vals) * 1.08 || 1;
  const xp = (i) => (i / (points.length - 1)) * 100;
  const yp = (v) => (1 - (v - min) / (max - min || 1)) * 88 + 6; // percent of height
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${(xp(i) * W / 100).toFixed(1)},${(yp(p.balance) * H / 100).toFixed(1)}`).join('');
  const lowIdx = low ? points.findIndex((p) => p.date === low.date) : -1;
  const labels = points.map((p, i) => (i % 14 === 0 && i ? `<span style="left:${xp(i)}%">${new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>` : '')).join('');
  return `<div class="hz"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Balance forecast for the next 8 weeks">
    <defs><linearGradient id="hzg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--amber)" stop-opacity=".28"/><stop offset="1" stop-color="var(--amber)" stop-opacity="0"/></linearGradient></defs>
    ${min < 0 ? `<line x1="0" x2="${W}" y1="${yp(0) * H / 100}" y2="${yp(0) * H / 100}" stroke="var(--amber)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>` : ''}
    <path d="${line}L${W},${H}L0,${H}Z" fill="url(#hzg)"/>
    <path d="${line}" fill="none" stroke="var(--amber)" stroke-width="2.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>
    ${lowIdx >= 0 ? `<i class="hz-low" style="left:${xp(lowIdx)}%;top:calc((100% - 22px) * ${(yp(points[lowIdx].balance) / 100).toFixed(4)})" title="Lowest point"></i>` : ''}
    <div class="hz-labels">${labels}</div></div>`;
}

// Multi-series line chart. series: [{name, color, values:[...]}], labels: [...]
export function lineChart(labels, series, { height = 220, area = false, money = true } = {}) {
  const W = 640, H = height, L = 46, R = 10, T = 10, B = 24;
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  const min = Math.min(0, ...all), max = niceMax(Math.max(...all, 1));
  const x = (i) => L + (labels.length < 2 ? 0 : (i / (labels.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ticks = [0, .25, .5, .75, 1].map((f) => min + (max - min) * f);
  const step = Math.ceil(labels.length / 8);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line-2)"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${money ? fmt0(t) : Math.round(t)}</text>`).join('')}
    ${labels.map((l, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>` : '')).join('')}
    ${series.map((s) => {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (!pts.length) return '';
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
      return `${area ? `<path d="${d}L${pts.at(-1)[0]},${y(min)}L${pts[0][0]},${y(min)}Z" fill="${s.color}" opacity=".12"/>` : ''}
        <path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" ${s.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"><title>${esc(s.name)}</title></path>
        ${pts.length < 40 ? pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${s.color}"><title>${esc(s.name)} · ${esc(labels[i])}: ${fmt0(s.values[i])}</title></circle>`).join('') : ''}`;
    }).join('')}
  </svg>${series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i class="dot" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}</div>`;
}

// Grouped bar chart
export function barChart(labels, series, { height = 220 } = {}) {
  const W = 640, H = height, L = 46, R = 6, T = 10, B = 24;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 1));
  const gw = (W - L - R) / labels.length, bw = Math.max(2, Math.min(18, (gw - 6) / series.length));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const step = Math.ceil(labels.length / 12);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">
    ${[0, .5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="var(--line-2)"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${fmt0(max * f)}</text>`).join('')}
    ${labels.map((l, i) => {
      const gx = L + i * gw + (gw - bw * series.length) / 2;
      return series.map((s, j) => `<rect x="${gx + j * bw}" y="${y(s.values[i] || 0)}" width="${bw - 1.5}" height="${Math.max(0, H - B - y(s.values[i] || 0))}" rx="2.5" fill="${s.color}"><title>${esc(s.name)} · ${esc(l)}: ${fmt0(s.values[i] || 0)}</title></rect>`).join('')
        + (i % step === 0 ? `<text x="${L + i * gw + gw / 2}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>` : '');
    }).join('')}
  </svg>${series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i class="dot" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}</div>`;
}

export function spark(values, color = 'var(--ink-2)', w = 90, h = 26) {
  if (!values?.length || values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8"/></svg>`;
}
