// P14 — generate the PWA / app icons from one SVG (placeholder radar mark in the
// brand gradient, matching the OG image). Rasterized with sharp at the sizes a
// manifest + iOS need. Re-run after editing the SVG or swapping in real art:
//   node scripts/gen-icons.mjs
import sharp from "sharp";
import { writeFileSync } from "node:fs";

// Full-bleed square (works as both a normal and a maskable icon): the gradient
// reaches every edge and the "F" monogram sits inside the maskable safe zone
// (center ~60%). Vibrant indigo→violet brand gradient with a white geometric F
// (drawn as rects — no font dependency). 512 viewBox; sharp scales to each target.
const SVG = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g fill="#ffffff">
    <rect x="182" y="150" width="56" height="212" rx="14"/>
    <rect x="182" y="150" width="160" height="56" rx="14"/>
    <rect x="182" y="240" width="126" height="52" rx="14"/>
  </g>
</svg>`;

const buf = Buffer.from(SVG);
const targets = [
  [192, "public/icon-192.png"],
  [512, "public/icon-512.png"],
  [512, "public/icon-maskable-512.png"],
  [180, "src/app/apple-icon.png"], // Next app-icon convention → auto apple-touch-icon link
  [256, "src/app/icon.png"], // browser-tab favicon (PNG fallback for non-SVG browsers)
];

for (const [size, out] of targets) {
  await sharp(buf).resize(size, size).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}

// Scalable favicon — modern browsers prefer this over the PNG. Next links both
// (app/icon.svg + app/icon.png); the old default favicon.ico is removed.
writeFileSync("src/app/icon.svg", SVG);
console.log("wrote src/app/icon.svg");
