/**
 * dsh-a2a — persisted-config resolution tests (a2a-config.ts).
 *
 * These cover the `dsh web` launcher-alias problem: `dsh web` boots profile
 * `web` WITHOUT putting `--profile web` into process.argv, so the resolver
 * must recognize the alias, not just the `--profile` flag.
 *
 * All tests run SERIALLY (concurrency: false) because they mutate shared
 * process state (argv / DSH_HOME / cwd): node:test runs sibling tests in
 * parallel by default, which would interleave those mutations.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { profileNameFromArgv, profileNameFromDshAlias, resolveConfigPath } from '../src/a2a-config.js';

const savedArgv = process.argv;
const savedHome = process.env.DSH_HOME;
const savedCwd = process.cwd();

describe('a2a-config profile resolution', { concurrency: false }, () => {
  test.after(() => {
    process.argv = savedArgv;
    if (savedHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = savedHome;
    process.chdir(savedCwd);
  });

  test('profileNameFromArgv finds --profile <name> and --profile=<name>', () => {
    process.argv = ['node', 'dsh', '--profile', 'web', '--port', '3080'];
    assert.equal(profileNameFromArgv(), 'web');

    process.argv = ['node', 'dsh', '--profile=a2a-test'];
    assert.equal(profileNameFromArgv(), 'a2a-test');

    // The `dsh web` alias form carries NO --profile flag at all.
    process.argv = ['node', 'dsh', 'web'];
    assert.equal(profileNameFromArgv(), undefined);
  });

  test('profileNameFromDshAlias recognizes the dsh web subcommand alias', () => {
    process.argv = ['node', '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web'];
    assert.equal(profileNameFromDshAlias(), 'web');

    // A real `--profile` invocation is NOT an alias (already handled elsewhere).
    process.argv = ['node', 'dsh', '--profile', 'web'];
    assert.equal(profileNameFromDshAlias(), undefined);

    // Unknown first positionals (e.g. a headless run isn't a bare alias) — no match.
    process.argv = ['node', 'dsh', 'headless', 'run the tests'];
    assert.equal(profileNameFromDshAlias(), undefined);

    // The dsh launcher rejects parent flags before a subcommand, so a `web`
    // later in argv is an app argument, not a profile alias.
    process.argv = ['node', 'dsh', '--patch', './x.yml', 'web'];
    assert.equal(profileNameFromDshAlias(), undefined);
  });

  test('resolveConfigPath hits the web profile dir when launched via `dsh web`', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-a2a-web-'));
    const profileDir = join(home, 'profiles', 'web');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'a2a.json'), '{}');

    process.env.DSH_HOME = home;
    process.chdir(tmpdir()); // deliberately NOT inside the profile dir
    process.argv = ['node', '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web'];

    assert.equal(resolveConfigPath(), join(profileDir, 'a2a.json'));
  });

  test('resolveConfigPath prefers the explicit --profile name over the alias', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-a2a-both-'));
    for (const name of ['web', 'custom']) {
      const dir = join(home, 'profiles', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'a2a.json'), '{}');
    }

    process.env.DSH_HOME = home;
    process.chdir(tmpdir());
    process.argv = ['node', 'dsh', '--profile', 'custom', 'web']; // --profile wins

    assert.equal(resolveConfigPath(), join(home, 'profiles', 'custom', 'a2a.json'));
  });
});