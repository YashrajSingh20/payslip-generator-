#!/usr/bin/env node
// Fails CI when a backend route handler does not start with a guard call.
// Mutating routes must call requirePermission / requireAnyPermission; read routes
// must at least call one of the guard methods. Public routes need an allowlist
// entry with a written reason.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const routesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'src', 'routes');

const PUBLIC_ROUTES = new Map([
  ['auth.js POST /send-otp', 'Sign-in step 1: the caller has no session yet'],
  ['auth.js POST /verify-otp', 'Sign-in step 2: the caller has no session yet'],
  ['auth.js POST /logout', 'Clearing a cookie needs no permission'],
  ['auth.js GET /me', 'Resolves the session itself and returns 401 when absent'],
]);

const ROUTE = /router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2\s*,\s*async\s*\(([^)]*)\)\s*=>\s*\{/g;
const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

const failures = [];
let checked = 0;

for (const file of (await readdir(routesDir)).filter((f) => f.endsWith('.js'))) {
  const source = await readFile(path.join(routesDir, file), 'utf8');
  for (const match of source.matchAll(ROUTE)) {
    checked += 1;
    const [, method, , routePath] = match;
    const id = `${file} ${method.toUpperCase()} ${routePath}`;
    if (PUBLIC_ROUTES.has(id)) continue;

    const body = source.slice(match.index + match[0].length);
    const firstStatement = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('//')) ?? '';
    const ok = MUTATING.has(method)
      ? /guard\.require(Any)?Permission\(/.test(firstStatement)
      : /guard\.require(User|Permission|AnyPermission)\(/.test(firstStatement);
    if (!ok) failures.push(`${id}\n    first statement: ${firstStatement}`);
  }
}

if (failures.length) {
  console.error(`Route guard check failed (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`Route guard check passed: ${checked} routes.`);
