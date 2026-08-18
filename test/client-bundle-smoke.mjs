/**
 * Simulate the DSH browser module loader loading the dsh-a2a client bundle
 * and registering the settings section — without a real browser.
 *
 * Rendering the hooks component is left to the real browser; here we verify:
 *  - the bundle loads through the ModuleLoader contract
 *  - `apply` registers exactly one `settings.section` slot with id `a2a`
 *  - the component is a callable React component
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'lib', 'client.js'), 'utf8');

const react = require('react');

let passed = true;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) passed = false;
};

globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      const { name: pkgName } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      check('bundle id matches package.json', entry.id === pkgName, `id=${entry.id}`);
      const mod = entry.factory((id) => (id === 'react' ? react : require(id)));
      check('bundle exports apply', typeof mod.apply === 'function');
      check('bundle exports inject', Array.isArray(mod.inject) && mod.inject.includes('slots'));

      let count = 0;
      let savedOptions;
      let savedComponent;
      const ctx = {
        effect(fn) {
          const disposer = fn();
          return disposer;
        },
        slots: {
          register(options, component) {
            count += 1;
            savedOptions = options;
            savedComponent = component;
            return () => { count = 0; };
          },
        },
      };

      mod.apply(ctx);
      check('applies without throwing', true);
      check('registers exactly one slot', count === 1, `count=${count}`);
      check('slot id = a2a', savedOptions?.id === 'a2a');
      check('slot name = settings.section', savedOptions?.name === 'settings.section');
      check('slot label resolves', typeof savedOptions?.label?.() === 'string' && savedOptions.label().length > 0);
      check('component is a function', typeof savedComponent === 'function');
    },
  },
};

eval(src);

console.log(passed ? '\nCLIENT BUNDLE SIMULATION OK' : '\nCLIENT BUNDLE SIMULATION FAILED');
if (!passed) process.exitCode = 1;