#!/usr/bin/env node
// Scans the Next.js build output for server secrets that leaked into client bundles.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(root, '.next', 'static');
const SECRET_ENV = ['JWT_SECRET', 'DATABASE_URL', 'DATABASE_ADMIN_URL', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN'];

const values = SECRET_ENV.map((k) => process.env[k]).filter((v) => v && v.length >= 12);

for (const key of Object.keys(process.env)) {
  if (key.startsWith('NEXT_PUBLIC_') && /SECRET|TOKEN|PASSWORD|DATABASE/.test(key)) {
    console.error(`Refusing: ${key} looks like a secret but is exposed to the browser.`);
    process.exit(1);
  }
}

async function* walk(dir) {
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) yield* walk(full);
    else if (/\.(js|css|html|json)$/.test(entry)) yield full;
  }
}

try {
  await stat(staticDir);
} catch {
  console.error('No .next/static directory. Run `pnpm build` first.');
  process.exit(1);
}

let scanned = 0;
for await (const file of walk(staticDir)) {
  scanned += 1;
  const text = await readFile(file, 'utf8');
  for (const v of values) {
    if (text.includes(v)) {
      console.error(`Secret value found in client bundle: ${path.relative(root, file)}`);
      process.exit(1);
    }
  }
}
console.log(`Secret scan passed: ${scanned} files, ${values.length} secret values checked.`);
