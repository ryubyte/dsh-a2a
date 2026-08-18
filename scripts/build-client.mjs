#!/usr/bin/env node
/**
 * Wrap the browser client bundle for the DSH module loader.
 *
 * tsdown emits the client half as CJS (`lib/client.cjs`); the DSH web shell
 * loads browser plugins through `window.__ModuleLoader__.load({ id, factory })`
 * where `factory` receives the runtime `require`. This script wraps the CJS
 * body into that shape and writes `lib/client.js` (the file `exports["./client"]`
 * points at). The plugin id is read from package.json so it always matches the
 * published package name.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const cjsPath = join(root, 'lib', 'client.cjs');
const outPath = join(root, 'lib', 'client.js');

if (!existsSync(cjsPath)) {
  console.error(`[build-client] ${cjsPath} missing — run tsdown first`);
  process.exit(1);
}

const body = readFileSync(cjsPath, 'utf8');
const indented = body.split('\n').map((l) => (l.trim() ? '\t\t' + l : l)).join('\n');
const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: ' + JSON.stringify(pkg.name) + ',',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  indented,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n');

mkdirSync(join(root, 'lib'), { recursive: true });
writeFileSync(outPath, wrapped, 'utf8');
rmSync(cjsPath, { force: true });
console.log(`[build-client] wrote ${outPath} (id=${pkg.name}, ${wrapped.length} bytes)`);