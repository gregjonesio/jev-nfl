// Convert the odds bars from width animation to transform: scaleX (launch-night detector fix).
import fs from 'node:fs';
const p = new URL('../src/page.html', import.meta.url);
let s = fs.readFileSync(p, 'utf8');
const before = (s.match(/style="width:\$\{/g) || []).length;
s = s.replace(/style="width:\$\{([^}]*)\}%"/g, (m, expr) => `style="transform:scaleX(\${(${expr}) / 100})"`);
fs.writeFileSync(p, s);
console.log('replaced', before, 'remaining', (s.match(/style="width:\$\{/g) || []).length, 'scaleX', (s.match(/scaleX/g) || []).length);
