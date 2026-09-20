// Renders the Open Graph card (1200x630) to src/og.png in the page's own visual language.
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const root = new URL('../', import.meta.url);
const rp = (p) => new URL(p, root).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const W = 1200, H = 630;
// field strip: 100 yards between x=560 and x=1140, ball on the 38, first down at the 48
const X = y => 560 + y * 5.8;
const yardLines = [];
for (let y = 0; y <= 100; y += 5) yardLines.push(`<line x1="${X(y)}" y1="392" x2="${X(y)}" y2="560" stroke="${y % 10 === 0 ? '#3a5442' : '#2b3f31'}" stroke-width="1.5"/>`);
const nums = [];
for (let y = 10; y <= 90; y += 10) { const n = y <= 50 ? y : 100 - y; nums.push(`<text x="${X(y)}" y="420" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="16" fill="#5c7864">${n}</text><text x="${X(y)}" y="548" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="16" fill="#5c7864">${n}</text>`); }
const los = X(38), fdl = X(48);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="-10%" r="80%"><stop offset="0" stop-color="#1a2e20"/><stop offset="1" stop-color="#0a0d0b"/></radialGradient>
    <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121d16"/><stop offset="1" stop-color="#0d1510"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="60" y="150" font-family="Barlow Condensed" font-weight="800" font-size="118" fill="#f2f4ee" letter-spacing="-1">JEV CALLS</text>
  <text x="60" y="262" font-family="Barlow Condensed" font-weight="800" font-size="118" fill="#f5d90a" letter-spacing="-1">THE PLAY</text>
  <text x="62" y="318" font-family="Barlow" font-weight="500" font-size="27" fill="#b9c1b4">A decision-only AI model calls run or pass before each NFL snap,</text>
  <text x="62" y="354" font-family="Barlow" font-weight="500" font-size="27" fill="#b9c1b4">and go, punt or kick on fourth down. Graded live against the coach.</text>

  <!-- latest-call panel -->
  <rect x="60" y="392" width="440" height="168" rx="12" fill="url(#turf)" stroke="#2e4034"/>
  <text x="84" y="426" font-family="Barlow Condensed" font-weight="800" font-size="17" fill="#f5d90a" letter-spacing="2">EVERY SNAP, A CALL</text>
  <text x="84" y="454" font-family="Barlow" font-weight="500" font-size="20" fill="#b9c1b4">3rd &amp; 4 at the 38 · Q4 2:11</text>
  <text x="84" y="540" font-family="Barlow Condensed" font-weight="800" font-size="92" fill="#f5d90a">PASS</text>
  <text x="318" y="540" font-family="Barlow Condensed" font-weight="800" font-size="30" fill="#b9c1b4">71% SURE</text>

  <!-- field -->
  <rect x="540" y="392" width="620" height="168" rx="10" fill="#0f1a13" stroke="#2e4034"/>
  <rect x="540" y="392" width="20" height="168" rx="10" fill="#16281c"/><rect x="1140" y="392" width="20" height="168" rx="10" fill="#16281c"/>
  ${yardLines.join('')}
  ${nums.join('')}
  <line x1="${fdl}" y1="392" x2="${fdl}" y2="560" stroke="#f5d90a" stroke-width="4"/>
  <line x1="${los}" y1="392" x2="${los}" y2="560" stroke="#6bb6ff" stroke-width="4"/>
  <ellipse cx="${los}" cy="476" rx="13" ry="8" fill="#c98b4a" stroke="#f2f4ee" stroke-width="1.5"/>
  <path d="M${los + 22} 468 L${los + 40} 476 L${los + 22} 484 Z" fill="#b9c1b4"/>

  <text x="60" y="600" font-family="Barlow Condensed" font-weight="800" font-size="22" fill="#8a9587" letter-spacing="2">JEV-NFL.GREGJONES.IO</text>
  <text x="1140" y="600" text-anchor="end" font-family="Barlow" font-weight="500" font-size="18" fill="#8a9587">Jev by TypeSafe AI · no wagering · not affiliated with the NFL</text>
</svg>`;

const r = new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { fontFiles: [rp('assets/fonts/BarlowCondensed-800.ttf'), rp('assets/fonts/Barlow-500.ttf')], loadSystemFonts: false, defaultFontFamily: 'Barlow' } });
const png = r.render().asPng();
fs.writeFileSync(rp('src/og.png'), png);
fs.writeFileSync(rp('assets/og.svg'), svg);
console.log('og.png', png.length, 'bytes');
