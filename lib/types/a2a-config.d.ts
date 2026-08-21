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
import type { A2APluginConfig } from './index.js';
export declare const A2A_CONFIG_FILENAME = "a2a.json";
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
    /** Optional shared bearer token protecting the inbound /a2a endpoint. */
    authToken?: string;
    skills?: Array<{
        id: string;
        name: string;
        description: string;
        tags?: string[];
        examples?: string[];
    }>;
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
export declare function profileNameFromArgv(): string | undefined;
/**
 * Best-effort profile-name fallback for launchers that resolve a profile
 * WITHOUT writing `--profile` back into argv.
 *
 * The dsh `web` subcommand is a hardcoded alias for `--profile web`: the
 * launcher resolves the name internally and boots the web profile, but the
 * process argv keeps the original tokens (`node …/dsh web [flags]`) — there
 * is no `--profile` flag and no environment variable naming the profile. So
 * when {@link profileNameFromArgv} finds nothing, check whether the first
 * non-flag token after argv[0] is a known dsh subcommand alias:
 *
 *   - `web`            → boot profile `web` (alias, never followed by a name)
 *   - `--profile <n>`  → already handled above
 *   - anything else    → unknown/not a profile alias (e.g. `plugin`, which
 *                        is a management mode, not a boot; returns undefined)
 *
 * Returns undefined when argv carries no recognizable alias, letting the
 * caller fall through to the cwd-based resolution steps.
 */
export declare function profileNameFromDshAlias(): string | undefined;
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
 *      as named on the command line (most authoritative; works from ANY cwd).
 *      Also matches the `dsh web` alias, which boots profile `web` without
 *      writing `--profile` into argv.
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
export declare function resolveConfigPath(): string;
/** Read the persisted config (empty object when absent or unreadable). */
export declare function loadConfig(): PersistedA2AConfig;
/** Atomically write the persisted config (creates the directory when needed). */
export declare function saveConfig(config: PersistedA2AConfig): {
    ok: boolean;
    path: string;
    message?: string;
};
/**
 * Merge persisted config on top of the in-composition config, so the file
 * (UI-editable, survives restart) wins over static defaults.
 */
export declare function mergePersisted(base: A2APluginConfig, persisted: PersistedA2AConfig): A2APluginConfig;
//# sourceMappingURL=a2a-config.d.ts.map