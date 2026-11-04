#!/usr/bin/env node
// Sets Hearth's version everywhere it appears, so the server, desktop installers, phone apps and the
// Home Assistant add-on always match.
//
//   node tools/set-version.js 1.7.0       change it
//   node tools/set-version.js --check     fail if anything disagrees (the release workflow runs this)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

// [file, how to read the version, how to set it]
const json = (key = 'version') => [(s) => JSON.parse(s)[key], (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)];
const PLACES = [
  ['server/package.json', ...json()],
  ['server/package-lock.json', (s) => JSON.parse(s).version, (s, v) => {
    const o = JSON.parse(s); o.version = v; if (o.packages?.['']) o.packages[''].version = v; return `${JSON.stringify(o, null, 2)}\n`;
  }],
  ['desktop/package.json', ...json()],
  ['mobile/package.json', ...json()],
  ['mobile/capacitor.config.json', (s) => JSON.parse(s).appendUserAgent.split('/')[1], (s, v) => s.replace(/("appendUserAgent":\s*"HearthApp\/)[^"]+(")/, `$1${v}$2`)],
  ['hearth/config.yaml', (s) => s.match(/^version:\s*"?([^"\n]+)"?/m)[1], (s, v) => s.replace(/^version:.*$/m, `version: "${v}"`)],
  ['mobile/ios/App/App.xcodeproj/project.pbxproj', (s) => s.match(/MARKETING_VERSION = ([^;]+);/)[1], (s, v) => {
    const [a, b, c] = v.split(/[.-]/).map(Number);
    return s.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${v};`).replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${a * 10000 + b * 100 + c};`);
  }],
];

const arg = process.argv[2];
if (!arg || arg === '--check') {
  const found = PLACES.map(([f, get]) => [f, get(read(f))]);
  const versions = new Set(found.map(([, v]) => v));
  for (const [f, v] of found) console.log(`${v.padEnd(10)} ${f}`);
  if (versions.size !== 1) { console.error('\n✗ Versions disagree — run: node tools/set-version.js <version>'); process.exit(1); }
  console.log(`\n✓ Everything is ${[...versions][0]}`);
  process.exit(0);
}
if (!/^\d+\.\d+\.\d+$/.test(arg)) { console.error('Use a version like 1.7.0'); process.exit(1); }
for (const [f, , set] of PLACES) { write(f, set(read(f), arg)); console.log(`✓ ${f}`); }
console.log(`\nHearth is now ${arg}. Add a section to hearth/CHANGELOG.md, then commit and tag v${arg} to build a release.`);
