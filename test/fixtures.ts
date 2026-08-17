/**
 * Shared test fixtures: a minimal in-process A2A v1.0 mock agent (JSON-RPC +
 * AgentCard) and a fake DSH `tools`/`webServer` service for plugin tests.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentCard } from '../src/protocol.js';
import { TaskState } from '../src/protocol.js';

export const AGENT_NAME = 'echo-agent';
export const SKILL_ID = 'echo';

export function makeCard(port: number): AgentCard {
  return {
    name: AGENT_NAME,
    description: 'Echo agent for tests',
    version: '1.0.0',
    supportedInterfaces: [
      {
        url: `http://127.0.0.1:${port}/a2a`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    provider: { url: 'https://example.com', organization: 'Example' },
    capabilities: { streaming: true },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: SKILL_ID,
        name: 'Echo',
        description: 'Echo back the prompt',
        tags: ['echo'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
  };
}

/**
 * Spin up an in-process A2A mock agent:
 *  - GET /.well-known/agent-card.json
 *  - POST /a2a JSON-RPC: SendMessage returns a completed Task that echoes
 *    the incoming text; GetTask returns the stored task; CancelTask cancels.
 */
export function startMockAgent(): Promise<{ server: Server; port: number; tasks: Map<string, unknown> }> {
  const tasks = new Map<string, unknown>();
  const server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && url === '/.well-known/agent-card.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(makeCard(server.address() as AddressInfo ? (server.address() as AddressInfo).port : 0)));
      return;
    }
    if (req.method === 'POST' && url === '/a2a') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const rpc = JSON.parse(body);
        const params = rpc.params ?? {};
        try {
          if (rpc.method === 'SendMessage') {
            const msg = params.message;
            const taskId = crypto.randomUUID();
            const task = {
              id: taskId,
              contextId: 'ctx-1',
              status: {
                state: TaskState.COMPLETED,
                timestamp: new Date().toISOString(),
              },
              artifacts: [
                {
                  artifactId: 'result',
                  parts: [{ text: `echo: ${msg.parts?.[0]?.text ?? ''}` }],
                },
              ],
              history: [msg],
            };
            tasks.set(taskId, task);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { task } }));
            return;
          }
          if (rpc.method === 'GetTask') {
            const task = tasks.get(params.id);
            if (!task) {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32001, message: `Task ${params.id} not found` } }));
              return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: task }));
            return;
          }
          if (rpc.method === 'CancelTask') {
            const task = tasks.get(params.id);
            if (!task) {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32001, message: 'not found' } }));
              return;
            }
            (task as { status: { state: string } }).status.state = TaskState.CANCELED;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: task }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `unknown ${rpc.method}` } }));
        } catch (err) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32603, message: String(err) } }));
        }
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not Found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, tasks });
    });
  });
}

/** Minimal fake DSH `tools` service capturing registered definitions. */
export function makeFakeTools() {
  const defs: Array<{ name: string; execute?: (...a: unknown[]) => unknown }> = [];
  return {
    defs,
    register(def: { name: string; execute?: (...a: unknown[]) => unknown }) {
      defs.push(def);
      return () => {
        const i = defs.indexOf(def);
        if (i >= 0) defs.splice(i, 1);
      };
    },
  };
}

/** Minimal fake DSH `webServer` service recording route registrations. */
export function makeFakeWebServer() {
  const routes: Array<{ kind?: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }> = [];
  return {
    routes,
    register(route: {
      kind: 'exact' | 'prefix';
      path: string;
      handler: (req: unknown, res: unknown) => void | Promise<void>;
    }) {
      routes.push({ kind: route.kind, path: route.path, handler: route.handler });
      return () => {
        const i = routes.findIndex((r) => r.path === route.path && r.kind === route.kind);
        if (i >= 0) routes.splice(i, 1);
      };
    },
  };
}

/** Minimal fake DSH Context: exposes property services + inject()/effect() + logger. */
export function makeFakeCtx(services: Record<string, unknown>) {
  return makeFakeCtxInner(services, []);
}

function makeFakeCtxInner(services: Record<string, unknown>, sharedEffects: Array<{ body: () => unknown; disposer: () => void }>) {
  const ctx = {
    ...services,
    /** Simulate Cordis's lazy service property resolution + inject + effect. */
    inject(deps: string[], cb: (sub: unknown) => unknown) {
      // A service missing from `services` means the inject never fires.
      const missing = deps.some((d) => !(d in services));
      if (missing) return () => {};
      const sub = makeFakeCtxInner(services, sharedEffects); // child shares effects list
      return cb(sub);
    },
    effect(body: () => unknown, _label?: string) {
      const disposerOrUndef = body();
      const disposer = typeof disposerOrUndef === 'function' ? disposerOrUndef : () => {};
      sharedEffects.push({ body, disposer });
      return disposer;
    },
    disposeEffects() {
      for (const e of sharedEffects.splice(0)) e.disposer();
    },
    get effects() {
      return sharedEffects;
    },
    logger: {
      info: (...a: unknown[]) => console.log('[info]', ...a),
      warn: (...a: unknown[]) => console.warn('[warn]', ...a),
      error: (...a: unknown[]) => console.error('[error]', ...a),
    },
  };
  return ctx as unknown as {
    effects: Array<{ body: () => unknown; disposer: () => void }>;
    disposeEffects: () => void;
    [k: string]: unknown;
  };
}