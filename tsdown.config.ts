import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    // Host half: ESM for the Node host process (flat output like tsc did).
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: false,
  },
  {
    // Client half: CJS for the browser module loader, wrapped into
    // __ModuleLoader__ format by scripts/build-client.mjs.
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: false,
    platform: 'browser',
  },
])