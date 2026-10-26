// Renders the PNG icons iOS/Android/Windows need from the two SVG sources.
// Run with: npm run icons
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const rounded = at('../public/favicon.svg');
const full = at('../icons/icon-full.svg');

const jobs = [
  [rounded, 192, 'pwa-192x192.png'],
  [rounded, 512, 'pwa-512x512.png'],
  [full, 512, 'maskable-512x512.png'],
  [full, 180, 'apple-touch-icon-180x180.png'],
];

for (const [src, size, name] of jobs) {
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(at(`../public/${name}`));
  console.log('wrote', name);
}
