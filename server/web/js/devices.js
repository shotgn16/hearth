// Settings → Phones & devices: connect the Hearth phone app (or another computer) by scanning a QR code.
import { api, esc, toast, on } from './core.js';

const CONTEXT_NOTE = {
  desktop: 'Hearth is running in the desktop app on this computer. Phones can reach it while the app is open (it keeps running in the tray when you close the window).',
  service: 'Hearth is running as a service on this computer, so phones can reach it whenever the computer is on.',
  docker: 'Hearth is running in Docker. Use the address of the computer running Docker.',
  server: 'Phones on the same network can reach Hearth at the addresses below.',
};

export async function renderDevices(el) {
  const d = await api('/devices');
  const first = d.addresses[0];
  let mode = 'app';

  const problems = [];
  if (d.localOnly) problems.push('Hearth is set to be private to this computer, so phones can\'t reach it. In the Hearth desktop app choose <b>Change setup → This computer and my phone</b>.');
  if (d.context === 'addon' && !d.addonPort) problems.push(`Inside Home Assistant, the easiest way to use Hearth on a phone is the <b>Home Assistant app</b> — Hearth is in its sidebar. To use the Hearth app instead, open the add-on's <b>Configuration</b> tab in Home Assistant, set a port next to <code>8484/tcp</code> under <b>Network</b> (for example 8484), save and restart the add-on, then come back here.`);
  if (!d.addresses.length && !problems.length) problems.push('This computer doesn\'t seem to be connected to a network.');

  const draw = () => {
    const a = el.querySelector('[data-addr]')?.value ? d.addresses.find((x) => x.url === el.querySelector('[data-addr]').value) || first : first;
    el.querySelector('#qr').innerHTML = a ? (mode === 'app' ? a.qr_app : a.qr_web) : '';
    el.querySelector('#qrcap').innerHTML = a ? (mode === 'app'
      ? 'Point your phone\'s camera at the code and tap the link — the Hearth app opens and connects.'
      : 'Point your phone\'s camera at the code to open Hearth in the browser. Then use <b>Add to Home Screen</b>.') : '';
  };

  el.innerHTML = `
    <p class="muted" style="margin-top:0">${esc(CONTEXT_NOTE[d.context] || CONTEXT_NOTE.server)}</p>
    ${problems.map((p) => `<div class="surface pad" style="border-left:4px solid var(--amber);margin-bottom:16px">${p}</div>`).join('')}
    ${d.addresses.length ? `
    <div class="grid2" style="margin-top:0;align-items:start">
      <section class="surface pad">
        <h3 style="margin-top:0">1. Get the app</h3>
        <ul class="small" style="padding-left:18px;line-height:1.7;margin:0 0 10px">
          <li><b>Android</b> — download <code>Hearth.apk</code> from the <a href="${esc(d.downloads)}" target="_blank" rel="noopener">downloads page</a> on your phone and open it.</li>
          <li><b>iPhone / iPad</b> — see the <a href="https://github.com/shotgn16/hearth/blob/main/docs/mobile-apps.md" target="_blank" rel="noopener">phone app guide</a>.</li>
          <li><b>No app?</b> Hearth also works in the phone's browser — switch the code below to <i>browser</i>.</li>
        </ul>
        <h3>2. Connect</h3>
        <p class="small muted">Your phone needs to be on the same Wi-Fi as this ${d.context === 'addon' ? 'Home Assistant' : 'computer'} — or on a VPN such as Tailscale when you're out.</p>
        ${d.addresses.length > 1 ? `<label class="f"><span>Address</span><select data-addr>${d.addresses.map((x) => `<option value="${esc(x.url)}">${esc(x.url)} — ${esc(x.label)}</option>`).join('')}</select></label>` : `<p><code>${esc(first.url)}</code></p>`}
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn soft small" data-copy>Copy address</button></div>
      </section>
      <section class="surface pad" style="text-align:center">
        <div class="seg" style="justify-content:center;margin-bottom:10px"><button class="on" data-mode="app">Hearth app</button><button data-mode="web">Browser</button></div>
        <div id="qr" style="width:220px;max-width:100%;margin:0 auto;background:#fff;padding:8px;border-radius:12px"></div>
        <p id="qrcap" class="small muted" style="margin-bottom:0"></p>
      </section>
    </div>` : ''}
    <p class="small muted">Each person signs in on their phone with their own Hearth email and password (add people under <a href="#/settings/people">People &amp; household</a>).</p>`;

  if (!d.addresses.length) return;
  draw();
  el.querySelector('[data-addr]')?.addEventListener('change', draw);
  on(el, 'click', '[data-mode]', (e, b) => { mode = b.dataset.mode; el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  el.querySelector('[data-copy]').onclick = async () => {
    const url = el.querySelector('[data-addr]')?.value || first.url;
    try { await navigator.clipboard.writeText(url); toast('Address copied'); } catch { toast(url); }
  };
}
