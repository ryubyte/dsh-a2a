import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { get } from 'node:http';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import semver from 'semver';
import { apply, inferBaseUrl, webServerBaseUrl } from '../src/index.js';
import { registerAgentTools } from '../src/outbound.js';
import { makeFakeCtx, startMockAgent } from './fixtures.js';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const versions: string[] = JSON.parse(readFileSync(new URL('../scripts/dsh-versions.json', import.meta.url), 'utf8'));
const dshPeers = Object.entries(manifest.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'));

test('every supported prerelease satisfies npm peers and the DSH includePrerelease gate', () => {
  for (const version of versions) {
    for (const [name, range] of dshPeers) {
      assert.ok(semver.satisfies(version, range as string), `${name}: npm rejected ${version}`);
      assert.ok(semver.satisfies(version, range as string, { includePrerelease: true }), `${name}: DSH rejected ${version}`);
    }
  }
  for (const version of ['0.1.7-rc.1', '0.2.2-alpha.2', '0.2.2', '0.3.0-rc.1']) {
    for (const [, range] of dshPeers) {
      assert.equal(semver.satisfies(version, range as string, { includePrerelease: true }), false, version);
    }
  }
});

test('the matrix installs the selected DSH packages rather than the baseline', () => {
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue;
    const installed = require(`${name}/package.json`).version;
    assert.equal(installed, process.env.DSH_VERSION ?? version, name);
    assert.ok(versions.includes(installed), name);
  }
});

test('origin inference supports new HTTPS/IPv6 hosts and the legacy host contract', () => {
  const legacy = { host: '127.0.0.1', port: 3080, register: () => () => {} };
  assert.equal(webServerBaseUrl(legacy), 'http://127.0.0.1:3080');
  assert.equal(inferBaseUrl('::1', 3080), 'http://[::1]:3080');
  assert.equal(webServerBaseUrl({ ...legacy, protocol: 'https:' }), 'https://127.0.0.1:3080');
  assert.equal(webServerBaseUrl({ ...legacy, getOrigin: () => 'https://[::1]:3443' }), 'https://[::1]:3443');
  assert.throws(() => webServerBaseUrl({ ...legacy, port: undefined }), /not bound/);
  assert.throws(() => webServerBaseUrl({ ...legacy, getOrigin: () => { throw new Error('unbound'); } }), /unbound/);
});

test('real DSH WebServer serves the built-in A2A routes and removes them on unload', async () => {
  const ctx = new Context();
  const fiber = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 });
  let pluginCtx: ReturnType<typeof makeFakeCtx> | undefined;
  try {
    await fiber.await();
    const web = ctx.get('webServer')!;
    pluginCtx = makeFakeCtx({ webServer: web });
    apply(pluginCtx as never, {
      mode: 'server',
      execute: async () => ({ messageId: 'reply', role: 'ROLE_AGENT', parts: [{ text: 'real host reply' }] }),
    });
    const origin = webServerBaseUrl(web);
    const response = await fetch(`${origin}/.well-known/agent-card.json`);
    assert.equal(response.status, 200);
    const card = await response.json();
    assert.equal(card.supportedInterfaces[0].url, `${origin}/a2a`);
    const dashboardStatus = (requestOrigin: string) => new Promise<number | undefined>((resolve, reject) => {
      // Use node:http so the explicit IPv6 Host header is sent unchanged.
      get(`${origin}/a2a/api`, { headers: { host: '[::1]:3080', origin: requestOrigin } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }).on('error', reject);
    });
    assert.equal(await dashboardStatus('http://[::1]:3080'), 200, 'IPv6 loopback can access its dashboard');
    assert.equal(await dashboardStatus('https://untrusted.example'), 403);
    const rpc = await fetch(`${origin}/a2a`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: {
        message: { messageId: 'request', role: 'ROLE_USER', parts: [{ text: 'hello' }] },
      } }),
    });
    assert.equal(rpc.status, 200);
    const result = await rpc.json();
    assert.equal(result.result.task.artifacts[0].parts[0].text, 'real host reply');
    pluginCtx.disposeEffects();
    const removed = await fetch(`${origin}/.well-known/agent-card.json`);
    await removed.text();
    assert.equal(removed.status, 404);
  } finally {
    pluginCtx?.disposeEffects();
    await fiber.dispose();
  }
});

test('real DSH ToolRuntime accepts, executes and disposes outbound A2A tools', async () => {
  const mock = await startMockAgent();
  // The prompt assembler is outside this integration boundary; the registry,
  // output validation, execution pipeline and scopes are the real DSH code.
  const ctx = new Context().extend({ systemPrompt: { tools: () => () => {} } });
  const tools = new ToolRuntime(ctx);
  let registered: Awaited<ReturnType<typeof registerAgentTools>> = [];
  try {
    registered = await registerAgentTools(tools, { name: 'compat', agentCardUrl: `http://127.0.0.1:${mock.port}` });
    assert.equal(registered.length, 1);
    const name = registered[0].name;
    assert.ok(tools.schemas().some((schema) => schema.name === name));
    const result = await tools.execute({
      callId: 'compat-call', name, arguments: { prompt: 'compatibility' }, signal: new AbortController().signal,
    } as never);
    assert.equal(result.isError, false);
    assert.ok(result.content.some((block) => block.type === 'text' && block.text.includes('compatibility')));
    registered.forEach((tool) => tool.dispose());
    assert.equal(tools.schemas().some((schema) => schema.name === name), false);
  } finally {
    registered.forEach((tool) => tool.dispose());
    await new Promise<void>((resolve, reject) => mock.server.close((err) => err ? reject(err) : resolve()));
  }
});
