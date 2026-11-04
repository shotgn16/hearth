// "Can't reach Hearth": explain what might be wrong for the chosen setup.
const q = new URLSearchParams(location.search);
const mode = q.get('mode');
document.getElementById('url').textContent = q.get('url') || '—';
document.getElementById('reason').textContent = q.get('reason') ? `Details: ${q.get('reason')}` : '';
const tips = {
  local: ['Hearth runs inside this app. Try again, or open the log folder from the Hearth menu to see what went wrong.'],
  'local-phone': ['Hearth runs inside this app. Try again, or open the log folder from the Hearth menu to see what went wrong.'],
  server: ['The household service may still be starting — wait a moment and try again.', 'Restart the computer, or reinstall the service with Change setup… → Our household server.'],
  remote: ['Check that the computer running Hearth is switched on and awake.', 'Make sure this computer is on the same network (or VPN) as that one.'],
  docker: ['Make sure Docker Desktop (or the Docker service) is running.', 'Run "docker compose up -d" in your Hearth Docker folder.'],
  homeassistant: ['Check Home Assistant is running and that the Hearth add-on is started.'],
}[mode] || [];
document.getElementById('lead').textContent = mode === 'remote' ? 'The Hearth you connected to didn\'t answer.' : 'Hearth didn\'t answer.';
document.getElementById('tips').innerHTML = tips.map((t) => `<li>${t.replace(/[<>&]/g, '')}</li>`).join('');
