// Setup wizard: choose how to use Hearth, fill in the few details it needs, then watch it set itself up.
/* global hearth */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');
  const ico = (d) => `<span class="ico"><svg viewBox="0 0 24 24">${d}</svg></span>`;

  const MODES = {
    local: { title: 'Just me, on this computer', blurb: 'Private and simple. Hearth runs while the app is open.', icon: ico('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'), tag: 'Simplest' },
    'local-phone': { title: 'This computer and my phone', blurb: 'Your phone connects over home Wi-Fi. Hearth keeps running in the background.', icon: ico('<rect x="2" y="4" width="14" height="10" rx="2"/><rect x="17" y="8" width="5" height="11" rx="1.5"/><path d="M6 18h6"/>') },
    server: { title: 'Our household server', blurb: 'Always on and starts with the computer — for several people and phones.', icon: ico('<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.01M8 17.5h.01"/>') },
    remote: { title: 'Connect to an existing Hearth', blurb: 'Hearth already runs on another computer, a NAS, Docker or Home Assistant.', icon: ico('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>') },
    docker: { title: 'Install in Docker', blurb: 'Runs in a Docker container on this computer, restarting with Docker.', icon: ico('<path d="M3 13h18c-.5 4-4 7-9 7s-8-3-9-7z"/><path d="M6 13V9h3v4M9 13V9h3v4M12 13V9h3v4M9 9V6h3v3"/>') },
    homeassistant: { title: 'Install in Home Assistant', blurb: 'As an add-on, in the Home Assistant sidebar and app.', icon: ico('<path d="M3 11 12 4l9 7v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M12 20v-6M9 14l3-3 3 3"/>') },
  };

  let S = null;                  // app state from the main process
  let cfg = { mode: null };      // what the person chose
  let busy = false;

  const qs = new URLSearchParams(location.search);
  hearth.onPrefill((p) => { cfg = { ...cfg, ...p }; details(); });

  async function init() {
    S = await hearth.state();
    cfg = { mode: null, port: S.store.port || 8484, dataDir: S.store.dataDir || S.defaults.localData, dockerDir: S.store.dockerDir || S.defaults.dockerDir, ollamaUrl: S.store.ollamaUrl || '', startAtLogin: true, importLocal: true };
    if (qs.get('mode')) { cfg.mode = qs.get('mode'); cfg.url = qs.get('url') || ''; return details(); }
    choose();
  }

  // ---------------------------------------------------------------- 1. choose
  function choose() {
    const card = (k) => `<button class="card" data-mode="${k}">${MODES[k].icon}<h3>${MODES[k].title}</h3><p>${MODES[k].blurb}</p>${MODES[k].tag ? `<span class="tag">${MODES[k].tag}</span>` : ''}${S.store.setupDone && S.store.mode === k ? '<span class="tag">Current</span>' : ''}</button>`;
    app.innerHTML = `
      <div class="brand"><img src="icon.svg" alt=""><span>Hearth</span></div>
      <h1>${S.store.setupDone ? 'Change how you use Hearth' : 'Welcome to Hearth'}</h1>
      <p class="lead">How would you like to use it? You can change this later from the Hearth menu.</p>
      <h2>On this computer</h2>
      <div class="cards">${['local', 'local-phone', 'server'].map(card).join('')}</div>
      <h2>Somewhere else</h2>
      <div class="cards">${['remote', 'docker', 'homeassistant'].map(card).join('')}</div>
      <div class="footer"><span class="small muted">Hearth ${esc(S.version)} · everything stays on your own devices</span><button class="btn ghost" id="cancel">${S.store.setupDone ? 'Cancel' : 'Quit'}</button></div>`;
    app.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { cfg.mode = b.dataset.mode; details(); }; });
    $('#cancel').onclick = () => hearth.cancel();
  }

  // ---------------------------------------------------------------- 2. details
  const folderField = (key, label, help) => `<div class="field"><span>${label}</span><div class="row"><code class="grow" id="${key}-show">${esc(cfg[key])}</code><button class="btn soft small" data-folder="${key}">Change…</button></div>${help ? `<span class="small muted">${help}</span>` : ''}</div>`;
  const portField = () => `<details><summary>More options</summary><div class="field"><span>Port</span><input type="number" id="port" min="1024" max="65535" value="${esc(cfg.port)}" style="max-width:140px"><span class="small muted">The network port Hearth uses. 8484 unless something else already uses it.</span></div></details>`;
  const aiField = () => `<div class="field"><span>Local AI (optional)</span><div id="ai" class="note"><span class="spin"></span> Looking for Ollama on this computer…</div></div>`;

  function details() {
    const m = cfg.mode; const M = MODES[m];
    let body = '';
    if (m === 'local' || m === 'local-phone') {
      body = `<div class="panel">
        ${folderField('dataDir', 'Where Hearth keeps your data', 'Back up this folder (it includes the key that protects your bank and email logins).')}
        ${m === 'local-phone' ? `<label class="check"><input type="checkbox" id="login" ${cfg.startAtLogin ? 'checked' : ''}><span>Start Hearth when I log in<br><span class="small muted">So your phone can reach it whenever this computer is on.</span></span></label>
          <div class="note warn small">Your phone needs to be on the same Wi-Fi as this computer. ${S.platform === 'win32' ? 'Windows may ask whether Hearth can use the network — choose <b>Allow</b> for private networks.' : S.platform === 'darwin' ? 'If your Mac asks whether Hearth may accept incoming connections, choose <b>Allow</b>.' : ''}</div>` : ''}
        ${aiField()}${portField()}</div>`;
    } else if (m === 'server') {
      body = `<div class="panel">
        <p>Hearth is installed as a background service: it starts with the computer — even before anyone logs in — and serves everyone in your household on their own phones and computers.</p>
        <div class="field"><span>Data folder</span><code>${esc(S.defaults.systemData)}</code></div>
        ${S.hasLocalData ? `<label class="check"><input type="checkbox" id="import" ${cfg.importLocal ? 'checked' : ''}><span>Bring over the Hearth data already on this computer</span></label>` : ''}
        <div class="note warn small">Your computer will ask for an administrator password. ${S.platform === 'linux' && S.appImage ? 'For a server that stays up to date we recommend the .deb or .rpm package rather than the AppImage.' : ''} Keep the computer switched on (and set it not to sleep) so phones can reach Hearth.</div>
        ${aiField()}${portField()}</div>`;
    } else if (m === 'remote') {
      body = `<div class="panel">
        <div class="field"><span>Hearth's address</span><div class="row"><input class="grow" type="url" id="url" placeholder="http://192.168.1.20:8484" value="${esc(cfg.url || '')}"><button class="btn soft" id="test">Test</button></div>
        <span class="small muted">On the computer running Hearth, open <b>Settings → Phones &amp; devices</b> to see its address. For the Home Assistant add-on, set a port on the add-on's Configuration tab first.</span></div>
        <div id="result"></div></div>`;
    } else if (m === 'docker') {
      body = `<div class="panel"><div id="docker" class="note"><span class="spin"></span> Checking Docker…</div>
        ${folderField('dockerDir', 'Docker folder', 'The compose file and your data (in data/) are kept here.')}
        ${aiField()}${portField()}</div>`;
    } else if (m === 'homeassistant') {
      body = `<div class="panel">
        <div class="field"><span>Home Assistant address</span><input type="url" id="haUrl" placeholder="http://homeassistant.local:8123" value="${esc(cfg.haUrl || '')}"></div>
        <div class="field"><span>Long-lived access token</span><textarea id="haToken" placeholder="eyJhbGciOi…" spellcheck="false">${esc(cfg.haToken || '')}</textarea>
          <details><summary>How do I get a token?</summary><ol class="steps"><li>Open Home Assistant and sign in as an administrator.</li><li>Click your name at the bottom of the sidebar, then the <b>Security</b> tab.</li><li>Under <b>Long-lived access tokens</b> choose <b>Create token</b>, name it "Hearth installer" and copy it.</li><li>Paste it here. Hearth uses it once to install the add-on and doesn't keep it — you can delete the token afterwards.</li></ol></details></div>
        <div class="row"><button class="btn soft" id="test">Test connection</button><span id="result" class="grow"></span></div>
        <p class="small muted" style="margin-top:14px">Needs Home Assistant OS or Supervised (with the add-on store). Prefer to do it yourself? <button class="link" id="mylink">Add the repository in Home Assistant</button>.</p></div>`;
    }
    app.innerHTML = `<div class="brand"><img src="icon.svg" alt=""><span>Hearth</span></div>
      <h1>${M.title}</h1><p class="lead">${M.blurb}</p>${body}
      <div class="footer"><button class="btn ghost" id="back">← Back</button><button class="btn" id="go">${m === 'remote' ? 'Connect' : m === 'homeassistant' ? 'Install in Home Assistant' : 'Set up Hearth'}</button></div>`;

    $('#back').onclick = choose;
    $('#go').onclick = apply;
    app.querySelectorAll('[data-folder]').forEach((b) => { b.onclick = async () => { const k = b.dataset.folder; const f = await hearth.chooseFolder(cfg[k]); if (f) { cfg[k] = f; $(`#${k}-show`).textContent = f; } }; });
    $('#login')?.addEventListener('change', (e) => { cfg.startAtLogin = e.target.checked; });
    $('#import')?.addEventListener('change', (e) => { cfg.importLocal = e.target.checked; });
    if ($('#ai')) detectAi();
    if (m === 'docker') checkDocker();
    if (m === 'remote') { $('#test').onclick = testRemote; if (cfg.url) testRemote(); }
    if (m === 'homeassistant') { $('#test').onclick = testHa; $('#mylink').onclick = () => hearth.openExternal('https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fshotgn16%2Fhearth'); }
  }

  async function detectAi() {
    const r = await hearth.detectOllama();
    const el = $('#ai'); if (!el) return;
    if (r.found) { cfg.ollamaUrl = r.url; el.className = 'note ok'; el.innerHTML = `Found Ollama ${esc(r.version)} on this computer — Hearth will use it.`; }
    else { el.className = 'note small'; el.innerHTML = 'Ollama isn\'t running on this computer. That\'s fine — Hearth works without it, and you can point it at Ollama on another machine later in <b>Settings → Local AI</b>.'; }
  }

  async function checkDocker() {
    const r = await hearth.dockerCheck(); const el = $('#docker'); if (!el) return;
    if (r.ok) { el.className = 'note ok'; el.textContent = `Docker ${r.version} is ready.`; $('#go').disabled = false; }
    else {
      el.className = 'note bad'; $('#go').disabled = true;
      el.innerHTML = `${esc(r.problem)} <div class="row" style="margin-top:8px"><button class="btn soft small" id="getdocker">Get Docker</button><button class="btn soft small" id="recheck">Check again</button></div>`;
      $('#getdocker').onclick = () => hearth.openExternal(S.platform === 'linux' ? 'https://docs.docker.com/engine/install/' : 'https://www.docker.com/products/docker-desktop/');
      $('#recheck').onclick = () => { el.className = 'note'; el.innerHTML = '<span class="spin"></span> Checking Docker…'; checkDocker(); };
    }
  }

  async function testRemote() {
    cfg.url = $('#url').value.trim(); const el = $('#result');
    el.innerHTML = '<div class="note"><span class="spin"></span> Looking for Hearth…</div>';
    const r = await hearth.testRemote(cfg.url);
    el.innerHTML = r.ok ? `<div class="note ok">Found Hearth ${esc(r.version)} at ${esc(r.url)}.${r.needsSetup ? ' It hasn\'t been set up yet — you\'ll create the household next.' : ''}</div>` : `<div class="note bad">${esc(r.error)}</div>`;
    return r.ok;
  }

  async function testHa() {
    cfg.haUrl = $('#haUrl').value.trim(); cfg.haToken = $('#haToken').value.trim(); const el = $('#result');
    el.innerHTML = '<span class="spin"></span>';
    const r = await hearth.testHomeAssistant(cfg.haUrl, cfg.haToken);
    el.innerHTML = r.ok ? (r.addons === false ? `<span style="color:var(--red)">Home Assistant ${esc(r.version)} has no add-on store (Container or Core install) — choose Docker instead.</span>` : `<span style="color:var(--green)">✓ Connected to Home Assistant ${esc(r.version)}</span>`) : `<span style="color:var(--red)">${esc(r.error)}</span>`;
    return r.ok && r.addons !== false;
  }

  // ---------------------------------------------------------------- 3. working
  async function apply() {
    if (busy) return;
    const port = $('#port'); if (port) cfg.port = Number(port.value) || 8484;
    if (cfg.mode === 'remote') { cfg.url = $('#url').value.trim(); if (!cfg.url) return $('#url').focus(); }
    if (cfg.mode === 'homeassistant') { cfg.haUrl = $('#haUrl').value.trim(); cfg.haToken = $('#haToken').value.trim(); if (!cfg.haUrl || !cfg.haToken) return (cfg.haUrl ? $('#haToken') : $('#haUrl')).focus(); }
    busy = true;
    app.innerHTML = `<div class="brand"><img src="icon.svg" alt=""><span>Hearth</span></div>
      <h1>Setting up Hearth</h1><p class="lead">${esc(MODES[cfg.mode].title)}</p>
      <div class="panel"><ul class="log" id="log"><li class="step"><span class="i"><span class="spin"></span></span><span>Getting started…</span></li></ul></div>
      <div class="footer"><span></span><span class="small muted">This can take a minute.</span></div>`;
    const log = $('#log');
    const add = (ev) => {
      log.querySelectorAll('.step .spin').forEach((s) => { s.parentElement.textContent = '✓'; s.closest('li').className = 'ok'; });
      const icon = { step: '<span class="spin"></span>', ok: '✓', warn: '!', error: '✗', info: '·' }[ev.type] || '·';
      log.insertAdjacentHTML('beforeend', `<li class="${esc(ev.type)}"><span class="i">${icon}</span><span>${esc(ev.message)}</span></li>`);
    };
    log.innerHTML = '';
    hearth.onProgress(add);
    const res = await hearth.apply({ ...cfg });
    busy = false;
    log.querySelectorAll('.spin').forEach((s) => { s.parentElement.textContent = res.ok ? '✓' : '·'; });
    if (!res.ok) {
      add({ type: 'error', message: res.error });
      app.querySelector('.footer').innerHTML = '<button class="btn ghost" id="back">← Back</button><button class="btn" id="again">Try again</button>';
      $('#back').onclick = details; $('#again').onclick = apply;
      return;
    }
    done(res);
  }

  // ---------------------------------------------------------------- 4. done
  function done(res) {
    const m = cfg.mode;
    const addrs = (res.addresses || []).filter((a) => a.label !== 'virtual network');
    const phone = ['local-phone', 'server', 'docker'].includes(m);
    app.innerHTML = `<div class="brand"><img src="icon.svg" alt=""><span>Hearth</span></div>
      <div class="big-ok">✓</div>
      <h1>${m === 'homeassistant' ? 'Hearth is installed in Home Assistant' : m === 'remote' ? 'Connected' : 'Hearth is ready'}</h1>
      <p class="lead">${m === 'homeassistant' ? 'It\'s in the Home Assistant sidebar and app. This window will open it — sign in to Home Assistant if asked.'
        : res.needsSetup ? 'Next, create your household: your name, email and a password.' : 'Your household is ready to use.'}</p>
      ${phone && addrs.length ? `<div class="panel"><h3>Your phones</h3><p class="small muted">On the same Wi-Fi, phones can use the Hearth app or a browser with:</p>
        ${addrs.map((a) => `<div class="addr"><code>${esc(a.url)}</code><span class="small muted">${esc(a.label)}</span></div>`).join('')}
        <p class="small muted" style="margin:10px 0 0">In Hearth, <b>Settings → Phones &amp; devices</b> shows a QR code that connects the phone app in one step.</p></div>` : ''}
      ${m === 'server' ? '<div class="note small">The household server runs on its own — you can close this app and Hearth keeps serving your household.</div>' : ''}
      <div class="footer"><span></span><button class="btn" id="open">Open Hearth</button></div>`;
    $('#open').onclick = () => hearth.finish();
  }

  init();
})();
