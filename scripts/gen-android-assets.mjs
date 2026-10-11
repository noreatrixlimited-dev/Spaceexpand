// Renders the app icon and splash screens for Android from inline SVG/HTML.
// Usage: node scripts/gen-android-assets.mjs   (needs Playwright + Chromium available)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const res = `${root}/android/app/src/main/res`;
const font = readFileSync(`${root}/node_modules/@fontsource/fredoka/files/fredoka-latin-700-normal.woff2`).toString('base64');

const blob = (cx, cy, r) => `
  <ellipse cx="${cx}" cy="${cy + r * 0.95}" rx="${r * 0.8}" ry="${r * 0.14}" fill="rgba(74,54,84,0.18)"/>
  <ellipse cx="${cx - r * 0.42}" cy="${cy + r * 0.86}" rx="${r * 0.28}" ry="${r * 0.15}" fill="#7d62c9"/>
  <ellipse cx="${cx + r * 0.42}" cy="${cy + r * 0.86}" rx="${r * 0.28}" ry="${r * 0.15}" fill="#7d62c9"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${r * 1.05}" ry="${r}" fill="#a98bf0" stroke="#4a3654" stroke-width="${r * 0.07}"/>
  <ellipse cx="${cx - r * 0.35}" cy="${cy - r * 0.42}" rx="${r * 0.28}" ry="${r * 0.16}" fill="#fff" opacity="0.35"/>
  <ellipse cx="${cx}" cy="${cy + r * 0.35}" rx="${r * 0.55}" ry="${r * 0.4}" fill="#d6c7fa"/>
  <ellipse cx="${cx - r * 0.34}" cy="${cy - r * 0.12}" rx="${r * 0.2}" ry="${r * 0.25}" fill="#fff"/>
  <ellipse cx="${cx + r * 0.34}" cy="${cy - r * 0.12}" rx="${r * 0.2}" ry="${r * 0.25}" fill="#fff"/>
  <ellipse cx="${cx - r * 0.32}" cy="${cy - r * 0.08}" rx="${r * 0.12}" ry="${r * 0.16}" fill="#2b2033"/>
  <ellipse cx="${cx + r * 0.36}" cy="${cy - r * 0.08}" rx="${r * 0.12}" ry="${r * 0.16}" fill="#2b2033"/>
  <circle cx="${cx - r * 0.28}" cy="${cy - r * 0.14}" r="${r * 0.045}" fill="#fff"/>
  <circle cx="${cx + r * 0.4}" cy="${cy - r * 0.14}" r="${r * 0.045}" fill="#fff"/>
  <ellipse cx="${cx - r * 0.66}" cy="${cy + r * 0.12}" rx="${r * 0.13}" ry="${r * 0.08}" fill="#ff9eb5"/>
  <ellipse cx="${cx + r * 0.66}" cy="${cy + r * 0.12}" rx="${r * 0.13}" ry="${r * 0.08}" fill="#ff9eb5"/>
  <path d="M ${cx - r * 0.12} ${cy + r * 0.12} Q ${cx} ${cy + r * 0.26} ${cx + r * 0.12} ${cy + r * 0.12}" stroke="#2b2033" stroke-width="${r * 0.05}" fill="none" stroke-linecap="round"/>`;

const egg = (cx, cy, r) => `
  <ellipse cx="${cx}" cy="${cy}" rx="${r * 0.78}" ry="${r}" fill="#b4dcff" stroke="#4a3654" stroke-width="${r * 0.08}"/>
  <circle cx="${cx - r * 0.3}" cy="${cy - r * 0.35}" r="${r * 0.14}" fill="#5ab8ff"/>
  <circle cx="${cx + r * 0.32}" cy="${cy + r * 0.3}" r="${r * 0.12}" fill="#5ab8ff"/>
  <path d="M ${cx - r * 0.95} ${cy + r * 0.45} Q ${cx} ${cy + r * 1.25} ${cx + r * 0.95} ${cy + r * 0.45}" stroke="#b07a4a" stroke-width="${r * 0.32}" fill="none" stroke-linecap="round"/>
  <path d="M -50 -50" />
  <g transform="translate(${cx + r * 0.75} ${cy - r * 1.05}) scale(${r / 60})">
    <path d="M0 18 C -8 10 -22 4 -22 -6 C -22 -16 -8 -20 0 -10 C 8 -20 22 -16 22 -6 C 22 4 8 10 0 18Z" fill="#ff5d8f" stroke="#4a3654" stroke-width="4"/>
  </g>`;

const bg = (w, h) => `
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffc9d6"/><stop offset="0.55" stop-color="#ffe3c4"/><stop offset="1" stop-color="#c7ebff"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>`;

// 108-unit adaptive icon canvas; keep art inside the central 66 units.
const iconArt = (s) => `${blob(s * 0.44, s * 0.5, s * 0.17)}${egg(s * 0.67, s * 0.58, s * 0.085)}`;

function iconSvg(size, { background, shape }) {
  const art = shape === 'adaptive' ? iconArt(size) : iconArt(size * 1.25).replace(/^/, '');
  const inner = shape === 'adaptive' ? art : `<g transform="translate(${-size * 0.125} ${-size * 0.125})">${art}</g>`;
  const clip =
    shape === 'round'
      ? `<clipPath id="c"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></clipPath>`
      : shape === 'square'
        ? `<clipPath id="c"><rect width="${size}" height="${size}" rx="${size * 0.22}"/></clipPath>`
        : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${clip}<g ${clip ? 'clip-path="url(#c)"' : ''}>${background ? bg(size, size) : ''}${inner}</g></svg>`;
}

function splashHtml(w, h) {
  const m = Math.min(w, h);
  return `<html><head><style>
    @font-face { font-family: F; src: url(data:font/woff2;base64,${font}); }
    body { margin: 0; }
    .t { position: absolute; left: 0; right: 0; top: ${h / 2 + m * 0.2}px; text-align: center; font: 700 ${m * 0.11}px F; color: #4a3654; }
    .t span:nth-child(4n+1){color:#a98bf0}.t span:nth-child(4n+2){color:#ff7b7b}.t span:nth-child(4n+3){color:#5ab8ff}.t span:nth-child(4n){color:#4fd6a0}
  </style></head><body>
    <svg width="${w}" height="${h}" style="position:absolute">${bg(w, h)}${blob(w / 2 - m * 0.06, h / 2 - m * 0.06, m * 0.15)}${egg(w / 2 + m * 0.18, h / 2 + m * 0.0, m * 0.07)}</svg>
    <div class="t">${[...'Nestnappers'].map((c) => `<span>${c}</span>`).join('')}</div>
  </body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(html, w, h, path, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  if (html.startsWith('<html>')) await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  const legacy = Math.round(48 * k);
  const fg = Math.round(108 * k);
  await render(iconSvg(legacy, { background: true, shape: 'square' }), legacy, legacy, `${res}/mipmap-${d}/ic_launcher.png`, true);
  await render(iconSvg(legacy, { background: true, shape: 'round' }), legacy, legacy, `${res}/mipmap-${d}/ic_launcher_round.png`, true);
  await render(iconSvg(fg, { background: false, shape: 'adaptive' }), fg, fg, `${res}/mipmap-${d}/ic_launcher_foreground.png`, true);
}
const splashes = {
  'drawable': [480, 320],
  'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(splashes)) await render(splashHtml(w, h), w, h, `${res}/${dir}/splash.png`);
// Also a 512px store icon.
await render(iconSvg(512, { background: true, shape: 'square' }), 512, 512, `${root}/docs/icon-512.png`, true);
await browser.close();
console.log('assets written');
