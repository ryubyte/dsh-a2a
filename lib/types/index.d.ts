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
import { type ServerOptions } from './server.js';
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
export { A2AServer, TaskStore, defaultExecutor, notConfiguredExecutor, shellExecutor, defaultSkills } from './server.js';
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
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Provided by @deepseek-ai/dsh-host-webserver. */
        webServer: WebServerService;
        /** Provided by @deepseek-ai/dsh-tools. */
        tools: {
            register(def: unknown): () => void;
        };
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
//# sourceMappingURL=index.d.ts.map