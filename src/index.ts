/**
 * dsh-a2a — Cordis plugin entry point for DeepSeek Harness.
 *
 * Mounts the A2A plugin inside a DSH composition. The plugin is
 * configuration-driven and opportunistically consumes DSH services:
 *
 *   mode: 'client'  — fetch a remote AgentCard, register each skill as a
 *                     model tool on `ctx.tools` (name `a2a__<name>__<skill>`).
 *   mode: 'server'  — expose this DSH as an A2A agent: AgentCard +
 *                     JSON-RPC endpoint on `ctx.webServer` (when mounted).
 *
 * Both modes feed a connection dashboard (see `dashboard.ts`) exposed at
 * `/a2a/api` (state snapshot + reconnect/close controls), so the settings
 * panel can show "who is connected to us" (inbound) and "who we are
 * connected to" (outbound).
 *
 * Service access follows the native DSH pattern: services are declared via
 * module augmentation and read as context properties inside `ctx.effect(...)`,
 * so Cordis waits for availability and disposes registrations with the fiber.
 * The plugin stays mounted in compositions that lack a service (it logs and
 * idles); it never hard-depends on one.
 */

import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { registerAgentTools } from './outbound.js';
import { fetchAgentCard, pickInterface } from './card.js';
import { A2AServer, type ServerOptions, createDshAgentExecutor, type AgentRegistryLike } from './server.js';
import { TaskStore } from './server.js';
import type { AgentPresetsLike } from './server.js';
import { getSharedRegistry } from './dashboard.js';
import {
  loadConfig as loadPersistedA2A,
  saveConfig as savePersistedA2A,
  mergePersisted,
  type PersistedA2AConfig,
  resolveConfigPath,
} from './a2a-config.js';

export interface A2APluginConfig {
  mode?: 'client' | 'server' | 'both';
  // client
  name?: string;
  agentCardUrl?: string;
  bearerToken?: string;
  timeoutMs?: number;
  mapSkills?: boolean;
  // server
  /** Explicitly enable the inbound A2A server (default off). */
  serverEnabled?: boolean;
  baseUrl?: string;
  agentName?: string;
  agentDescription?: string;
  agentVersion?: string;
  skills?: ServerOptions['skills'];
  endpointPath?: string;
  execute?: ServerOptions['execute'];
  /** Optional shared bearer token protecting the inbound /a2a endpoint. */
  authToken?: string;
  // dashboard
  /** Serve the dashboard API on the webserver (default true). */
  dashboard?: boolean;
}

export { A2AClient } from './client.js';
export * from './protocol.js';
export * from './errors.js';
export { fetchAgentCard } from './card.js';
export { A2AServer, TaskStore, defaultExecutor, notConfiguredExecutor, shellExecutor, defaultSkills, createDshAgentExecutor } from './server.js';
export type { AgentRegistryLike, AgentPresetsLike, DshAgentExecutorOptions } from './server.js';
export { registerAgentTools } from './outbound.js';
export { DashboardRegistry, getSharedRegistry } from './dashboard.js';
export type {
  DashboardSnapshot,
  InboundPeer,
  OutboundAgent,
  ControlResult,
} from './dashboard.js';

/**
 * Service shapes consumed from the DSH composition. Declared structurally so
 * this package builds against `@deepseek-ai/cordis` alone (peer dependency);
 * the runtime shapes are owned by `@deepseek-ai/dsh-host-webserver` and
 * `@deepseek-ai/dsh-tools` respectively.
 */
export interface WebServerService {
  /** The OS-assigned (or configured) listen port. */
  readonly port: number;
  /** The configured bind host literal ('127.0.0.1' | '0.0.0.0'). */
  readonly host: string;
  register(route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}

/**
 * Structural slice of `ctx.agentDefaultModel` (owned by
 * `@deepseek-ai/dsh-agent-default-model`). It holds the deployment's default
 * `{ provider, model }` (layered with the user's Settings choice). Reading it
 * to seed a newly-created agent's model is the creating entry point's job — a
 * fresh session has no model selection, and DSH's persona system prompt fails
 * assembly on an empty `{{model}}` variable otherwise.
 */
export interface AgentDefaultModelService {
  currentSelection(): { provider?: string; model?: string; reasoningEffort?: string };
}

/**
 * Structural slice of `ctx.sessionTitle` (owned by `@deepseek-ai/dsh-session-title`).
 * `rename` accepts an explicit user title and pins it. We name inbound sessions
 * ourselves because their prompts carry a `plugin` source, which the title
 * service's automatic first-prompt naming deliberately ignores (human messages
 * only) — so without this they fall back to the cwd basename.
 */
export interface SessionTitleService {
  rename(session: unknown, title: string): unknown;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provided by @deepseek-ai/dsh-host-webserver. */
    webServer: WebServerService;
    /** Provided by @deepseek-ai/dsh-agent-default-model (optional). */
    agentDefaultModel?: AgentDefaultModelService;
    /** Provided by @deepseek-ai/dsh-session-title (optional). */
    sessionTitle?: SessionTitleService;
    /** Provided by @deepseek-ai/dsh-tools. */
    tools: { register(def: unknown): () => void };
    /**
     * Provided by @deepseek-ai/dsh-agent (the agent registry). Present whenever
     * that layer is composed, but `create()` only succeeds once an agent-loop
     * plugin has registered its factory — so server mode probes readiness
     * before enabling {@link createDshAgentExecutor}, and never hard-injects it.
     */
    agents?: AgentRegistryLike;
  }
}

const DEFAULT_ENDPOINT = '/a2a';
const DEFAULT_API_PATH = '/a2a/api';

/** Whether the shared dashboard API route is currently registered (once per process). */
let dashboardApiRegistered = false;

export const name = 'a2a';

/**
 * Services this plugin may read as context properties. Declared so property
 * reads inside `apply` never trip Cordis's "without inject" guard. The
 * mode-specific wiring runs inside `ctx.inject(...)` for the single service it
 * needs, so a composition lacking the other one simply idles that half.
 */
export const inject = ['webServer', 'tools'] as const;

export function apply(ctx: Context, config: A2APluginConfig = {}) {
  // Persisted `a2a.json` (per-profile, UI-editable) wins over static config.
  const persisted: PersistedA2AConfig = loadPersistedA2A();
  const mergedConfig: A2APluginConfig = mergePersisted(config, persisted);
  const configPath = resolveConfigPath();
  const mode = mergedConfig.mode ?? 'client';
  const logger = ctx.logger;
  const dashboard = getSharedRegistry();
  const wantsClient = mode === 'client' || mode === 'both';
  // `mode: 'server' | 'both'` enables the inbound server; an explicit
  // `server.enabled` in a2a.json also turns it on. Default is OFF — support
  // (both) is not the same as exposure.
  const serverEnabled = mergedConfig.serverEnabled === true;
  const wantsServer = mode === 'server' || mode === 'both' || serverEnabled;

  // ── dashboard API (GET/POST /a2a/api) — registered for BOTH modes, once per
  // process, as soon as webServer is available ────────────────────────────────
  if (mergedConfig.dashboard !== false) {
    ctx.inject(['webServer'], (ctx) => {
      if (dashboardApiRegistered) return;
      dashboardApiRegistered = true;
      let apiRoute: (() => void) | undefined;
      apiRoute = ctx.webServer.register({
        kind: 'prefix',
        path: DEFAULT_API_PATH,
        handler: async (req, res) => {
          if (!trustedLoopback(req)) {
            res.writeHead(403, { 'content-type': 'text/plain' });
            res.end('forbidden');
            return;
          }
          if (req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
            res.end(JSON.stringify(dashboard.snapshot()));
            return;
          }
          if (req.method === 'POST') {
            let payload: unknown;
            try {
              payload = JSON.parse(await readBody(req));
            } catch {
              res.writeHead(400, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ ok: false, message: 'invalid JSON body' }));
              return;
            }
            const { action, target, ...rest } = (payload ?? {}) as { action?: string; target?: string; [k: string]: unknown };
            if (!action) {
              res.writeHead(400, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ ok: false, message: 'action is required' }));
              return;
            }
            const result = await dashboard.control(action, target ?? '', rest);
            res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
          }
          res.writeHead(405, { 'content-type': 'text/plain' });
          res.end('Method Not Allowed');
        },
      });
      ctx.effect(() => () => {
        dashboardApiRegistered = false;
        apiRoute?.();
      }, 'a2a: dashboard api cleanup');
    });
  }

  // ── client mode: remote skills → ctx.tools ────────────────────────────────
  if (wantsClient) {
    const agentName = mergedConfig.name ?? 'remote';
    const initialAgents: Array<{ name: string; agentCardUrl: string; configured: boolean; enabled: boolean; bearerToken?: string; timeoutMs?: number; mapSkills?: boolean }> = [];
    // Persisted agents (a2a.json) — UI-managed, survive restart.
    for (const a of persisted.agents ?? []) {
      if (a.name && a.agentCardUrl) {
        initialAgents.push({ name: a.name, agentCardUrl: a.agentCardUrl, configured: true, enabled: a.enabled !== false, bearerToken: a.bearerToken, timeoutMs: a.timeoutMs, mapSkills: a.mapSkills });
      }
    }
    // Legacy static config (agentCardUrl in composition) — still honoured.
    if (mergedConfig.agentCardUrl) {
      initialAgents.push({ name: agentName, agentCardUrl: mergedConfig.agentCardUrl, configured: true, enabled: true, bearerToken: mergedConfig.bearerToken, timeoutMs: mergedConfig.timeoutMs, mapSkills: mergedConfig.mapSkills });
    }

    ctx.inject(['tools'], (ctx) => {
      // Live session: maps connectionId → connection record.
      const live = new Map<string, { disposeAll: () => void; name: string; agentCardUrl: string; configured?: boolean; enabled: boolean }>();
      const configuredAgents = new Set<string>();

      const connect = async (
        name: string,
        agentCardUrl: string,
        configured = false,
        agentOpts: { bearerToken?: string; timeoutMs?: number; mapSkills?: boolean } = {},
      ): Promise<string | undefined> => {
        let disposers: Array<() => void> = [];
        let connectionId: string | undefined;
        try {
          const regs = await registerAgentTools(ctx.tools, {
            name,
            agentCardUrl,
            bearerToken: agentOpts.bearerToken ?? mergedConfig.bearerToken,
            timeoutMs: agentOpts.timeoutMs ?? mergedConfig.timeoutMs,
            mapSkills: agentOpts.mapSkills ?? mergedConfig.mapSkills,
            onReady: (info) => {
              connectionId = info.connectionId;
              dashboard.upsertAgent({
                connectionId: info.connectionId,
                name,
                agentCardUrl,
                agentName: info.card.name,
                skillCount: (info.card.skills ?? []).length,
                toolCount: 0,
                state: 'connected',
                configured: configured ? true : undefined,
                skills: (info.card.skills ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description, tags: s.tags })),
              });
            },
            onDispose: (cid) => {
              dashboard.removeAgent(cid);
            },
          });
          disposers = regs.map((r) => r.dispose);
          if (connectionId) {
            dashboard.upsertAgent({
              connectionId,
              name,
              agentCardUrl,
              skillCount: 0,
              toolCount: regs.length,
              state: 'connected',
              configured: configured ? true : undefined,
            });
            live.set(connectionId, { disposeAll: () => disposers.forEach((d) => d()), name, agentCardUrl, configured, enabled: true });
            if (configured) configuredAgents.add(connectionId);
          }
          logger?.info?.(`[a2a] registered ${regs.length} tool(s) for agent "${name}"`);
          return connectionId;
        } catch (err) {
          logger?.error?.(`[a2a] failed to register agent "${name}": ${(err as Error).message}`);
          return undefined;
        }
      };

      // Persist the agent list to a2a.json (merge with existing).
      const persistAgents = (): void => {
        const next: PersistedA2AConfig = { ...loadPersistedA2A(), agents: [] };
        for (const a of initialAgents) {
          if (a.configured) next.agents!.push({ name: a.name, agentCardUrl: a.agentCardUrl, bearerToken: a.bearerToken, timeoutMs: a.timeoutMs, mapSkills: a.mapSkills, enabled: a.enabled === false ? false : undefined });
        }
        const res = savePersistedA2A(next);
        if (!res.ok) logger?.error?.(`[a2a] failed to save ${res.path}: ${res.message}`);
      };

      // Find an initial (persisted) entry by live connection. Returns the full
      // entry (incl. bearerToken/timeoutMs/mapSkills) so callers can edit them.
      const findInitial = (entry: { name: string; agentCardUrl: string }): { idx: number; item: (typeof initialAgents)[number] } | undefined => {
        const idx = initialAgents.findIndex((a) => a.configured && a.name === entry.name && a.agentCardUrl === entry.agentCardUrl);
        if (idx < 0) return undefined;
        return { idx, item: initialAgents[idx] };
      };

      // Wire dashboard control hooks for outbound connections.
      dashboard.setHooks({
        closeAgent: async (connectionId) => {
          const entry = live.get(connectionId);
          if (!entry) return { ok: false, message: `connection ${connectionId} not found` };
          entry.disposeAll();
          live.delete(connectionId);
          dashboard.removeAgent(connectionId);
          dashboard.setAgentState(connectionId, 'disconnected');
          dashboard.upsertAgent({
            connectionId,
            name: entry.name,
            agentCardUrl: entry.agentCardUrl,
            skillCount: 0,
            toolCount: 0,
            state: 'disconnected',
            enabled: false,
            configured: entry.configured ? true : undefined,
          });
          return { ok: true, message: `connection ${connectionId} closed` };
        },
        disableAgent: async (connectionId) => {
          const entry = live.get(connectionId);
          // A disabled row may still be present as a "configured but off" card.
          let name = entry?.name;
          let url = entry?.agentCardUrl;
          let configured = entry?.configured ?? false;
          if (!entry) {
            // find by connectionId/proxy scan on live only; fall back to the
            // last registered card id mapping stored by upsert below.
            const snap = dashboard.snapshot().outbound.find((o) => o.connectionId === connectionId);
            if (!snap) return { ok: false, message: `connection ${connectionId} not found` };
            name = snap.name;
            url = snap.agentCardUrl;
            configured = snap.configured ?? false;
          }
          if (entry) {
            entry.disposeAll();
            live.delete(connectionId);
            dashboard.setAgentState(connectionId, 'disconnected');
          } else {
            dashboard.setAgentState(connectionId, 'disconnected');
          }
          // If it came from the persisted config, flip enabled:false (keep entry).
          const found = name !== undefined && url !== undefined ? findInitial({ name, agentCardUrl: url }) : undefined;
          if (found) {
            found.item.enabled = false;
            persistAgents();
          }
          const prevSnap = dashboard.snapshot().outbound.find((o) => o.connectionId === connectionId);
          dashboard.upsertAgent({
            connectionId,
            name: name ?? 'unknown',
            agentCardUrl: url ?? '',
            agentName: prevSnap?.agentName ?? name,
            skillCount: 0,
            toolCount: 0,
            state: 'disconnected',
            enabled: false,
            configured: configured ? true : undefined,
          });
          return { ok: true, message: `agent ${connectionId} disabled (config kept)` };
        },
        enableAgent: async (connectionId) => {
          const snap = dashboard.snapshot().outbound.find((o) => o.connectionId === connectionId);
          if (!snap) return { ok: false, message: `connection ${connectionId} not found` };
          const found = findInitial({ name: snap.name, agentCardUrl: snap.agentCardUrl });
          if (found) {
            found.item.enabled = true;
            persistAgents();
          }
          dashboard.setAgentState(connectionId, 'reconnecting');
          const newId = await connect(snap.name, snap.agentCardUrl, snap.configured ?? false);
          if (!newId) return { ok: false, message: `enable of ${connectionId} failed to connect` };
          dashboard.removeAgent(connectionId);
          return { ok: true, message: `agent ${connectionId} enabled and reconnected as ${newId}` };
        },
        reconnectAgent: async (connectionId) => {
          const existing = live.get(connectionId);
          const prevName = existing?.name ?? agentName;
          const prevUrl = existing?.agentCardUrl ?? mergedConfig.agentCardUrl!;
          const wasConfigured = !!existing?.configured || configuredAgents.has(connectionId);
          if (existing) existing.disposeAll();
          live.delete(connectionId);
          dashboard.setAgentState(connectionId, 'reconnecting');
          const newId = await connect(prevName, prevUrl, wasConfigured);
          if (!newId) return { ok: false, message: `reconnect of ${connectionId} failed` };
          dashboard.removeAgent(connectionId);
          return { ok: true, message: `connection ${connectionId} reconnected as ${newId}` };
        },
        addAgent: async (name, agentCardUrl, opts) => {
          const bearerToken = opts?.bearerToken;
          const cid = await connect(name, agentCardUrl, true, { bearerToken });
          if (!cid) return { ok: false, message: `failed to connect to ${agentCardUrl}` };
          // Persist: add to a2a.json so it survives restart (token included).
          initialAgents.push({ name, agentCardUrl, configured: true, enabled: true, bearerToken });
          persistAgents();
          return { ok: true, message: `agent "${name}" connected as ${cid} (saved to ${configPath})` };
        },
        discoverAgent: async (agentCardUrl, opts) => {
          try {
            const card = await fetchAgentCard(agentCardUrl, {
              timeoutMs: mergedConfig.timeoutMs ?? 8000,
              bearerToken: opts?.bearerToken ?? mergedConfig.bearerToken,
            });
            const iface = pickInterface(card);
            return {
              ok: true,
              message: JSON.stringify({
                name: card.name,
                description: card.description,
                version: card.version,
                agentCardUrl,
                endpoint: iface?.url,
                skills: (card.skills ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description })),
                capabilities: card.capabilities,
                defaultInputModes: card.defaultInputModes,
                defaultOutputModes: card.defaultOutputModes,
              }),
            };
          } catch (err) {
            return { ok: false, message: `discover failed: ${(err as Error).message}` };
          }
        },
        removeAgent: async (connectionId) => {
          const entry = live.get(connectionId);
          let name: string | undefined;
          let url: string | undefined;
          let configured = false;
          if (entry) {
            name = entry.name;
            url = entry.agentCardUrl;
            configured = entry.configured ?? false;
            entry.disposeAll();
            live.delete(connectionId);
          } else {
            const snap = dashboard.snapshot().outbound.find((o) => o.connectionId === connectionId);
            if (!snap) return { ok: false, message: `connection ${connectionId} not found` };
            name = snap.name;
            url = snap.agentCardUrl;
            configured = snap.configured ?? false;
          }
          if (configured && name !== undefined && url !== undefined) {
            // Drop it from the persisted list entirely (this is a real delete).
            const found = findInitial({ name, agentCardUrl: url });
            if (found) {
              initialAgents.splice(found.idx, 1);
              persistAgents();
            }
          }
          dashboard.removeAgent(connectionId);
          return { ok: true, message: `agent ${connectionId} removed` };
        },
        updateAgent: async (connectionId, patch) => {
          const entry = live.get(connectionId);
          const snap = dashboard.snapshot().outbound.find((o) => o.connectionId === connectionId);
          const name = entry?.name ?? snap?.name;
          const url = entry?.agentCardUrl ?? snap?.agentCardUrl;
          const configured = entry?.configured ?? snap?.configured ?? false;
          if (!name || !url) return { ok: false, message: `connection ${connectionId} not found` };
          const found = findInitial({ name, agentCardUrl: url });
          if (!found) return { ok: false, message: 'only saved (configured) agents can be edited' };
          // Update persisted advanced fields, then reconnect so they bind — these
          // apply at connect()/registerAgentTools time (like enableAgent).
          if (patch.timeoutMs !== undefined) found.item.timeoutMs = patch.timeoutMs;
          if (patch.mapSkills !== undefined) found.item.mapSkills = patch.mapSkills;
          if (patch.bearerToken !== undefined) found.item.bearerToken = patch.bearerToken || undefined;
          persistAgents();
          const item = found.item;
          // A disabled agent: persist only, don't bring it online.
          if (item.enabled === false) {
            return { ok: true, message: `agent ${connectionId} updated (config kept, still disabled)` };
          }
          if (entry) {
            entry.disposeAll();
            live.delete(connectionId);
          }
          dashboard.setAgentState(connectionId, 'reconnecting');
          const newId = await connect(item.name, item.agentCardUrl, item.configured, {
            bearerToken: item.bearerToken,
            timeoutMs: item.timeoutMs,
            mapSkills: item.mapSkills,
          });
          if (!newId) return { ok: false, message: `update of ${connectionId} failed to reconnect` };
          dashboard.removeAgent(connectionId);
          return { ok: true, message: `agent ${connectionId} updated as ${newId} (saved to ${configPath})` };
        },
      });

      ctx.effect(() => {
        // Initial connections: persisted agents + legacy static config.
        for (const a of initialAgents) {
          if (a.enabled === false) {
            // Show a "configured but disabled" placeholder card (no tools).
            const phId = `out-cfg-${a.name}-${a.agentCardUrl}`;
            dashboard.upsertAgent({
              connectionId: phId,
              name: a.name,
              agentCardUrl: a.agentCardUrl,
              agentName: a.name,
              skillCount: 0,
              toolCount: 0,
              state: 'disconnected',
              enabled: false,
              configured: true,
            });
            continue;
          }
          void connect(a.name, a.agentCardUrl, a.configured, { bearerToken: a.bearerToken, timeoutMs: a.timeoutMs, mapSkills: a.mapSkills });
        }
        return () => {
          for (const { disposeAll } of live.values()) disposeAll();
          live.clear();
        };
      }, 'a2a: client tools');
    });
  }

  // ── server mode: expose DSH as an A2A agent ───────────────────────────────
  // The server effect is ALWAYS mounted (not gated on `wantsServer`), so its
  // control hooks (serverStatus / setServerEnabled / setServerIdentity) are
  // wired even in a client-only profile — letting the UI create and enable the
  // A2A server at runtime with no restart and no hand-edit of a2a.json. Route
  // registration itself is gated on `enabled` (initialized from `wantsServer`),
  // so a profile that didn't ask to serve starts with the routes off. Building
  // the A2AServer + probing the executor is side-effect-free (no sessions are
  // created until an inbound task actually arrives).
  {
    const store = new TaskStore();
    const taskPeer = new Map<string, string>();
    const pendingSettled = new Set<string>();
    ctx.inject(['webServer'], (ctx) => {
      ctx.effect(() => {
        const webServer = ctx.webServer;
        // Derive the advertised base URL from the real listen address when the
        // config doesn't pin one; avoids advertising a stale port. When bound
        // to 0.0.0.0, advertise a reachable LAN address, not loopback.
        const baseUrl = mergedConfig.baseUrl ?? inferBaseUrl(webServer.host, webServer.port);
        const endpointPath = mergedConfig.endpointPath ?? DEFAULT_ENDPOINT;
        // Surface a stale pinned baseUrl: if the config pins a port that does
        // not match the real listen port, the advertised AgentCard URL is
        // unreachable. We don't silently rewrite an explicit pin (it may point
        // at a reverse proxy), but we warn so the mismatch is diagnosable —
        // clearing baseUrl in the UI returns it to auto-inference.
        if (mergedConfig.baseUrl) {
          try {
            const pinnedPort = new URL(mergedConfig.baseUrl).port;
            if (pinnedPort && Number(pinnedPort) !== webServer.port) {
              logger?.warn?.(
                `[a2a] pinned baseUrl ${mergedConfig.baseUrl} port ${pinnedPort} != listen port ${webServer.port}; ` +
                  `remote callers may be unreachable. Clear baseUrl in settings to auto-infer.`,
              );
            }
          } catch {
            // malformed pinned URL — ignore (the card just advertises it as-is).
          }
        }

        // ── executor precedence ───────────────────────────────────────────────
        //   1. explicit `execute` (config injection)          → use it
        //   2. no explicit executor & the agent loop is ready → dshAgentExecutor:
        //      inbound message → a fresh, workspace-bound DSH agent session →
        //      reply. "Ready" means the agent-loop factory is registered, not
        //      merely that `ctx.agents` exists — a bare dsh-base profile has the
        //      registry but `create()` would reject. We probe via the reflection
        //      layer (no inject requirement) so a composition without the agent
        //      layer simply falls through.
        //   3. otherwise                                       → A2AServer's
        //      default notConfiguredExecutor (refuses + points at `execute`).
        let execute = mergedConfig.execute;
        let executorKind: 'custom' | 'dsh-agent' | 'none' = execute ? 'custom' : 'none';
        let disposeExecutor: (() => Promise<void>) | undefined;
        if (!execute) {
          const agents = probeAgentRegistry(ctx);
          if (agents) {
            // Dedicated cwd for inbound sessions: a subdir of the profile dir,
            // NOT the profile root — so per-context sessions don't pollute the
            // profile-root session group with a burst of `.a2a`-named rows. DSH
            // requires an absolute cwd and freezes it into the session header at
            // creation. Inbound sessions land in the "Ungrouped" bucket of the
            // session list; they are named `A2A: <summary>` so they're still
            // identifiable there.
            const inboundCwd = inboundSessionCwd(configPath);
            // Seed the model per task from the deployment default selection
            // (ctx.agentDefaultModel) — a fresh session has no model selection,
            // and the persona system prompt fails assembly on an empty
            // `{{model}}` without it. Resolving per task means a Settings model
            // switch is picked up by the next inbound task.
            const dshExec = createDshAgentExecutor(agents, {
              cwd: inboundCwd,
              plugin: 'a2a',
              agentPresets: probeAgentPresets(ctx),
              resolveAgentOptions: () => {
                const sel = probeAgentDefaultModel(ctx)?.currentSelection();
                if (!sel?.model && !sel?.provider) return undefined;
                return { provider: sel.provider, model: sel.model };
              },
              onSessionOpened: ({ session, firstPrompt }) => {
                // Name the session "A2A: <first-prompt summary>" — its prompts
                // carry a plugin source, which DSH's automatic titling skips, so
                // without this it would fall back to the cwd basename.
                probeSessionTitle(ctx)?.rename(session, `A2A: ${summarize(firstPrompt)}`);
              },
            });
            execute = dshExec;
            disposeExecutor = () => dshExec.disposeAll();
            executorKind = 'dsh-agent';
            logger?.info?.(`[a2a] server executor: DSH agent session per A2A context (cwd ${inboundCwd})`);
          }
        }

        const server = new A2AServer(
          {
            baseUrl,
            agentName: mergedConfig.agentName ?? 'DSH Agent',
            agentDescription: mergedConfig.agentDescription ?? 'DeepSeek Harness agent exposed over A2A v1.0',
            agentVersion: mergedConfig.agentVersion ?? '0.1.0',
            skills: mergedConfig.skills,
            endpointPath,
            execute,
            authToken: mergedConfig.authToken,
            onInbound: (facts) => {
              const peerId = dashboard.touchInbound(
                { headers: facts.headers, source: facts.source },
                facts.taskIds,
              );
              for (const taskId of facts.taskIds) {
                taskPeer.set(taskId, peerId);
                // The task may already be terminal (synchronous SendMessage
                // settles before onInbound runs) — apply the pending settle.
                if (pendingSettled.delete(taskId)) {
                  dashboard.finishTask(peerId, taskId);
                }
              }
            },
            onTaskSettled: (taskId) => {
              const peerId = taskPeer.get(taskId);
              if (peerId) {
                dashboard.finishTask(peerId, taskId);
                taskPeer.delete(taskId);
              } else {
                pendingSettled.add(taskId);
              }
            },
          },
          store,
        );

        // ── runtime-enabled route set ──────────────────────────────────────
        // Start serving only if this profile asked to (mode server/both or an
        // explicit server.enabled). A client-only profile mounts the effect but
        // keeps routes off until the UI enables the server.
        let enabled = wantsServer;
        let disposers: Array<() => void> = [];

        const registerRoutes = (): void => {
          // AgentCard discovery route.
          disposers.push(
            webServer.register({
              kind: 'exact',
              path: '/.well-known/agent-card.json',
              handler: async (_req: IncomingMessage, res: ServerResponse) => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(server.card));
              },
            }),
          );
          // JSON-RPC endpoint (POST) + SSE.
          disposers.push(
            webServer.register({
              kind: 'prefix',
              path: server.endpointPath,
              handler: async (req: IncomingMessage, res: ServerResponse) => {
                const isStream = (req.headers.accept ?? '').includes('text/event-stream');
                if (req.method === 'GET' && (req.url ?? '').startsWith(server.endpointPath + '/card')) {
                  res.writeHead(200, { 'content-type': 'application/json' });
                  res.end(JSON.stringify(server.card));
                  return;
                }
                if (req.method !== 'POST') {
                  res.writeHead(405, { 'content-type': 'text/plain' });
                  res.end('Method Not Allowed');
                  return;
                }
                const body = await readBody(req);
                if (isStream) {
                  const stream = await server.handleStream(toServerReq(req), body, (frame) => res.write(frame));
                  if (stream.status !== 200) {
                    res.writeHead(stream.status, { 'content-type': 'text/plain', ...(stream.headers ?? {}) });
                    res.end('Unauthorized');
                    return;
                  }
                  res.end();
                  return;
                }
                const out = await server.handle(toServerReq(req), body);
                res.writeHead(out.status, { 'content-type': out.contentType, ...(out.headers ?? {}) });
                res.end(out.body);
              },
            }),
          );
        };
        const unregisterRoutes = (): void => {
          for (const d of disposers) d();
          disposers = [];
        };

        if (enabled) {
          registerRoutes();
          logger?.info?.(
            `[a2a] A2A server mounted: AgentCard at ${baseUrl}/.well-known/agent-card.json, JSON-RPC at ${server.endpointPath}`,
          );
        } else {
          logger?.info?.('[a2a] A2A server ready but not serving (enable via settings)');
        }

        // ── serve panel hooks ──────────────────────────────────────────────
        // Read live values off the server: identity edits mutate the card in
        // place, so a captured `const baseUrl` would go stale. `endpointPath`
        // and each skill's `tags` are surfaced so the edit form can prefill.
        const serverCard = (): Record<string, unknown> => ({
          baseUrl: server.getBaseUrl(),
          agentName: server.card.name,
          agentDescription: server.card.description,
          agentVersion: server.card.version,
          endpointPath: server.endpointPath,
          endpoint: `${server.getBaseUrl()}${server.endpointPath}`,
          agentCardUrl: `${server.getBaseUrl()}/.well-known/agent-card.json`,
          skills: (server.card.skills ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description, tags: s.tags })),
          customExecutor: Boolean(mergedConfig.execute),
          // How inbound tasks are handled: a config-injected executor, this
          // harness's own agent session, or none (refuses until configured).
          executor: executorKind,
          // Whether the inbound endpoint is token-gated. Never expose the token
          // value itself — only whether one is set.
          authConfigured: server.authConfigured,
        });
        dashboard.setHooks({
          setServerEnabled: async (enable) => {
            if (enable === enabled) return { ok: true, message: `server already ${enable ? 'enabled' : 'disabled'}` };
            if (enable) {
              registerRoutes();
              enabled = true;
              logger?.info?.('[a2a] A2A server enabled');
            } else {
              unregisterRoutes();
              enabled = false;
              logger?.info?.('[a2a] A2A server disabled');
            }
            // Persist server.enabled so the choice survives restart (mergePersisted
            // maps server.enabled → serverEnabled → wantsServer on next boot).
            const next: PersistedA2AConfig = loadPersistedA2A();
            next.server = { ...(next.server ?? {}), enabled };
            const res = savePersistedA2A(next);
            if (!res.ok) {
              logger?.error?.(`[a2a] failed to persist server.enabled to ${res.path}: ${res.message}`);
              return { ok: false, message: `applied in-memory but failed to save: ${res.message}` };
            }
            return { ok: true, message: enable ? 'A2A server enabled' : 'A2A server disabled' };
          },
          setServerIdentity: async (patch) => {
            // baseUrl semantics: undefined = "not touched"; "" = "clear pin,
            // return to auto-inference"; non-empty = explicit pin (reverse
            // proxy / public domain). Empty must NOT reach updateCard (which
            // would set the advertised URL to ""), so handle it here where the
            // real listen address (webServer.host/port) is available.
            const clearBaseUrl = patch.baseUrl === '';
            const cardPatch = clearBaseUrl ? { ...patch, baseUrl: undefined } : patch;
            const { endpointChanged } = server.updateCard(cardPatch);
            if (clearBaseUrl) {
              // Re-derive from the actual listen address and re-advertise.
              server.setBaseUrl(inferBaseUrl(webServer.host, webServer.port));
            }
            // The JSON-RPC path moved: re-register on the new path, but only
            // while serving (disabled → routes get the new path on next enable).
            if (endpointChanged && enabled) {
              unregisterRoutes();
              registerRoutes();
            }
            // Persist the provided fields to a2a.json server.{...}.
            const next: PersistedA2AConfig = loadPersistedA2A();
            const s = { ...(next.server ?? {}) };
            if (patch.agentName !== undefined) s.agentName = patch.agentName;
            if (patch.agentDescription !== undefined) s.agentDescription = patch.agentDescription;
            if (patch.agentVersion !== undefined) s.agentVersion = patch.agentVersion;
            // Clear the persisted pin so it stays auto on restart; a non-empty
            // value pins it; undefined leaves the existing setting untouched.
            if (clearBaseUrl) delete s.baseUrl;
            else if (patch.baseUrl !== undefined) s.baseUrl = patch.baseUrl;
            if (patch.endpointPath !== undefined) s.endpointPath = patch.endpointPath;
            if (patch.skills !== undefined) s.skills = patch.skills;
            next.server = s;
            const res = savePersistedA2A(next);
            if (!res.ok) {
              logger?.error?.(`[a2a] failed to persist server identity to ${res.path}: ${res.message}`);
              return { ok: false, message: `applied in-memory but failed to save: ${res.message}` };
            }
            logger?.info?.(`[a2a] server identity updated (saved to ${res.path})`);
            return { ok: true, message: `已更新对外服务 (saved to ${res.path})` };
          },
          setServerAuthToken: async (token) => {
            server.setAuthToken(token);
            // Persist to a2a.json (server.authToken) so the gate survives restart.
            const next: PersistedA2AConfig = loadPersistedA2A();
            next.server = { ...(next.server ?? {}), authToken: token && token.length > 0 ? token : undefined };
            const res = savePersistedA2A(next);
            if (!res.ok) {
              logger?.error?.(`[a2a] failed to persist authToken to ${res.path}: ${res.message}`);
              return { ok: false, message: `applied in-memory but failed to save: ${res.message}` };
            }
            logger?.info?.(`[a2a] inbound authToken ${token ? 'set' : 'cleared'} (saved to ${res.path})`);
            return { ok: true, message: token ? '已设置入站鉴权 token' : '已清除入站鉴权 token' };
          },
          serverStatus: () => ({
            ok: true,
            message: JSON.stringify({ enabled, ...serverCard() }),
          }),
        });

        return () => {
          unregisterRoutes();
          // Dispose every live per-context inbound session on unload/teardown.
          void disposeExecutor?.().catch((err) => logger?.error?.(`[a2a] executor dispose failed: ${(err as Error).message}`));
        };
      }, 'a2a: server routes');
    });
  }

  // ── control hooks for outbound reconnect/close ────────────────────────────
  // Wired per-instance inside the client-mode effect above.
}

/**
 * Probe for a usable agent registry WITHOUT taking an inject dependency on it.
 *
 * `ctx.agents` (the registry) can be present while `create()` still rejects —
 * that happens on a bare dsh-base profile that has the agent layer but no
 * agent-loop plugin to register the creation factory. We can't cheaply tell
 * "factory registered" apart from "registry present" without attempting a
 * create, so this returns the registry when it's structurally usable and lets
 * {@link createDshAgentExecutor} degrade to a readable error if a later
 * `create()` rejects.
 */
function probeAgentRegistry(ctx: Context): AgentRegistryLike | undefined {
  return probeService(ctx, 'agents', 'create') as AgentRegistryLike | undefined;
}

/**
 * Probe for the agent-preset roster service (`ctx.agentPresets`, owned by
 * `@deepseek-ai/dsh-agent-presets`) without an inject dependency. When the
 * deployment composes presets (`dsh-web-app` mounts the roster with a
 * `default: standard`), inbound sessions must be composed from the same
 * preset or they publish against the empty global layer — tools, prompt
 * sections, and skills all absent. Absent rosters keep legacy behavior.
 */
function probeAgentPresets(ctx: Context): AgentPresetsLike | undefined {
  return probeService(ctx, 'agentPresets', 'resolve') as AgentPresetsLike | undefined;
}

/**
 * Probe for the deployment default-model service without an inject dependency.
 * Returns undefined when the service is absent, so the executor simply creates
 * the agent without a seeded selection — fine for compositions that seed the
 * model another way.
 */
function probeAgentDefaultModel(ctx: Context): AgentDefaultModelService | undefined {
  const svc = probeService(ctx, 'agentDefaultModel', 'currentSelection');
  return svc as AgentDefaultModelService | undefined;
}

/** Probe `ctx.sessionTitle` (optional). Used to name inbound sessions. */
function probeSessionTitle(ctx: Context): SessionTitleService | undefined {
  return probeService(ctx, 'sessionTitle', 'rename') as SessionTitleService | undefined;
}

/**
 * Read a strict service off the reflection layer and confirm it exposes the
 * named method, without taking an inject dependency. Returns undefined when the
 * service is absent, its fiber inactive, or the method missing.
 */
function probeService(ctx: Context, name: string, method: string): unknown {
  try {
    const reflect = (ctx as unknown as { reflect?: { get(n: string, strict?: boolean): unknown } }).reflect;
    const svc = reflect?.get(name, true);
    if (svc && typeof (svc as Record<string, unknown>)[method] === 'function') return svc;
  } catch {
    // reflection unavailable or service resolution threw — treat as absent.
  }
  return undefined;
}

/**
 * One-line title summary from a prompt: first line, whitespace-collapsed, cut
 * to a display-friendly length on a word boundary when possible.
 */
function summarize(prompt: string, maxChars = 40): string {
  const text = prompt.replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text || '(empty)';
  const cut = text.slice(0, maxChars);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > maxChars * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/**
 * Absolute cwd for inbound per-context sessions: a `.a2a-sessions` subdir of
 * the profile directory (the dir holding `a2a.json`), kept separate from the
 * profile root so inbound sessions don't crowd the user's interactive
 * conversations there. They surface in the session list's "Ungrouped" bucket,
 * named `A2A: <summary>`. Created if missing (persistence writes under it);
 * falls back to cwd on any failure.
 */
function inboundSessionCwd(configPath: string): string {
  try {
    const dir = join(dirname(configPath), '.a2a-sessions');
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return process.cwd();
  }
}

/**
 * Derive the public base URL advertised in the AgentCard from the real wire
 * listen address, when the operator did not pin `baseUrl` in config.
 *
 * The A2A AgentCard must carry a URL a REMOTE caller can reach. When the web
 * server binds only loopback (`127.0.0.1`), that address is correct. But when
 * it binds every interface (`0.0.0.0`), advertising `127.0.0.1` is wrong for
 * every non-local caller — it points at the caller's own loopback. In that
 * case pick the machine's best-known LAN address (the primary non-loopback
 * IPv4 of the interface that routes to the default gateway), and only fall
 * back to loopback when no such address exists. IPv6 link-local is skipped
 * (not reachable without a scope id).
 *
 * @param host - the web server's configured bind host ('127.0.0.1' | '0.0.0.0').
 * @param port - the OS-assigned (or configured) listen port.
 * @returns a scheme+host+port URL for Agents to call back into this DSH.
 */
export function inferBaseUrl(host: string, port: number): string {
  const hostname =
    host === '0.0.0.0'
      ? primaryLanAddress() ?? '127.0.0.1'
      : host || '127.0.0.1';
  return `http://${hostname}:${port}`;
}

/**
 * Best single LAN IPv4 for this machine: the address of the non-loopback
 * interface whose route reaches the default gateway (the address a remote
 * peer on the same subnet would use to reach us). Returns undefined when the
 * machine has no non-loopback IPv4 (e.g. offline / containers).
 *
 * Prefers IPv4 (A2A URLs here are v4-style), skips link-local (169.254.0.0/16)
 * and CGNAT (100.64.0.0/10) ranges, which are useless to advertise.
 */
function primaryLanAddress(): string | undefined {
  try {
    const ifaces = networkInterfaces();
    let candidate: string | undefined;
    for (const name of Object.keys(ifaces)) {
      const addrs = ifaces[name] ?? [];
      for (const a of addrs) {
        if (a.family !== 'IPv4' || a.internal) continue;
        const ip = a.address;
        if (ip.startsWith('169.254.')) continue;
        const first = Number(ip.split('.')[0]);
        const second = Number(ip.split('.')[1]);
        // CGNAT 100.64.0.0/10: first octet 100, second in [64..127]. The rest
        // of 100.x.y.z is ordinary public space — keep it.
        if (first === 100 && second >= 64 && second <= 127) continue;
        if (!candidate) candidate = ip;
        // Prefer addresses that match a default-route interface if visible.
        if (name === 'en0' || name === 'eth0' || name === 'ens3' || name === 'ens5') return ip;
      }
    }
    return candidate;
  } catch {
    return undefined;
  }
}

/** Drain the request body from a Node IncomingMessage. */
async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.once('error', reject);
  });
}

/** Loopback/same-origin trust fence for the dashboard API (no remote write). */
function trustedLoopback(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const hostname = host.split(':')[0];
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Adapt a Node IncomingMessage to the A2A server's structural request type. */
function toServerReq(req: IncomingMessage): {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  socket?: { remoteAddress?: string; remotePort?: number };
} {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k] = v;
    else if (Array.isArray(v)) headers[k] = v.join(', ');
  }
  return {
    method: req.method,
    url: req.url,
    headers,
    socket: req.socket ? { remoteAddress: req.socket.remoteAddress, remotePort: req.socket.remotePort } : undefined,
  };
}