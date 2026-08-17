# dsh-a2a

A **DeepSeek Harness (DSH)** plugin that implements the **Agent2Agent (A2A) Protocol v1.0** (Linux Foundation, `a2aproject/A2A`, Apache-2.0).

The plugin has two halves:

| Mode | Direction | What it does |
|---|---|---|
| `client` | outbound | Discovers a remote agent via its **AgentCard**, maps each **skill** to a DSH model tool (`a2a__<name>__<skill>`), and executes remote tasks through the A2A **JSONRPC** binding. |
| `server` | inbound | Exposes DSH as an A2A agent: serves `/.well-known/agent-card.json` plus a JSON-RPC endpoint (`SendMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SendStreamingMessage` over SSE) on the DSH webserver. |

Protocol surface implemented (v1.0 names, verified against `a2aproject/A2A` `specification/a2a.proto`):

- **Discovery**: `GET /.well-known/agent-card.json` (well-known first, configured URL fallback)
- **Unary**: `SendMessage`, `GetTask`, `ListTasks`, `CancelTask`, `GetExtendedAgentCard`
- **Streaming**: `SendStreamingMessage` (SSE) / `SubscribeToTask`, with `TaskStatusUpdateEvent` + `TaskArtifactUpdateEvent`
- **Task lifecycle**: `SUBMITTED → WORKING → COMPLETED / FAILED / CANCELED / REJECTED / INPUT_REQUIRED / AUTH_REQUIRED`
- **Types**: `Task`, `Message`, `Part` (text/raw/url/data), `Artifact`, `AgentCard`, security schemes, extensions

## Install & mount in a DSH profile

The plugin is a plain npm package. In your DSH profile (or bundle):

```bash
npm install dsh-a2a
```

Add rows to the profile's `cordis.patch.yml` (see `cordis.patch.yml` in this repo for the commented template):

```yaml
# outbound: expose a remote agent's skills as model tools
- id: a2a-remote
  name: 'dsh-a2a'
  config:
    mode: client
    name: research             # namespace → tool names a2a__research__<skill>
    agentCardUrl: https://research.example.com/.well-known/agent-card.json
    # bearerToken: !!js process.env.A2A_REMOTE_TOKEN
    # timeoutMs: 60000

# inbound: let other agents call this DSH
- id: a2a-local
  name: 'dsh-a2a'
  config:
    mode: server
    # baseUrl: http://127.0.0.1:3080   # optional; default: derive from webServer
    agentName: DSH Agent
    agentDescription: DeepSeek Harness coding agent exposed over A2A v1.0
    agentVersion: 0.1.0
    skills:
      - id: coding
        name: Coding
        description: Execute coding and shell tasks inside the DSH workspace.
        tags: ['coding', 'shell']
```

### How the plugin binds to DSH services

- The plugin reads `ctx.webServer` and `ctx.tools` as **context properties inside
  `ctx.inject(...)` / `ctx.effect(...)`** — the native Cordis pattern used by DSH
  bundles (`dsh-client-hmr`, `dsh-web-app`, …). It exports `inject: ['webServer',
  'tools']`, and each mode wraps its work in `ctx.inject([<service>], …)`, so a
  composition missing one half simply idles it (no hard dependency, no crash).
- `webServer.register` receives the real DSH `WebRoute` object
  `{ kind: 'exact' | 'prefix', path, handler }` — matching
  `@deepseek-ai/dsh-host-webserver`'s contract (a single-argument register).
- **`baseUrl` is optional in server mode**: when omitted the AgentCard
  advertises the webserver's real listen address (`http://<host>:<port>/a2a`),
  so ephemeral/OS-assigned ports never advertise a stale URL. Set `baseUrl`
  explicitly only when a reverse proxy fronts the instance.

All registrations are fiber-scoped: Cordis disposes them on plugin stop/update.

## Programmatic use

```ts
import { A2AClient, fetchAgentCard, A2AServer, TaskStore, defaultExecutor } from 'dsh-a2a';

// client
const client = await A2AClient.connect('https://agent.example.com');
const { task } = await client.sendMessage({
  messageId: crypto.randomUUID(),
  role: 'ROLE_USER',
  parts: [{ text: 'Draft a report' }],
});
for await (const ev of client.streamMessage({ messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ text: 'hi' }] })) {
  // ev.statusUpdate | ev.artifactUpdate | ev.task | ev.message
}

// server (with a custom executor wired to the DSH agent loop)
const store = new TaskStore();
const server = new A2AServer({
  baseUrl: 'http://127.0.0.1:3080',
  agentName: 'My DSH',
  agentDescription: '...',
  agentVersion: '1.0.0',
  execute: async ({ message }) => ({   // ← plug DSH's own loop here
    messageId: crypto.randomUUID(),
    role: 'ROLE_AGENT',
    parts: [{ text: await myAgentRun(message.parts) }],
  }),
}, store);
```

## Connection dashboard

Both modes report into one process-wide connection registry, exposed by the
inbound half (when `webServer` is mounted) at:

- `GET  /a2a/api` — JSON snapshot: `{ inbound: [...], outbound: [...], at }`
- `POST /a2a/api` — control: `{ action, target }` with
  `reconnect-agent | close-agent | close-peer` actions

The **settings panel** ("A2A 连接" section, registered by the browser half
`dsh-a2a/client`) shows:

| Direction | Rows | Row actions |
|---|---|---|
| 入站连接 (who is connecting TO this DSH) | peer label, source address, first/last seen, task count, streaming flag | 关闭 |
| 出站连接 (who this DSH is connected TO) | agent name, state (connected/disconnected/reconnecting), AgentCard URL, skill/tool counts, last activity | 重连 / 关闭 |

`close-agent` unregisters the remote agent's tools (tool calls fail until a
reconnect); `reconnect-agent` reconnects and re-registers them. `close-peer`
drops an inbound peer from the dashboard (observational only). The dashboard
refreshes every 3 s while the section is open; the API is loopback/same-origin
fenced.

Client-mode connection lifecycle hooks (`onReady` / `onDispose` on
`registerAgentTools`) feed the registry; multiple `dsh-a2a` instances (client
+ server) share one registry, and the `/a2a/api` route is registered once per
process.

## Security notes

- The A2A spec requires **HTTPS** for production `AgentInterface.url`; DSH's `webServer` binds loopback by default. Put a TLS reverse proxy in front before exposing an inbound server beyond localhost.
- Outbound calls send a bearer token when configured; inbound security schemes are declared on the AgentCard but enforcement is left to the composition (DSH `credentials` service).
- The default inbound executor runs a shell command — replace it with a constrained executor in real deployments (e.g. DSH's sandbox/approval pipeline).
- The dashboard API (`/a2a/api`) is loopback/same-origin fenced and carries no secrets; it exists for operator visibility and connection control only.

## Relationship to MCP / ACP

- **MCP** (already in DSH via `@deepseek-ai/dsh-mcp-client`) exposes *tools* to the model; **A2A** exposes *agents* to agents.
- **ACP** (used by Hermes/OpenClaw for IDE↔agent) is a different protocol; this plugin implements the A2A agent↔agent standard, not ACP.

## Development

```bash
npm install
npm run build    # tsc → lib/ + browser bundle → lib/client.bundle.js
npm test         # node:test + tsx (unit/integration) + client-bundle smoke
```

The browser half (`src/client/`) is bundled by `scripts/build-client.mjs`
(esbuild) into `lib/client.bundle.js` in the DSH `window.__ModuleLoader__.load`
format; `exports["./client"]` wires it into the DSH client-modules graph. The
`./client` types come from tsc's `lib/client/index.d.ts`.

Layout: `src/protocol.ts` (v1.0 types), `src/card.ts` (AgentCard discovery/validation), `src/jsonrpc.ts` (JSON-RPC 2.0 + SSE transport), `src/client.ts` (outbound client), `src/server.ts` (inbound server + TaskStore), `src/outbound.ts` (skill→tool bridge), `src/dashboard.ts` (connection registry + control), `src/index.ts` (Cordis plugin entry), `src/client/` (browser settings dashboard).