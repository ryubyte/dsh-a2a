/**
 * End-to-end smoke: mount the plugin's inbound A2AServer on a real HTTP
 * server, then drive it with the outbound A2AClient over the wire.
 *
 * Shows the ephemeral-port pattern: build the server, listen, then call
 * `server.setBaseUrl()` with the real address so the AgentCard advertises a
 * reachable interface.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { A2AServer } from '../src/server.js';
import { A2AClient } from '../src/client.js';

const server = new A2AServer({
  baseUrl: 'http://127.0.0.1:0',
  agentName: 'Smoke DSH',
  agentDescription: 'E2E smoke agent',
  agentVersion: '1.0.0',
  skills: [{ id: 'echo', name: 'Echo', description: 'Echo a prompt', tags: ['echo'], inputModes: ['text/plain'], outputModes: ['text/plain'] }],
  execute: async ({ message }) => {
    const text = message.parts.map((p) => ('text' in p ? p.text : '')).join('');
    return { messageId: crypto.randomUUID(), role: 'ROLE_AGENT', parts: [{ text: `ack:${text}` }] };
  },
});

const http = createServer(async (req, res) => {
  const url = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && url === '/.well-known/agent-card.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(server.card));
    return;
  }
  if (req.method === 'POST' && url === '/a2a') {
    const isStream = (req.headers.accept ?? '').includes('text/event-stream');
    let body = '';
    for await (const c of req) body += c;
    if (isStream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      await server.handleStream(req, body, (frame) => res.write(frame));
      res.end();
      return;
    }
    const out = await server.handle(req, body);
    res.writeHead(out.status, { 'content-type': out.contentType });
    res.end(out.body);
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
const port = (http.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;
server.setBaseUrl(base);

try {
  // 1. Client discovers the card over the wire.
  const client = await A2AClient.connect(base);
  console.log('card.name =', client.card.name);
  console.log('endpoint  =', client.endpointUrl);
  console.log('skill     =', client.card.skills?.[0]?.id);

  // 2. Unary SendMessage round-trip.
  const resp = await client.sendMessage({
    messageId: crypto.randomUUID(),
    role: 'ROLE_USER',
    parts: [{ text: 'hello-e2e' }],
  });
  if (!('task' in resp) || !resp.task) throw new Error('expected a task');
  console.log('task.state =', resp.task.status.state);
  console.log('artifact   =', resp.task.artifacts?.[0]?.parts?.[0]?.text);

  // 3. Streaming round-trip.
  const events: unknown[] = [];
  for await (const ev of client.streamMessage({
    messageId: crypto.randomUUID(),
    role: 'ROLE_USER',
    parts: [{ text: 'stream-e2e' }],
  })) {
    events.push(ev);
  }
  console.log('stream events =', events.length);
  const last = events[events.length - 1] as { task?: { status: { state: string } } };
  if (!last?.task) throw new Error('stream did not end with a task');
  console.log('stream final  =', last.task.status.state);

  console.log('\nE2E SMOKE OK');
} finally {
  http.close();
}