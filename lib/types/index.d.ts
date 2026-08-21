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
import { type ServerOptions, type AgentRegistryLike } from './server.js';
export interface A2APluginConfig {
    mode?: 'client' | 'server' | 'both';
    name?: string;
    agentCardUrl?: string;
    bearerToken?: string;
    timeoutMs?: number;
    mapSkills?: boolean;
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
export type { DashboardSnapshot, InboundPeer, OutboundAgent, ControlResult, } from './dashboard.js';
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
    currentSelection(): {
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    };
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
        tools: {
            register(def: unknown): () => void;
        };
        /**
         * Provided by @deepseek-ai/dsh-agent (the agent registry). Present whenever
         * that layer is composed, but `create()` only succeeds once an agent-loop
         * plugin has registered its factory — so server mode probes readiness
         * before enabling {@link createDshAgentExecutor}, and never hard-injects it.
         */
        agents?: AgentRegistryLike;
    }
}
export declare const name = "a2a";
/**
 * Services this plugin may read as context properties. Declared so property
 * reads inside `apply` never trip Cordis's "without inject" guard. The
 * mode-specific wiring runs inside `ctx.inject(...)` for the single service it
 * needs, so a composition lacking the other one simply idles that half.
 */
export declare const inject: readonly ["webServer", "tools"];
export declare function apply(ctx: Context, config?: A2APluginConfig): void;
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
export declare function inferBaseUrl(host: string, port: number): string;
//# sourceMappingURL=index.d.ts.map