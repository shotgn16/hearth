// Hearth phone app: find your Hearth (QR code, link or typed address), remember it, and open it.
// Once connected, the app simply shows your Hearth — everything you see after that comes from your own server.
import { normaliseAddress, addressFromLink, explainFailure, checkServer, ServerList } from './servers.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const servers = new ServerList(window.localStorage);
const AppPlugin = window.Capacitor?.Plugins?.App; // deep links (hearth://connect?url=…) — present inside the app
const BRAND = '<div class="brand"><img src="icon.svg" alt="" width="44" height="44"><span>Hearth</span></div>';

// ---------------------------------------------------------------- opening a Hearth
async function connect(address, { remember = true } = {}) {
  const url = normaliseAddress(address);
  if (!url) return home({ error: 'That doesn\'t look like an address. It\'s usually like 192.168.1.20:8484' });
  busy(`Connecting to ${url}…`);
  try {
    await checkServer(url);
    if (remember) servers.remember(url);
    location.replace(`${url}/`); // the server's own page takes over (sign-in, or first-time setup)
  } catch (e) {
    home({ error: explainFailure(e, url), retry: url });
  }
}

function busy(text) {
  app.innerHTML = `${BRAND}<div class="note gap-lg"><span class="spin"></span>${esc(text)}</div>`;
}

// ---------------------------------------------------------------- the connect screen
function home({ error = '', retry = '' } = {}) {
  stopScanner();
  const list = servers.all();
  app.innerHTML = `${BRAND}
    <h1>${list.length ? 'Your Hearth' : 'Connect to your Hearth'}</h1>
    <p class="muted">${list.length ? 'Choose which Hearth to open, or add another.' : 'Hearth runs on a computer, server or Home Assistant in your home. Connect this phone to it once — after that the app opens it straight away.'}</p>
    ${error ? `<div class="note bad" role="alert">${esc(error)}${retry ? '<div class="row gap"><button class="btn soft" id="retry">Try again</button></div>' : ''}</div>` : ''}
    ${list.length ? `<h2>Saved</h2><ul class="list">${list.map((s) => `<li><button class="open" data-open="${esc(s.url)}"><div class="title">${esc(s.name)}</div><div class="meta">${esc(s.url)}</div></button>
      <button class="icon-btn" data-forget="${esc(s.url)}" aria-label="Remove ${esc(s.name)}">✕</button></li>`).join('')}</ul>` : ''}
    <h2>${list.length ? 'Add another' : 'Connect'}</h2>
    <div class="stack">
      <button class="btn wide" id="scan">Scan the QR code</button>
      <form id="manual" class="stack" autocomplete="off">
        <label><span>Or type its address</span><input id="addr" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="192.168.1.20:8484"></label>
        <button class="btn soft wide">Connect</button>
      </form>
    </div>
    <h2>Where do I find the QR code?</h2>
    <ol class="steps small muted">
      <li>On the computer, open Hearth and go to <b>Settings → Phones &amp; devices</b> (in the desktop app: the Hearth menu → <b>Connect a phone…</b>).</li>
      <li>Scan the code with this app — or with the phone's own camera, then tap the link.</li>
      <li>Sign in with your Hearth email and password.</li>
    </ol>
    <p class="small muted">Your phone needs to be on the same Wi-Fi as Hearth, or on a VPN such as Tailscale when you're out.</p>`;
  $('#scan').onclick = startScanner;
  $('#manual').onsubmit = (e) => { e.preventDefault(); const v = $('#addr').value; if (v.trim()) connect(v); else $('#addr').focus(); };
  $('#retry')?.addEventListener('click', () => connect(retry));
  app.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => connect(b.dataset.open); });
  app.querySelectorAll('[data-forget]').forEach((b) => { b.onclick = () => { servers.forget(b.dataset.forget); home(); }; });
}

// ---------------------------------------------------------------- QR scanner (camera + jsQR, all on the phone)
let stream = null, raf = 0;
async function startScanner() {
  if (!navigator.mediaDevices?.getUserMedia || typeof window.jsQR !== 'function') {
    return home({ error: 'The camera isn\'t available here. Scan the code with the phone\'s own camera app instead, or type the address.' });
  }
  const box = document.createElement('div');
  box.className = 'scanner';
  box.innerHTML = '<video playsinline muted></video><div class="frame"></div><div class="bar"><p>Point the camera at the QR code on Hearth\'s <b>Phones &amp; devices</b> screen.</p><button class="btn soft wide" id="cancelscan">Cancel</button></div>';
  document.body.append(box);
  $('#cancelscan', box).onclick = () => { stopScanner(); };
  const video = $('video', box);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    stopScanner();
    return home({ error: 'Hearth wasn\'t allowed to use the camera. Allow it in the phone\'s Settings → Hearth, or scan with the camera app instead.' });
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!stream) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      const url = code && addressFromLink(code.data);
      if (url) { stopScanner(); return connect(url); }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function stopScanner() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  document.querySelector('.scanner')?.remove();
}

// ---------------------------------------------------------------- start-up
async function start() {
  const qs = new URLSearchParams(location.search);
  // Links that open the app: hearth://connect?url=… (handled natively and passed on as ?connect=…)
  AppPlugin?.addListener?.('appUrlOpen', ({ url }) => { const a = addressFromLink(url); if (a) connect(a); });
  if (qs.get('connect')) return connect(qs.get('connect'));
  // "Switch server" in Hearth's menu comes back here
  if (qs.has('switch')) return home();
  // Opened by a link when the app wasn't running — only once, not every time this page reloads
  const launch = (await AppPlugin?.getLaunchUrl?.().catch(() => null))?.url;
  if (launch && sessionStorage.getItem('hearth.launchHandled') !== launch) {
    sessionStorage.setItem('hearth.launchHandled', launch);
    const a = addressFromLink(launch); if (a) return connect(a);
  }
  const last = servers.last();
  if (last) return connect(last.url);
  home();
}
start();
