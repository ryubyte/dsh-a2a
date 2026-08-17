#!/usr/bin/env node
/**
 * Build the DSH browser client bundle for dsh-a2a.
 *
 * Produces `lib/client.js` in the format the DSH client-modules loader
 * expects: `window.__ModuleLoader__.load({ id, factory })` where `factory`
 * receives the runtime `require`. Everything except react is treated as an
 * external provided by the runtime (any `@deepseek-ai/*` import is a client
 * runtime service / type-only import and must NOT be inlined — the loader
 * resolves them by package name).
 *
 * CSS/module CSS is intentionally avoided: the dashboard uses inline styles
 * so the bundle stays dependency-free beyond react.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// NOTE: must NOT be `lib/client.js` — that file is tsc's Node-side A2AClient
// module. The browser bundle lives next to it under a distinct name and is
// wired through exports["./client"] (the dsh-client-modules loader resolves
// the bundle path from that export).
const outfile = join(root, 'lib', 'client.bundle.js');

mkdirSync(join(root, 'lib'), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src', 'client', 'index.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  // Everything under @deepseek-ai/* is a client-runtime service: the loader
  // resolves these by package name (type-only imports vanish at compile time,
  // value imports are externalized).
  plugins: [{
    name: 'external-dsh',
    setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\// }, () => ({ path: 'external', external: true }));
    },
  }],
  jsx: 'transform',
  minify: false,
  sourcemap: false,
  logLevel: 'warning',
});

const body = result.outputFiles[0].text;

// 1. Drop the esbuild IIFE wrapper `"use strict";\n(() => { ... })();`
//    — we need only the factory body.
const inner = body
  .replace(/^["']use strict["'];\s*\(\(\) => \{/, '')
  .replace(/\}\)\(\);?\s*$/, '')
  .trim();

const bundle = `window.__ModuleLoader__.load({
\tid: "dsh-a2a",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${indent(inner, 2)}
\t\texports.inject = inject;
\t\texports.apply = apply;
\t\treturn module.exports;
\t}
});
`;

function indent(text, n) {
  const pad = '\t'.repeat(n);
  return text
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n');
}

// 2. Rewrite bare `import` of externals to `require()` calls. esbuild leaves
//    `import ... from "pkg"` statements in the outer scope for externals in
//    IIFE mode when `bundle` inlines them — check what actually happened:
//    with `bundle: true`, external imports appear as `var pkg = require("pkg")`
//    at the top in the IIFE wrapper. Since we stripped the wrapper, hoist
//    those requires: they reference `require` which the factory provides.
//    esbuild emits them as `require("react");`-style calls or assignments;
//    ensure top-level `require(` calls are valid inside the factory (they are).
await import('node:fs').then((fs) => fs.writeFileSync(outfile, bundle));
console.log(`client bundle → ${outfile} (${bundle.length} bytes)`);