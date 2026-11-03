#!/usr/bin/env node
// Used in a disposable CI checkout. Install afterwards with
// `pnpm install --no-frozen-lockfile`; the committed lock stays the rc.5 baseline.
import { readFileSync, writeFileSync } from 'node:fs';

const manifestUrl = new URL('../package.json', import.meta.url);
const versions = JSON.parse(readFileSync(new URL('./dsh-versions.json', import.meta.url), 'utf8'));
const version = process.argv[2];
if (!versions.includes(version)) throw new Error(`Unsupported DSH version: ${version}`);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
for (const name of Object.keys(manifest.devDependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) manifest.devDependencies[name] = version;
}
writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Selected DSH ${version}`);
