/**
 * Genera los iconos de la PWA a partir de un SVG embebido.
 * Uso: node scripts/make-icons.mjs
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";

const out = path.join(process.cwd(), "public");
fs.mkdirSync(out, { recursive: true });

function svg(size, { maskable = false } = {}) {
  const s = size;
  const r = maskable ? 0 : Math.round(s * 0.19);
  const contentScale = maskable ? 0.72 : 1; // zona segura del 80% central para maskable
  const fs0 = Math.round(s * 0.34 * contentScale);
  const cx = s / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e6fbd"/>
      <stop offset="100%" stop-color="#0a3557"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${r}" fill="url(#g)"/>
  <g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round"
     opacity="0.35" transform="translate(${cx} ${cx}) scale(${((s / 512) * contentScale).toFixed(4)}) translate(-256 -256)">
    <path d="M120 96 h160 a24 24 0 0 1 24 24 v272 a24 24 0 0 1 -24 24 H120 a24 24 0 0 1 -24 -24 V120 a24 24 0 0 1 24 -24 z" stroke-width="14"/>
    <path d="M140 200 h200 M140 260 h200 M140 320 h140" stroke-width="14"/>
  </g>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="Helvetica Neue, Arial, sans-serif" font-size="${fs0}"
        font-weight="700" letter-spacing="${Math.round(s * 0.02)}" fill="#ffffff">STE</text>
</svg>`);
}

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180 },
];

for (const t of targets) {
  await sharp(svg(t.size, { maskable: t.maskable })).png().toFile(path.join(out, t.file));
  console.log("generado", t.file);
}
