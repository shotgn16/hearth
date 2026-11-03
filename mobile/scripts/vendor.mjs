// Copies the few files the phone app's pages need into www/ (run automatically by "npm run sync"):
//   www/vendor/jsQR.js   reads QR codes from the camera, on the phone (MIT licence)
//   www/icon.svg         the Hearth icon, from the server's web app
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const vendor = path.join(MOBILE, 'www', 'vendor');
fs.mkdirSync(vendor, { recursive: true });
const jsqrDir = path.dirname(require.resolve('jsqr/package.json'));
fs.copyFileSync(path.join(jsqrDir, 'dist', 'jsQR.js'), path.join(vendor, 'jsQR.js'));
fs.copyFileSync(path.join(jsqrDir, 'LICENSE'), path.join(vendor, 'jsQR-LICENSE.txt'));
fs.copyFileSync(path.join(MOBILE, '..', 'server', 'web', 'icon.svg'), path.join(MOBILE, 'www', 'icon.svg'));
console.log('• www/vendor/jsQR.js and www/icon.svg ready');
