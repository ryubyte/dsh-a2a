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
import { registerAgentTools } from './outbound.js';
import { fetchAgentCard, pickInterface } from './card.js';
import { A2AServer, type ServerOptions } from './server.js';
import { TaskStore } from './server.js';
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
export { A2AServer, TaskStore, defaultExecutor, notConfiguredExecutor, shellExecutor, defaultSkills } from './server.js';
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

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provided by @deepseek-ai/dsh-host-webserver. */
    webServer: WebServerService;
    /** Provided by @deepseek-ai/dsh-tools. */
    tools: { register(def: unknown): () => void };
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

      // Find an initial (persisted) entry by live connection.
      const findInitial = (entry: { name: string; agentCardUrl: string }): { idx: number; item: { name: string; agentCardUrl: string; configured: boolean; enabled: boolean } } | undefined => {
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
        addAgent: async (name, agentCardUrl) => {
          const cid = await connect(name, agentCardUrl, true);
          if (!cid) return { ok: false, message: `failed to connect to ${agentCardUrl}` };
          // Persist: add to a2a.json so it survives restart.
          initialAgents.push({ name, agentCardUrl, configured: true, enabled: true });
          persistAgents();
          return { ok: true, message: `agent "${name}" connected as ${cid} (saved to ${configPath})` };
        },
        discoverAgent: async (agentCardUrl) => {
          try {
            const card = await fetchAgentCard(agentCardUrl, {
              timeoutMs: mergedConfig.timeoutMs ?? 8000,
              bearerToken: mergedConfig.bearerToken,
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
  if (wantsServer) {
    const store = new TaskStore();
    const taskPeer = new Map<string, string>();
    const pendingSettled = new Set<string>();
    ctx.inject(['webServer'], (ctx) => {
      ctx.effect(() => {
        const webServer = ctx.webServer;
        // Derive the advertised base URL from the real listen address when the
        // config doesn't pin one; avoids advertising a stale port.
        const baseUrl =
          mergedConfig.baseUrl ??
          `http://${webServer.host === '0.0.0.0' ? '127.0.0.1' : webServer.host}:${webServer.port}`;
        const endpointPath = mergedConfig.endpointPath ?? DEFAULT_ENDPOINT;

        const server = new A2AServer(
          {
            baseUrl,
            agentName: mergedConfig.agentName ?? 'DSH Agent',
            agentDescription: mergedConfig.agentDescription ?? 'DeepSeek Harness agent exposed over A2A v1.0',
            agentVersion: mergedConfig.agentVersion ?? '0.1.0',
            skills: mergedConfig.skills,
            endpointPath,
            execute: mergedConfig.execute,
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
        let enabled = true;
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

        registerRoutes();
        logger?.info?.(
          `[a2a] A2A server mounted: AgentCard at ${baseUrl}/.well-known/agent-card.json, JSON-RPC at ${server.endpointPath}`,
        );

        // ── serve panel hooks ──────────────────────────────────────────────
        const serverCard = (): Record<string, unknown> => ({
          baseUrl,
          agentName: server.card.name,
          agentDescription: server.card.description,
          agentVersion: server.card.version,
          endpoint: `${baseUrl}${server.endpointPath}`,
          agentCardUrl: `${baseUrl}/.well-known/agent-card.json`,
          skills: (server.card.skills ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description })),
          customExecutor: Boolean(mergedConfig.execute),
        });
        dashboard.setHooks({
          setServerEnabled: async (enable) => {
            if (enable === enabled) return { ok: true, message: `server already ${enable ? 'enabled' : 'disabled'}` };
            if (enable) {
              registerRoutes();
              enabled = true;
              logger?.info?.('[a2a] A2A server enabled');
              return { ok: true, message: 'A2A server enabled' };
            }
            unregisterRoutes();
            enabled = false;
            logger?.info?.('[a2a] A2A server disabled');
            return { ok: true, message: 'A2A server disabled' };
          },
          serverStatus: () => ({
            ok: true,
            message: JSON.stringify({ enabled, ...serverCard() }),
          }),
        });

        return () => {
          unregisterRoutes();
        };
      }, 'a2a: server routes');
    });
  }

  // ── control hooks for outbound reconnect/close ────────────────────────────
  // Wired per-instance inside the client-mode effect above.
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