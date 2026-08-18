/**
 * dsh-a2a — persisted configuration (`a2a.json`).
 *
 * Runtime-editable configuration lives in a per-profile `a2a.json`, so the
 * plugin's UI changes survive restarts without touching the composition
 * (`cordis.patch.yml` / `package.json` stay pure entry points).
 *
 * File resolution order:
 *   1. `process.cwd()/a2a.json`            — profile dir when launched via `dsh --profile <x>`
 *   2. `~/.dsh/profiles/<cwd-basename>/a2a.json` — fallback when cwd is not the profile dir
 *   3. `$DSH_HOME/a2a.json`                — last-resort global location
 *
 * Shape (all fields optional):
 * {
 *   "mode": "both",                    // client | server | both (default both)
 *   "timeoutMs": 8000,                 // client global default (ms)
 *   "mapSkills": true,                 // per-skill tools vs one agent-wide tool
 *   "agents": [{ "name", "agentCardUrl", "bearerToken?", "timeoutMs?", "mapSkills?", "enabled?" }],
 *   "server": { "baseUrl"?, "agentName"?, "agentDescription"?, "agentVersion"?,
 *               "endpointPath"?, "skills"?: [{ "id","name","description"?, "tags"? }] },
 *   "dashboard": true
 * }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { A2APluginConfig } from './index.js';

export const A2A_CONFIG_FILENAME = 'a2a.json';

export interface PersistedAgentConfig {
  name: string;
  agentCardUrl: string;
  bearerToken?: string;
  timeoutMs?: number;
  mapSkills?: boolean;
  /** False disables the connection without removing the entry (default true). */
  enabled?: boolean;
}

export interface PersistedServerConfig {
  /** Explicitly enable the inbound server (default off). */
  enabled?: boolean;
  baseUrl?: string;
  agentName?: string;
  agentDescription?: string;
  agentVersion?: string;
  endpointPath?: string;
  skills?: Array<{ id: string; name: string; description: string; tags?: string[]; examples?: string[] }>;
}

export interface PersistedA2AConfig {
  mode?: 'client' | 'server' | 'both';
  timeoutMs?: number;
  mapSkills?: boolean;
  agents?: PersistedAgentConfig[];
  server?: PersistedServerConfig;
  dashboard?: boolean;
}

/**
 * Parse `--profile <name>` (or `--profile=<name>`) from the process argv.
 *
 * dsh keeps its launcher flags in the process command line (`node …/dsh
 * --profile a2a-test --port 3083`), so the active profile name is directly
 * observable no matter which directory the process was started from. This is
 * the most reliable way to locate the per-profile config — far better than
 * guessing from cwd's basename.
 */
export function profileNameFromArgv(): string | undefined {
  const argv = process.argv ?? [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile' && i + 1 < argv.length) {
      const v = argv[i + 1];
      if (v && !v.startsWith('-')) return v;
    } else if (a.startsWith('--profile=')) {
      const v = a.slice('--profile='.length);
      if (v) return v;
    }
  }
  return undefined;
}

/**
 * Resolve the a2a.json path for the current process, without depending on
 * the launch directory. The plugin must work no matter where `dsh` was
 * started from (dsh does NOT chdir into the profile directory), so this
 * prefers the profile named in argv (`--profile <name>`), then walks
 * outward from cwd, then falls back to the profile dir that matches cwd's
 * basename, then the harness home.
 *
 * Order:
 *   0. `$DSH_HOME/profiles/<argv --profile>/a2a.json` — the active profile
 *      as named on the command line (most authoritative; works from ANY cwd)
 *   1. `cwd/a2a.json` — explicit when launched inside a profile dir
 *   2. outward from cwd: the nearest ancestor holding `a2a.json` — covers
 *      launching from e.g. a repo checkout whose parent chain includes the
 *      profile, or any subdir of the profile
 *   3. `$DSH_HOME/profiles/<cwd-basename>/a2a.json` — started from the
 *      profile's *parent* (e.g. `~/.dsh/profiles`) or when the profile dir
 *      is cwd but the file hasn't been created yet
 *   4. `$DSH_HOME/a2a.json` — last-resort global location
 *
 * Writes always go to the *resolved* path (the one we read), so a config
 * loaded from any step is saved back to the same place, never re-resolved
 * to cwd.
 */
export function resolveConfigPath(): string {
  const cwd = process.cwd();
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const base = cwd.split(/[\\/]/).pop() ?? '';

  // 0. Active profile from argv — authoritative regardless of cwd.
  const profileName = profileNameFromArgv();
  if (profileName && profileName !== '.' && profileName !== '..' && !profileName.includes('/') && !profileName.includes('\\')) {
    const argvFile = join(home, 'profiles', profileName, A2A_CONFIG_FILENAME);
    if (existsSync(argvFile)) return argvFile;
  }

  // 1. cwd (most explicit).
  const cwdFile = join(cwd, A2A_CONFIG_FILENAME);
  if (existsSync(cwdFile)) return cwdFile;

  // 2. Nearest ancestor of cwd holding an a2a.json (walk upward, max 12 levels).
  let dir = cwd;
  for (let i = 0; i < 12; i++) {
    const up = join(dir, A2A_CONFIG_FILENAME);
    if (existsSync(up)) return up;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 3. Profile dir matching cwd's basename (started from profiles/ or home).
  const profileFile = join(home, 'profiles', base, A2A_CONFIG_FILENAME);
  if (base && existsSync(profileFile)) return profileFile;

  // 4. Global fallback.
  const globalFile = join(home, A2A_CONFIG_FILENAME);
  if (existsSync(globalFile)) return globalFile;

  // Nothing exists yet: prefer writing to cwd (an explicitly cd'd profile
  // dir or a repo that wants its config local); the profile fallback is next.
  return cwdFile;
}

/** Read the persisted config (empty object when absent or unreadable). */
export function loadConfig(): PersistedA2AConfig {
  const path = resolveConfigPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as PersistedA2AConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error(`[a2a] failed to read ${path}: ${(err as Error).message}`);
    return {};
  }
}

/** Atomically write the persisted config (creates the directory when needed). */
export function saveConfig(config: PersistedA2AConfig): { ok: boolean; path: string; message?: string } {
  const path = resolveConfigPath();
  try {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
    // rename is atomic on POSIX; write then move avoids torn reads.
    renameSync(tmp, path);
    return { ok: true, path };
  } catch (err) {
    return { ok: false, path, message: (err as Error).message };
  }
}

/**
 * Merge persisted config on top of the in-composition config, so the file
 * (UI-editable, survives restart) wins over static defaults.
 */
export function mergePersisted(base: A2APluginConfig, persisted: PersistedA2AConfig): A2APluginConfig {
  const merged: A2APluginConfig = { ...base };
  if (persisted.mode) merged.mode = persisted.mode;
  if (persisted.timeoutMs !== undefined) merged.timeoutMs = persisted.timeoutMs;
  if (persisted.mapSkills !== undefined) merged.mapSkills = persisted.mapSkills;
  if (persisted.dashboard !== undefined) merged.dashboard = persisted.dashboard;

  const pServer = persisted.server;
  if (pServer) {
    if (pServer.enabled !== undefined) merged.serverEnabled = pServer.enabled;
    if (pServer.baseUrl) merged.baseUrl = pServer.baseUrl;
    if (pServer.agentName) merged.agentName = pServer.agentName;
    if (pServer.agentDescription) merged.agentDescription = pServer.agentDescription;
    if (pServer.agentVersion) merged.agentVersion = pServer.agentVersion;
    if (pServer.endpointPath) merged.endpointPath = pServer.endpointPath;
    if (pServer.skills) merged.skills = pServer.skills;
  }
  return merged;
}