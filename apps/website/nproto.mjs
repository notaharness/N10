import { chromium } from 'playwright';
import fs from 'fs';
const fit = JSON.parse(
  fs.readFileSync(
    '/tmp/claude-1000/-home-hermann-Documents-Code-Personal-kirby--claude-worktrees-feature-website/df496006-cdac-42bb-a812-caa1d70b60d8/scratchpad/fit.json',
    'utf8'
  )
);
const SAGE = '#9caf88',
  SAND = '#e3c16f',
  C = 48;
const cur =
  '<rect x="0" y="25" width="25" height="75"/><path d="M0,100 V62.5 A37.5,37.5 0 0 1 75,62.5 V100 H50 V62.5 A12.5,12.5 0 0 0 25,62.5 V100 Z"/>';
const ns = {
  'B geist on module': '<path d="' + fit.B + '"/>',
  'C drawn on module': '<path d="' + fit.C + '"/>',
  'D drawn, tighter': '<path d="' + fit.D + '"/>',
};
let html = '';
let i = 0;
for (const [name, n] of Object.entries(ns)) {
  for (const split of [0, 1]) {
    const tx = 62.5 + (split ? 37.5 : 0),
      zx = split ? 12.5 : 0;
    html += `<svg style="position:absolute;left:${C * (1 + split * 10)}px;top:${
      C * (1 + i * 6)
    }px;overflow:visible;isolation:isolate" width="${7 * C}" height="${
      4 * C
    }" viewBox="0 0 175 100">
    <g fill="${SAGE}" style="mix-blend-mode:multiply">${n}</g>
    <g transform="translate(${tx} 0)" fill="${SAND}" style="mix-blend-mode:multiply"><rect width="25" height="100"/><rect transform="translate(${zx} 0)" x="50" y="12.5" width="50" height="75" rx="25" fill="none" stroke="${SAND}" stroke-width="25"/></g></svg>
    <div style="position:absolute;left:${C * 1}px;top:${
      C * (5.2 + i * 6)
    }px;font:14px sans-serif">${name}</div>`;
  }
  i++;
}
const b = await chromium.launch();
const p = await b.newPage({
  viewport: { width: C * 21, height: C * 19 },
  deviceScaleFactor: 1.5,
});
await p.setContent(
  `<body style="margin:0;background:#faf9f5;background-image:linear-gradient(to right,rgba(110,100,70,.18) 1px,transparent 1px),linear-gradient(to bottom,rgba(110,100,70,.18) 1px,transparent 1px);background-size:${C}px ${C}px;background-position:-1px -1px">${html}</body>`
);
await p.screenshot({
  path: '/tmp/claude-1000/-home-hermann-Documents-Code-Personal-kirby--claude-worktrees-feature-website/df496006-cdac-42bb-a812-caa1d70b60d8/scratchpad/nproto.png',
});
await b.close();
