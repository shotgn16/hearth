// Regenerates every app icon from server/web/icon.svg (desktop, tray, Android, iOS).
// Needs Playwright:  npx -y playwright@1 install chromium && node tools/make-icons.js
// Swap icon.svg for your own design and run this to rebrand all the apps.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(ROOT, 'server/web/icon.svg'), 'utf8');
// The tray glyph: the house and flame without the dark background, drawn in black (macOS "template" image)
const glyph = (color) => svg.replace(/<rect[^>]*\/>/, '').replace(/stroke="#edf1ec"/, `stroke="${color}"`).replace(/fill="#d9962b"/, `fill="${color}"`);

async function render(page, markup, size, out, { pad = 0, bg = 'transparent' } = {}) {
  const inner = size - pad * 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg}"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
    <div style="width:${inner}px;height:${inner}px">${markup.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></div></body></html>`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: size, height: size } });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const D = (p) => path.join(ROOT, 'desktop/build', p);
  await render(page, svg, 1024, D('icon.png'), { pad: 80 });
  await render(page, glyph('#000'), 16, D('trayTemplate.png'));
  await render(page, glyph('#000'), 32, D('trayTemplate@2x.png'));
  await render(page, svg, 32, D('tray.png'));
  await render(page, svg, 64, D('tray@2x.png'));
  // Mobile: one large square source; the Capacitor assets tool (or the scripts in mobile/) makes every size from it
  await render(page, svg.replace('rx="116"', 'rx="0"'), 1024, path.join(ROOT, 'mobile/assets/icon-only.png'));
  await render(page, svg.replace(/<rect[^>]*\/>/, ''), 1024, path.join(ROOT, 'mobile/assets/icon-foreground.png'), { pad: 200 }); // Android adaptive icon (keeps to the safe zone)
  await render(page, '<svg viewBox="0 0 1 1"><rect width="1" height="1" fill="#1f2e28"/></svg>', 1024, path.join(ROOT, 'mobile/assets/icon-background.png'));
  await render(page, svg, 2732, path.join(ROOT, 'mobile/assets/splash.png'), { pad: 1066, bg: '#1f2e28' });
  await render(page, svg, 2732, path.join(ROOT, 'mobile/assets/splash-dark.png'), { pad: 1066, bg: '#141c19' });
  await browser.close();
  console.log('Icons written to desktop/build and mobile/assets');
})();
