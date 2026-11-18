#!/usr/bin/env node
// Turns flat-background logo images into trimmed transparent PNGs for the portal
// (public/brand) and the payslip PDF (backend/assets).
//   node scripts/prepare-brand-logos.mjs --keystone=path/to/keystone.png --liwip=path/to/liwip.png
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseArgs } from './lib/db-connection.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUTS = [path.join(root, 'public', 'brand'), path.join(root, 'backend', 'assets')];

// Pixels within NEAR of the background colour become transparent, beyond FAR stay
// opaque, and edges in between fade so there is no halo.
const NEAR = 14;
const FAR = 70;

/**
 * Crops to the box around strongly coloured pixels (plus padding). Used for the
 * Keystone mark, which arrives as a screenshot with stray page edges around it.
 */
async function cropToColour(input, pad = 4) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1] = [info.width, info.height, -1, -1];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * 4;
      const saturation = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      if (saturation > 90) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) return sharp(input).png().toBuffer();
  const left = Math.max(0, x0 - pad);
  const top = Math.max(0, y0 - pad);
  return sharp(input)
    .extract({ left, top, width: Math.min(info.width, x1 + pad + 1) - left, height: Math.min(info.height, y1 + pad + 1) - top })
    .png()
    .toBuffer();
}

async function keyOut(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = [data[0], data[1], data[2]]; // top-left corner is background
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
    const a = Math.min(1, Math.max(0, (d - NEAR) / (FAR - NEAR)));
    if (a === 0) {
      data[i + 3] = 0;
      continue;
    }
    // Remove the background's contribution from semi-transparent edge pixels.
    for (let c = 0; c < 3; c += 1) {
      data[i + c] = Math.min(255, Math.max(0, Math.round((data[i + c] - bg[c] * (1 - a)) / a)));
    }
    data[i + 3] = Math.round(a * (data[i + 3] ?? 255));
  }
  return sharp(data, { raw: info }).trim({ threshold: 1 }).png({ compressionLevel: 9 });
}

async function main() {
  const args = parseArgs();
  const jobs = [
    ['keystone', args.keystone, 'logo-keystone.png', true],
    ['liwip', args.liwip, 'logo-liwip-light.png', false],
  ].filter(([, src]) => typeof src === 'string');
  if (!jobs.length) throw new Error('Pass --keystone=<png> and/or --liwip=<png>');

  for (const dir of OUTPUTS) await mkdir(dir, { recursive: true });
  for (const [name, src, file, crop] of jobs) {
    const image = await keyOut(crop ? await cropToColour(src) : src);
    const buffer = await image.toBuffer();
    const meta = await sharp(buffer).metadata();
    for (const dir of OUTPUTS) await sharp(buffer).toFile(path.join(dir, file));
    console.log(`${name}: ${meta.width}x${meta.height} -> ${file}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
