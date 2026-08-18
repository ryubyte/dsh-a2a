/**
 * dsh-a2a — outbound half: bridge remote A2A agent skills into DSH's tool
 * registry (`ctx.tools`).
 *
 * Each skill on a remote AgentCard becomes a model-facing tool named
 * `a2a__<agentName>__<skillId>` (normalized to the DSH function-name
 * contract: `[A-Za-z0-9_-]`, ≤64 chars; on collision a deterministic hash is
 * appended, mirroring dsh-mcp-client's naming rule).
 */
import type { AgentCard } from './protocol.js';
export interface ToolLike {
    register?(definition: unknown): (() => void) | void;
}
export interface OutboundOptions {
    /** Namespace prefix for tool names (lowercase, unique across instances). */
    name: string;
    agentCardUrl: string;
    bearerToken?: string;
    /** Per-call timeout in ms. Default 60000. */
    timeoutMs?: number;
    /** Register one generic tool per skill (default true). */
    mapSkills?: boolean;
    /**
     * Optional connection-lifecycle observation: called once the AgentCard is
     * fetched and the connection is usable. `connectionId` is the stable id the
     * dashboard tracks this connection under.
     */
    onReady?: (info: {
        connectionId: string;
        card: AgentCard;
    }) => void;
    /** Called when the connection (and its tools) are torn down. */
    onDispose?: (connectionId: string) => void;
}
export interface RegisteredTool {
    name: string;
    /** Stable id of the client connection this tool belongs to. */
    connectionId?: string;
    dispose: () => void;
}
/**
 * Register all skills of a remote agent on `ctx.tools` and return disposers.
 */
export declare function registerAgentTools(tools: ToolLike, options: OutboundOptions): Promise<RegisteredTool[]>;
//# sourceMappingURL=outbound.d.ts.map