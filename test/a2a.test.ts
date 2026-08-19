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
import { A2AServer, TaskStore, defaultExecutor, notConfiguredExecutor, shellExecutor } from '../src/server.js';
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
