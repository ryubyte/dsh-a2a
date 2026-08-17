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
import { A2AServer, type ServerOptions } from './server.js';
import { TaskStore } from './server.js';
import {
  DashboardRegistry,
  getSharedRegistry,
} from './dashboard.js';

export interface A2APluginConfig {
  mode?: 'client' | 'server' | 'both';
  // client
  name?: string;
  agentCardUrl?: string;
  bearerToken?: string;
  timeoutMs?: number;
  mapSkills?: boolean;
  // server
  baseUrl?: string;
  agentName?: string;
  agentDescription?: string;
  agentVersion?: string;
  skills?: ServerOptions['skills'];
  endpointPath?: string;
  execute?: ServerOptions['execute'];
  // dashboard
  /** Serve the dashboard API on the webserver (default true). */
  dashboard?: boolean;
}

export { A2AClient } from './client.js';
export * from './protocol.js';
export * from './errors.js';
export { fetchAgentCard } from './card.js';
export { A2AServer, TaskStore, defaultExecutor, defaultSkills } from './server.js';
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
  const mode = config.mode ?? 'client';
  const logger = ctx.logger;
  const dashboard = getSharedRegistry();
  const wantsClient = mode === 'client' || mode === 'both';
  const wantsServer = mode === 'server' || mode === 'both';

  // ── client mode: remote skills → ctx.tools ────────────────────────────────
  if (wantsClient) {
    const agentName = config.name ?? 'remote';
    if (!config.agentCardUrl) {
      logger?.warn?.('[a2a] mode=client requires `agentCardUrl`; nothing registered');
    } else {
      ctx.inject(['tools'], (ctx) => {
        // Live session: maps connectionId → disposers of its registered tools.
        const live = new Map<string, { disposeAll: () => void }>();
        const agentCardUrl = config.agentCardUrl!;
        const connect = async (): Promise<string | undefined> => {
          let disposers: Array<() => void> = [];
          let connectionId: string | undefined;
          try {
            const regs = await registerAgentTools(ctx.tools, {
              name: agentName,
              agentCardUrl,
              bearerToken: config.bearerToken,
              timeoutMs: config.timeoutMs,
              mapSkills: config.mapSkills,
              onReady: (info) => {
                connectionId = info.connectionId;
                dashboard.upsertAgent({
                  connectionId: info.connectionId,
                  name: agentName,
                  agentCardUrl,
                  agentName: info.card.name,
                  skillCount: (info.card.skills ?? []).length,
                  toolCount: 0,
                  state: 'connected',
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
                name: agentName,
                agentCardUrl,
                skillCount: 0,
                toolCount: regs.length,
                state: 'connected',
              });
              live.set(connectionId, { disposeAll: () => disposers.forEach((d) => d()) });
            }
            logger?.info?.(`[a2a] registered ${regs.length} tool(s) for agent "${agentName}"`);
            return connectionId;
          } catch (err) {
            logger?.error?.(`[a2a] failed to register agent "${agentName}": ${(err as Error).message}`);
            return undefined;
          }
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
            // Re-add as disconnected row so the UI can reconnect it.
            dashboard.upsertAgent({
              connectionId,
              name: agentName,
              agentCardUrl,
              skillCount: 0,
              toolCount: 0,
              state: 'disconnected',
            });
            return { ok: true, message: `connection ${connectionId} closed` };
          },
          reconnectAgent: async (connectionId) => {
            const existing = live.get(connectionId);
            if (existing) existing.disposeAll();
            live.delete(connectionId);
            dashboard.setAgentState(connectionId, 'reconnecting');
            const newId = await connect();
            if (!newId) return { ok: false, message: `reconnect of ${connectionId} failed` };
            // The old row is superseded by the fresh connection row.
            dashboard.removeAgent(connectionId);
            return { ok: true, message: `connection ${connectionId} reconnected as ${newId}` };
          },
        });

        ctx.effect(() => {
          void connect();
          return () => {
            for (const { disposeAll } of live.values()) disposeAll();
            live.clear();
          };
        }, 'a2a: client tools');
      });
    }
  }

  // ── server mode: expose DSH as an A2A agent ───────────────────────────────
  if (wantsServer) {
    const store = new TaskStore();
    ctx.inject(['webServer'], (ctx) => {
      ctx.effect(() => {
        const webServer = ctx.webServer;
        // Derive the advertised base URL from the real listen address when the
        // config doesn't pin one; avoids advertising a stale port.
        const baseUrl =
          config.baseUrl ??
          `http://${webServer.host === '0.0.0.0' ? '127.0.0.1' : webServer.host}:${webServer.port}`;
        const endpointPath = config.endpointPath ?? DEFAULT_ENDPOINT;

        const server = new A2AServer(
          {
            baseUrl,
            agentName: config.agentName ?? 'DSH Agent',
            agentDescription: config.agentDescription ?? 'DeepSeek Harness agent exposed over A2A v1.0',
            agentVersion: config.agentVersion ?? '0.1.0',
            skills: config.skills,
            endpointPath,
            execute: config.execute,
            onInbound: (facts) => {
              dashboard.touchInbound(
                { headers: facts.headers, source: facts.source },
                facts.taskIds,
              );
            },
          },
          store,
        );

        // AgentCard discovery route.
        const cardRoute = webServer.register({
          kind: 'exact',
          path: '/.well-known/agent-card.json',
          handler: async (_req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(server.card));
          },
        });

        // JSON-RPC endpoint (POST) + SSE (with content-type negotiation).
        const rpcRoute = webServer.register({
          kind: 'prefix',
          path: server.endpointPath,
          handler: async (req, res) => {
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
              res.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
              });
              await server.handleStream(toServerReq(req), body, (frame) => res.write(frame));
              res.end();
              return;
            }
            const out = await server.handle(toServerReq(req), body);
            res.writeHead(out.status, { 'content-type': out.contentType });
            res.end(out.body);
          },
        });

        // Dashboard API: GET /a2a/api → snapshot; POST /a2a/api → control.
        // Registered at most once per process (all instances share one
        // registry, so a second server instance must not re-register).
        let apiRoute: (() => void) | undefined;
        if (config.dashboard !== false && !dashboardApiRegistered) {
          dashboardApiRegistered = true;
          apiRoute = webServer.register({
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
                const { action, target } = (payload ?? {}) as { action?: string; target?: string };
                if (!action || !target) {
                  res.writeHead(400, { 'content-type': 'application/json' });
                  res.end(JSON.stringify({ ok: false, message: 'action and target are required' }));
                  return;
                }
                const result = await dashboard.control(action, target);
                res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json' });
                res.end(JSON.stringify(result));
                return;
              }
              res.writeHead(405, { 'content-type': 'text/plain' });
              res.end('Method Not Allowed');
            },
          });
        }

        logger?.info?.(
          `[a2a] A2A server mounted: AgentCard at ${baseUrl}/.well-known/agent-card.json, JSON-RPC at ${server.endpointPath}`,
        );

        return () => {
          cardRoute();
          rpcRoute();
          if (apiRoute) {
            dashboardApiRegistered = false;
            apiRoute();
          }
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