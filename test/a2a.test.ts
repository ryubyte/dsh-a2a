/**
 * dsh-a2a integration + unit tests (node:test).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { startMockAgent, makeFakeTools, makeFakeWebServer, makeFakeCtx, SKILL_ID } from './fixtures.js';
import { A2AClient } from '../src/client.js';
import { fetchAgentCard, pickInterface } from '../src/card.js';
import { TaskState, A2A_METHODS } from '../src/protocol.js';
import { A2AError } from '../src/errors.js';
import { A2AServer, TaskStore, defaultExecutor, notConfiguredExecutor, shellExecutor, createDshAgentExecutor, type AgentRegistryLike } from '../src/server.js';
import { registerAgentTools } from '../src/outbound.js';
import { apply } from '../src/index.js';

let mock: { server: Server; port: number; tasks: Map<string, unknown> } | undefined;

before(async () => {
  mock = await startMockAgent();
});
after(() => {
  mock?.server.close();
});

test('fetchAgentCard discovers the well-known card', async () => {
  const card = await fetchAgentCard(`http://127.0.0.1:${mock!.port}`);
  assert.equal(card.name, 'echo-agent');
  assert.equal(card.skills?.[0]?.id, SKILL_ID);
});

test('pickInterface prefers JSONRPC', async () => {
  const card = await fetchAgentCard(`http://127.0.0.1:${mock!.port}`);
  const { iface, url } = pickInterface(card);
  assert.equal(iface.protocolBinding, 'JSONRPC');
  assert.equal(url, `http://127.0.0.1:${mock!.port}/a2a`);
});

test('A2AClient.sendMessage returns a completed echo task', async () => {
  const client = await A2AClient.connect(`http://127.0.0.1:${mock!.port}`);
  const resp = await client.sendMessage({
    messageId: 'm1',
    role: 'ROLE_USER',
    parts: [{ text: 'hello a2a' }],
  });
  assert.ok('task' in resp && resp.task);
  assert.equal(resp.task.id, mock!.tasks.keys().next().value);
  assert.equal(resp.task.status.state, TaskState.COMPLETED);
  assert.equal(resp.task.artifacts?.[0]?.parts?.[0]?.text, 'echo: hello a2a');
});

test('A2AClient.cancelTask cancels a pending task', async () => {
  const client = await A2AClient.connect(`http://127.0.0.1:${mock!.port}`);
  // mock always completes instantly; send then cancel by task id
  const resp = await client.sendMessage({ messageId: 'm2', role: 'ROLE_USER', parts: [{ text: 'x' }] });
  const id = 'task' in resp && resp.task ? resp.task.id : '';
  const canceled = await client.cancelTask(id);
  assert.equal(canceled.status.state, TaskState.CANCELED);
});

test('A2AClient errors surface as A2AError from remote', async () => {
  const client = await A2AClient.connect(`http://127.0.0.1:${mock!.port}`);
  await assert.rejects(
    client.getTask('does-not-exist'),
    (err) => (err as A2AError).code === -32001 && (err as A2AError).remote === true,
  );
});

test('registerAgentTools registers a tool and its disposer unregisters', async () => {
  const tools = makeFakeTools();
  const regs = await registerAgentTools(tools, {
    name: 'echo',
    agentCardUrl: `http://127.0.0.1:${mock!.port}`,
  });
  assert.equal(regs.length, 1);
  assert.equal(regs[0].name, `a2a__echo__${SKILL_ID}`);
  assert.equal(tools.defs.length, 1);
  assert.equal(tools.defs[0].name, `a2a__echo__${SKILL_ID}`);
  regs[0].dispose();
  assert.equal(tools.defs.length, 0);
});

test('registered tool execute returns remote echo', async () => {
  const tools = makeFakeTools();
  await registerAgentTools(tools, {
    name: 'echo',
    agentCardUrl: `http://127.0.0.1:${mock!.port}`,
  });
  const def = tools.defs[0];
  const result = await def.execute?.({ prompt: 'ping' }, { signal: undefined });
  assert.equal(result, 'echo: ping');
});

// ── inbound server (no webServer service) ──────────────────────────────────

test('A2AServer serves AgentCard and handles SendMessage inline', async () => {
  const server = new A2AServer({
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'Test Agent',
    agentDescription: 'Test agent',
    agentVersion: '1.0.0',
    skills: [{ id: 'echo', name: 'Echo', description: 'Echo' }],
    execute: async ({ message }) => ({
      messageId: 'r1',
      role: 'ROLE_AGENT',
      parts: [{ text: `server-echo: ${message.parts?.[0] && 'text' in message.parts[0] ? message.parts[0].text : ''}` }],
    }),
  });
  const cardRes = await server.handle({ method: 'GET', url: '/.well-known/agent-card.json' }, '');
  assert.equal(cardRes.status, 200);
  const card = JSON.parse(cardRes.body);
  assert.equal(card.supportedInterfaces[0].protocolBinding, 'JSONRPC');
  assert.equal(card.supportedInterfaces[0].protocolVersion, '1.0');

  const rpcBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'SendMessage',
    params: { message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: 'hi' }] } },
  });
  const sendRes = await server.handle({ method: 'POST', url: '/a2a' }, rpcBody);
  assert.equal(sendRes.status, 200);
  const sendJson = JSON.parse(sendRes.body);
  assert.equal(sendJson.result.task.status.state, TaskState.COMPLETED);
  assert.equal(sendJson.result.task.artifacts[0].parts[0].text, 'server-echo: hi');
});

test('A2AServer returns TASK_NOT_FOUND for missing task', async () => {
  const server = new A2AServer({
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'T',
    agentDescription: 'T',
    agentVersion: '1.0.0',
  });
  const res = await server.handle(
    { method: 'POST', url: '/a2a' },
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'GetTask', params: { id: 'nope' } }),
  );
  const json = JSON.parse(res.body);
  assert.equal(json.error.code, -32001);
});

test('A2AServer stream (SendStreamingMessage) yields task updates and final task', async () => {
  const server = new A2AServer({
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'T',
    agentDescription: 'T',
    agentVersion: '1.0.0',
    execute: async ({ message }) => ({
      messageId: 'r2',
      role: 'ROLE_AGENT',
      parts: [{ text: `stream-echo: ${message.parts?.[0] && 'text' in message.parts[0] ? message.parts[0].text : ''}` }],
    }),
  });
  const frames: string[] = [];
  const streamRes = await server.handleStream(
    { method: 'POST', url: '/a2a' },
    JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'SendStreamingMessage',
      params: { message: { messageId: 'sm1', role: 'ROLE_USER', parts: [{ text: 'stream me' }] } },
    }),
    (f) => frames.push(f),
  );
  assert.equal(streamRes.status, 200);
  const events = frames.map((f) => f.replace(/^data: /, '').trim()).filter(Boolean).map((s) => JSON.parse(s));
  // Expect at least: statusUpdate(WORKING) → task(COMPLETED) → final task
  assert.ok(events.length >= 3);
  const first = events[0];
  assert.ok(first.statusUpdate || first.task);
  const final = events[events.length - 1];
  assert.ok(final.task);
  assert.equal(final.task.status.state, TaskState.COMPLETED);
});

test('TaskStore lifecycle: create → working → completed', () => {
  const store = new TaskStore();
  const task = store.create({ messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'hi' }] });
  assert.equal(task.status.state, TaskState.SUBMITTED);
  store.setStatus(task.id, TaskState.WORKING);
  assert.equal(store.get(task.id)?.status.state, TaskState.WORKING);
  store.addArtifact(task.id, { artifactId: 'a1', parts: [{ text: 'out' }] });
  store.setStatus(task.id, TaskState.COMPLETED);
  assert.equal(store.get(task.id)?.artifacts?.[0]?.parts?.[0]?.text, 'out');
});

// ── plugin entry (fake ctx) ────────────────────────────────────────────────

test('plugin apply in server mode registers routes on fake webServer', async () => {
  const web = makeFakeWebServer();
  const ctx = makeFakeCtx({ webServer: web });
  apply(ctx as never, {
    mode: 'server',
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'DSH',
    agentDescription: 'D',
    agentVersion: '0.1.0',
  });
  assert.equal(web.routes.length, 3); // card + rpc + dashboard api
  const paths = web.routes.map((r) => r.path);
  assert.ok(paths.includes('/.well-known/agent-card.json'));
  assert.ok(paths.includes('/a2a'));
  assert.ok(paths.includes('/a2a/api'));
  // Real DSH WebRoute contract: single-object register with `kind`.
  const cardRoute = web.routes.find((r) => r.path === '/.well-known/agent-card.json')!;
  const rpcRoute = web.routes.find((r) => r.path === '/a2a')!;
  assert.equal(cardRoute.kind, 'exact');
  assert.equal(rpcRoute.kind, 'prefix');
  ctx.disposeEffects();
  assert.equal(web.routes.length, 0);
});

test('plugin apply in client mode registers tools when tools service exists', async () => {
  const tools = makeFakeTools();
  const ctx = makeFakeCtx({ tools });
  apply(ctx as never, {
    mode: 'client',
    name: 'echo',
    agentCardUrl: `http://127.0.0.1:${mock!.port}`,
  });
  // registration is async; await a tick
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(tools.defs.length, 1);
  ctx.disposeEffects();
  assert.equal(tools.defs.length, 0);
});

test('shell executor runs a shell command (explicit opt-in)', async () => {
  const res = await shellExecutor({
    message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'echo shell-ok' }] },
    taskId: 't',
    contextId: 'c',
    signal: new AbortController().signal,
  });
  assert.ok(res.parts?.[0] && 'text' in res.parts[0]);
  assert.match(res.parts[0].text ?? '', /shell-ok/);
  // defaultExecutor is a backwards-compatible alias of shellExecutor.
  assert.equal(defaultExecutor, shellExecutor);
});

test('A2AServer without execute refuses instead of shelling out', async () => {
  const server = new A2AServer({
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'T',
    agentDescription: 'T',
    agentVersion: '1.0.0',
  });
  const res = await server.handle(
    { method: 'POST', url: '/a2a' },
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'SendMessage',
      params: {
        message: { role: 'ROLE_USER', parts: [{ text: 'echo should-not-run' }] },
      },
    }),
  );
  const json = JSON.parse(res.body);
  assert.equal(json.result.task.status.state, TaskState.COMPLETED);
  const text = json.result.task.status.message.parts[0].text;
  assert.ok(text.includes('no executor configured'), `refused: ${text}`);
});

test('notConfiguredExecutor never executes shell', async () => {
  const res = await notConfiguredExecutor({
    message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'echo pwned' }] },
    taskId: 't',
    contextId: 'c',
    signal: new AbortController().signal,
  });
  const text = res.parts?.[0] && 'text' in res.parts[0] ? res.parts[0].text : '';
  // Refuses, and the reply is a refusal notice — not a shell transcript.
  assert.ok(text.includes('no executor configured'));
  assert.ok(!text.includes('pwned\n'), 'must not have produced command output');
});

test('A2A_METHODS constant reflects v1.0 names', () => {
  assert.equal(A2A_METHODS.sendMessage, 'SendMessage');
  assert.equal(A2A_METHODS.sendStreamingMessage, 'SendStreamingMessage');
});

test('dashboard API serves snapshot and routes control actions', async () => {
  const web = makeFakeWebServer();
  const ctx = makeFakeCtx({ webServer: web });
  apply(ctx as never, {
    mode: 'server',
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'DSH',
    agentDescription: 'D',
    agentVersion: '0.1.0',
  });
  const api = web.routes.find((r) => r.path === '/a2a/api')!;
  assert.ok(api, 'dashboard api route registered');

  // GET snapshot
  let captured: { status: number; body: string } | undefined;
  const fakeRes = {
    writeHead(code: number, _headers?: Record<string, string>) {
      captured = { status: code, body: '' };
    },
    end(body?: string) {
      if (captured) captured.body = String(body);
    },
  } as never;
  await api.handler(
    { method: 'GET', url: '/a2a/api', headers: { host: '127.0.0.1:3080' }, on: () => {}, once: () => {} } as never,
    fakeRes,
  );
  assert.equal(captured?.status, 200);
  const snap = JSON.parse(captured!.body);
  assert.ok(Array.isArray(snap.inbound));
  assert.ok(Array.isArray(snap.outbound));
  ctx.disposeEffects();
});
test('client mode dashboard tracks outbound agent and supports close', async () => {
  const tools = makeFakeTools();
  const ctx = makeFakeCtx({ tools });
  apply(ctx as never, {
    mode: 'client',
    name: 'echo',
    agentCardUrl: `http://127.0.0.1:${mock!.port}`,
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(tools.defs.length, 1);
  // The shared registry now carries the outbound connection.
  const { getSharedRegistry } = await import('../src/dashboard.js');
  const snap = getSharedRegistry().snapshot();
  assert.equal(snap.outbound.length, 1);
  assert.equal(snap.outbound[0].state, 'connected');
  assert.equal(snap.outbound[0].agentName, 'echo-agent');
  assert.equal(snap.outbound[0].toolCount, 1);
  ctx.disposeEffects();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(tools.defs.length, 0);
  // Disposal tears the connection down: the row leaves the registry.
  assert.equal(getSharedRegistry().snapshot().outbound.length, 0);
});

test('A2AServer with authToken returns 401 on missing/incorrect token', async () => {
  const server = new A2AServer({
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'T',
    agentVersion: '1.0.0',
    execute: async ({ message }) => ({
      messageId: 'm',
      role: 'ROLE_AGENT',
      parts: [{ text: 'ok' }],
    }),
    authToken: 'secret123',
  });
  // Missing token
  const noAuth = await server.handle(
    { method: 'POST', url: '/a2a' },
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }] } } }),
  );
  assert.equal(noAuth.status, 401);
  assert.ok(noAuth.headers?.['WWW-Authenticate'] === 'Bearer');
  // Wrong token
  const wrong = await server.handle(
    { method: 'POST', url: '/a2a', headers: { authorization: 'Bearer not-secret' } },
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }] } } }),
  );
  assert.equal(wrong.status, 401);
  // Correct token passes
  const ok = await server.handle(
    { method: 'POST', url: '/a2a', headers: { authorization: 'Bearer secret123' } },
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }] } } }),
  );
  assert.equal(ok.status, 200);
  const json = JSON.parse(ok.body);
  assert.equal(json.result.task.status.state, TaskState.COMPLETED);
  // AgentCard declares the scheme and requirement
  const card = JSON.parse((await server.handle({ method: 'GET', url: '/.well-known/agent-card.json' })).body);
  assert.ok(card.securitySchemes?.bearerAuth?.type === 'http');
  assert.ok(card.securitySchemes?.bearerAuth?.scheme === 'bearer');
  assert.ok(Array.isArray(card.securityRequirements) && card.securityRequirements[0]?.schemes?.bearerAuth);
});

test('A2AServer without authToken does not require auth', async () => {
  const server = new A2AServer({
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'T',
    agentVersion: '1.0.0',
    execute: async () => ({ messageId: 'm', role: 'ROLE_AGENT', parts: [{ text: 'ok' }] }),
  });
  const res = await server.handle(
    { method: 'POST', url: '/a2a' },
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }] } } }),
  );
  assert.equal(res.status, 200);
  const card = JSON.parse((await server.handle({ method: 'GET', url: '/.well-known/agent-card.json' })).body);
  assert.equal(card.securitySchemes, undefined);
});

test('A2AServer authToken protects SSE streaming too', async () => {
  const server = new A2AServer({
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'T',
    agentVersion: '1.0.0',
    execute: async ({ signal }) => {
      await new Promise((r) => signal?.addEventListener('abort', r, { once: true }));
      return { messageId: 'm', role: 'ROLE_AGENT', parts: [{ text: 'done' }] };
    },
    authToken: 'sse-secret',
  });
  let frames = '';
  const noAuth = await server.handleStream(
    { method: 'POST', url: '/a2a', headers: { accept: 'text/event-stream' } },
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendStreamingMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: 'x' }] } } }),
    (f) => (frames += f),
  );
  assert.equal(noAuth.status, 401);
  assert.ok(noAuth.headers?.['WWW-Authenticate'] === 'Bearer');
  assert.equal(frames, '', 'must not emit SSE frames when unauthorized');
});

// ── dshAgentExecutor ─────────────────────────────────────────────────────────

/**
 * A minimal fake of the `ctx.agents` surface: one create() mints an agent whose
 * whenIdle() resolves after its send() was called, and whose deriveMessages()
 * returns a scripted history. Records calls so tests can assert the contract.
 */
type FakeHist = Array<{ role: 'user' | 'assistant'; content: Array<{ type: string; text?: string }> }>;

function makeFakeAgents(opts: {
  reply?: string | null;
  createRejects?: string;
} = {}) {
  const calls: {
    create: Array<{ sessionId: string; cwd?: string; agentOptions?: unknown }>;
    resume: Array<{ sessionId: string }>;
    send: Array<{ target: string; wakeup: boolean; text: string }>;
    disposed: number;
    canceled: number;
    whenIdleAwaited: number;
  } = { create: [], resume: [], send: [], disposed: 0, canceled: 0, whenIdleAwaited: 0 };

  // Persisted "logs" keyed by sessionId, so resume() can reload history.
  const logs = new Map<string, FakeHist>();
  // Live agents keyed by sessionId (get()).
  const live = new Map<string, ReturnType<typeof makeAgent>>();

  function makeAgent(sessionId: string) {
    const history: FakeHist = logs.get(sessionId) ?? [];
    logs.set(sessionId, history);
    return {
      session: { deriveMessages() { return history.slice(); } },
      send(m: { content: Array<{ type: string; text?: string }> }, target: string, wakeup: boolean) {
        const sent = m.content.map((b) => b.text ?? '').join('');
        calls.send.push({ target, wakeup, text: sent });
        history.push({ role: 'user', content: [{ type: 'text', text: sent }] });
        if (opts.reply !== null) history.push({ role: 'assistant', content: [{ type: 'text', text: opts.reply ?? `echo: ${sent}` }] });
      },
      async whenIdle() { calls.whenIdleAwaited++; },
      cancel() { calls.canceled++; },
    };
  }

  const agents: AgentRegistryLike = {
    async create(o) {
      calls.create.push({ sessionId: o.sessionId, cwd: o.meta?.cwd, agentOptions: o.agentOptions });
      if (opts.createRejects) throw new Error(opts.createRejects);
      if (logs.has(o.sessionId)) throw new Error(`session "${o.sessionId}" already has a persisted log`);
      const agent = makeAgent(o.sessionId);
      live.set(o.sessionId, agent);
      return { agent, async dispose() { calls.disposed++; live.delete(o.sessionId); } };
    },
    async resume(o) {
      calls.resume.push({ sessionId: o.resumeSessionId });
      const agent = makeAgent(o.resumeSessionId);
      live.set(o.resumeSessionId, agent);
      return { agent, async dispose() { calls.disposed++; live.delete(o.resumeSessionId); } };
    },
    get(id) { return live.get(id); },
  };
  return { agents, calls, logs };
}

const partText = (res: { parts?: Array<{ text?: string }> }): string =>
  res.parts?.[0] && 'text' in res.parts[0] ? res.parts[0].text ?? '' : '';

test('dshAgentExecutor: creates a workspace-bound session per context, sends next-turn, returns reply', async () => {
  const { agents, calls } = makeFakeAgents({ reply: 'hi from dsh' });
  const execute = createDshAgentExecutor(agents, { cwd: '/tmp/ws', plugin: 'a2a' });
  const res = await execute({
    message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
    taskId: 't1', contextId: 'ctx-1', signal: new AbortController().signal,
  });
  assert.equal(res.role, 'ROLE_AGENT');
  assert.equal(partText(res), 'hi from dsh');
  // one session, bound to cwd, id derived from the A2A contextId
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].cwd, '/tmp/ws');
  assert.equal(calls.create[0].sessionId, 'a2a-ctx-1');
  assert.deepEqual(calls.send, [{ target: 'next-turn', wakeup: true, text: 'hello' }]);
  assert.equal(calls.whenIdleAwaited, 1);
  // NOT disposed per task — session stays live to accumulate context
  assert.equal(calls.disposed, 0);
  await execute.disposeAll();
  assert.equal(calls.disposed, 1);
});

test('dshAgentExecutor: same contextId reuses one session (history accumulates)', async () => {
  const { agents, calls, logs } = makeFakeAgents({ reply: 'ok' });
  const execute = createDshAgentExecutor(agents, { cwd: '/tmp/ws' });
  const send = (text: string) => execute({ message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text }] }, taskId: 't', contextId: 'ctx-A', signal: new AbortController().signal });
  await send('first');
  await send('second');
  // only ONE create for the context; second task reused the live agent
  assert.equal(calls.create.length, 1);
  assert.equal(calls.resume.length, 0);
  // both turns landed on the same session log (user+assistant × 2)
  assert.equal(logs.get('a2a-ctx-A')!.length, 4);
  await execute.disposeAll();
});

test('dshAgentExecutor: distinct contexts get distinct sessions', async () => {
  const { agents, calls } = makeFakeAgents({ reply: 'ok' });
  const execute = createDshAgentExecutor(agents, { cwd: '/tmp/ws' });
  await execute({ message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'a' }] }, taskId: 't', contextId: 'ctx-1', signal: new AbortController().signal });
  await execute({ message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'b' }] }, taskId: 't', contextId: 'ctx-2', signal: new AbortController().signal });
  assert.deepEqual(calls.create.map((c) => c.sessionId).sort(), ['a2a-ctx-1', 'a2a-ctx-2']);
  await execute.disposeAll();
  assert.equal(calls.disposed, 2);
});

test('dshAgentExecutor: create rejection surfaces as a readable artifact', async () => {
  const { agents, calls } = makeFakeAgents({ createRejects: 'no agent-loop factory registered' });
  const execute = createDshAgentExecutor(agents, { cwd: '/tmp/ws' });
  const res = await execute({
    message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
    taskId: 't', contextId: 'c', signal: new AbortController().signal,
  });
  assert.match(partText(res), /DSH agent executor error: no agent-loop factory registered/);
  assert.equal(calls.disposed, 0);
});

test('dshAgentExecutor: empty prompt short-circuits without creating an agent', async () => {
  const { agents, calls } = makeFakeAgents();
  const execute = createDshAgentExecutor(agents, { cwd: '/tmp/ws' });
  const res = await execute({
    message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: '   ' }] },
    taskId: 't', contextId: 'c', signal: new AbortController().signal,
  });
  assert.equal(partText(res), 'No prompt provided.');
  assert.equal(calls.create.length, 0);
});

test('dshAgentExecutor: no assistant reply yields a readable placeholder', async () => {
  const { agents } = makeFakeAgents({ reply: null });
  const execute = createDshAgentExecutor(agents, { cwd: '/tmp/ws' });
  const res = await execute({
    message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
    taskId: 't', contextId: 'c', signal: new AbortController().signal,
  });
  assert.equal(partText(res), '(no reply)');
  await execute.disposeAll();
});

test('dshAgentExecutor: pre-aborted signal cancels the turn and marks the reply canceled', async () => {
  const { agents, calls } = makeFakeAgents({ reply: 'partial' });
  const execute = createDshAgentExecutor(agents, { cwd: '/tmp/ws' });
  const ac = new AbortController();
  ac.abort();
  const res = await execute({
    message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
    taskId: 't', contextId: 'c', signal: ac.signal,
  });
  assert.equal(calls.canceled, 1);
  assert.match(partText(res), /^\(canceled\)/);
  await execute.disposeAll();
});

// ── runtime authToken + dashboard control threading ──────────────────────────

test('A2AServer.setAuthToken gates and ungates the endpoint at runtime', async () => {
  const server = new A2AServer({
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'T', agentDescription: 'T', agentVersion: '1.0.0',
    execute: async () => ({ messageId: 'm', role: 'ROLE_AGENT', parts: [{ text: 'ok' }] }),
  });
  const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }] } } });

  // initially open
  assert.equal(server.authConfigured, false);
  assert.equal((await server.handle({ method: 'POST', url: '/a2a' }, rpc)).status, 200);

  // set a token → now gated, card advertises the scheme
  server.setAuthToken('live-secret');
  assert.equal(server.authConfigured, true);
  assert.equal((await server.handle({ method: 'POST', url: '/a2a' }, rpc)).status, 401);
  assert.equal((await server.handle({ method: 'POST', url: '/a2a', headers: { authorization: 'Bearer live-secret' } }, rpc)).status, 200);
  let card = JSON.parse((await server.handle({ method: 'GET', url: '/.well-known/agent-card.json' })).body);
  assert.ok(card.securitySchemes?.bearerAuth?.scheme === 'bearer');

  // clear it → open again, scheme withdrawn
  server.setAuthToken(undefined);
  assert.equal(server.authConfigured, false);
  assert.equal((await server.handle({ method: 'POST', url: '/a2a' }, rpc)).status, 200);
  card = JSON.parse((await server.handle({ method: 'GET', url: '/.well-known/agent-card.json' })).body);
  assert.equal(card.securitySchemes, undefined);
  assert.equal(card.securityRequirements, undefined);
});

test('dashboard set-server-auth forwards the token to the hook', async () => {
  const { DashboardRegistry } = await import('../src/dashboard.js');
  const reg = new DashboardRegistry();
  let received: string | undefined | 'unset' = 'unset';
  reg.setHooks({ setServerAuthToken: async (token) => { received = token; return { ok: true, message: 'done' }; } });

  const set = await reg.control('set-server-auth', '', { authToken: 'abc' });
  assert.equal(set.ok, true);
  assert.equal(received, 'abc');

  // empty string clears (forwarded as undefined)
  const clear = await reg.control('set-server-auth', '', { authToken: '' });
  assert.equal(clear.ok, true);
  assert.equal(received, undefined);
});

test('dashboard add-agent / discover-agent forward the bearer token', async () => {
  const { DashboardRegistry } = await import('../src/dashboard.js');
  const reg = new DashboardRegistry();
  const seen: { add?: string; discover?: string } = {};
  reg.setHooks({
    addAgent: async (_n, _u, opts) => { seen.add = opts?.bearerToken; return { ok: true, message: 'added' }; },
    discoverAgent: async (_u, opts) => { seen.discover = opts?.bearerToken; return { ok: true, message: 'ok' }; },
  });
  await reg.control('discover-agent', '', { agentCardUrl: 'https://x/.well-known/agent-card.json', bearerToken: 'tok1' });
  await reg.control('add-agent', 'echo', { agentCardUrl: 'https://x/.well-known/agent-card.json', bearerToken: 'tok2' });
  assert.equal(seen.discover, 'tok1');
  assert.equal(seen.add, 'tok2');
});

test('dshAgentExecutor: resolveAgentOptions seeds the model per task (over static)', async () => {
  const { agents, calls } = makeFakeAgents({ reply: 'ok' });
  let model = 'deepseek-v4-flash';
  const execute = createDshAgentExecutor(agents, {
    cwd: '/tmp/ws',
    agentOptions: { model: 'static-fallback' },
    resolveAgentOptions: () => ({ provider: 'deepseek', model }),
  });
  await execute({ message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'hi' }] }, taskId: 't', contextId: 'c1', signal: new AbortController().signal });
  // switch the model; a NEW context should pick it up (distinct sessions)
  model = 'deepseek-v4-pro';
  await execute({ message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'hi' }] }, taskId: 't', contextId: 'c2', signal: new AbortController().signal });
  assert.deepEqual(calls.create[0].agentOptions, { provider: 'deepseek', model: 'deepseek-v4-flash' });
  assert.deepEqual(calls.create[1].agentOptions, { provider: 'deepseek', model: 'deepseek-v4-pro' });
  await execute.disposeAll();
  assert.equal(calls.disposed, 2);
});

test('dshAgentExecutor: onSessionOpened fires once per context with sessionId + first prompt', async () => {
  const { agents } = makeFakeAgents({ reply: 'ok' });
  const opened: Array<{ sessionId: string; contextId: string; firstPrompt: string }> = [];
  const execute = createDshAgentExecutor(agents, {
    cwd: '/tmp/ws',
    onSessionOpened: ({ sessionId, contextId, firstPrompt }) => { opened.push({ sessionId, contextId, firstPrompt }); },
  });
  const send = (text: string, ctx: string) => execute({ message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text }] }, taskId: 't', contextId: ctx, signal: new AbortController().signal });
  await send('first hello', 'ctx-A');
  await send('second msg', 'ctx-A'); // same context → no second hook
  await send('other', 'ctx-B');      // distinct context → one more hook
  assert.equal(opened.length, 2);
  assert.deepEqual(opened[0], { sessionId: 'a2a-ctx-A', contextId: 'ctx-A', firstPrompt: 'first hello' });
  assert.deepEqual(opened[1], { sessionId: 'a2a-ctx-B', contextId: 'ctx-B', firstPrompt: 'other' });
  await execute.disposeAll();
});

test('CancelTask aborts the running executor via its signal', async () => {
  let sawAbort = false;
  let settledCount = 0;
  const server = new A2AServer({
    baseUrl: 'http://127.0.0.1:3080',
    agentName: 'T', agentDescription: 'T', agentVersion: '1.0.0',
    onTaskSettled: () => { settledCount++; },
    execute: async ({ signal }) => {
      // Wait until aborted (CancelTask must reach us through the signal).
      await new Promise<void>((resolve) => {
        if (signal.aborted) { sawAbort = true; return resolve(); }
        signal.addEventListener('abort', () => { sawAbort = true; resolve(); }, { once: true });
      });
      return { messageId: 'm', role: Role.AGENT, parts: [{ text: 'stopped' }] };
    },
  });
  // Start a task (don't await — it blocks until we cancel).
  const send = server.handle(
    { method: 'POST', url: '/a2a' },
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: 'm1', contextId: 'c1', role: 'ROLE_USER', parts: [{ text: 'work' }] } } }),
  );
  // Give the executor a tick to register its abort controller, then find the task id.
  await new Promise((r) => setTimeout(r, 20));
  const listed = await server.handle({ method: 'POST', url: '/a2a' }, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ListTasks', params: {} }));
  const taskId = JSON.parse(listed.body).result.tasks[0].id;
  const cancelRes = await server.handle({ method: 'POST', url: '/a2a' }, JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'CancelTask', params: { id: taskId } }));
  assert.equal(JSON.parse(cancelRes.body).result.status.state, TaskState.CANCELED);
  await send; // executor unblocks because the signal fired
  assert.equal(sawAbort, true, 'executor must observe the abort signal from CancelTask');
  // The task must STAY canceled — the returning executor must not overwrite it
  // with COMPLETED, and onTaskSettled must fire exactly once (from CancelTask).
  const after = await server.handle({ method: 'POST', url: '/a2a' }, JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'GetTask', params: { id: taskId } }));
  assert.equal(JSON.parse(after.body).result.status.state, TaskState.CANCELED);
  assert.equal(settledCount, 1, 'onTaskSettled must fire once, not twice');
});

test('outbound tool reuses one contextId per local agent (cross-call memory), isolates distinct agents', async () => {
  const tools = makeFakeTools();
  await registerAgentTools(tools, { name: 'echo', agentCardUrl: `http://127.0.0.1:${mock!.port}` });
  const def = tools.defs[0];
  // The mock's task store accumulates across the whole suite; find the contextId
  // of the task whose echoed prompt equals `marker` (unique per call here).
  const ctxOf = (marker: string): string | undefined => {
    for (const t of mock!.tasks.values()) {
      const h = (t as { history?: Array<{ contextId?: string; parts?: Array<{ text?: string }> }> }).history?.[0];
      if (h?.parts?.[0]?.text === marker) return h.contextId ?? '';
    }
    return undefined;
  };

  // two calls from the SAME local agent → same contextId
  await def.execute?.({ prompt: 'ctx-a' }, { agent: { id: 'local-1' } });
  await def.execute?.({ prompt: 'ctx-b' }, { agent: { id: 'local-1' } });
  const a = ctxOf('ctx-a');
  assert.match(a ?? '', /^a2a-out-/);
  assert.equal(a, ctxOf('ctx-b'), 'same local agent must reuse one remote contextId');

  // a DIFFERENT local agent → different contextId
  await def.execute?.({ prompt: 'ctx-c' }, { agent: { id: 'local-2' } });
  assert.notEqual(ctxOf('ctx-c'), a, 'distinct local agents must get distinct contexts');

  // no agent context → a stable fallback (same across calls)
  await def.execute?.({ prompt: 'ctx-d' }, {});
  await def.execute?.({ prompt: 'ctx-e' }, {});
  assert.equal(ctxOf('ctx-d'), ctxOf('ctx-e'), 'agentless calls share one stable fallback context');
});
