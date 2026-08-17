/**
 * A2A (Agent2Agent) Protocol v1.0 — AgentCard discovery and validation.
 *
 * Reproduces the protocol's discovery contract: fetch the manifest at
 * `/.well-known/agent-card.json` (or a configured URL). Per the spec, when a
 * path is configured without a well-known segment the client SHOULD probe the
 * well-known location first, then fall back to the configured path.
 */
import type { AgentCard, AgentInterface } from './protocol.js';
export interface AgentCardOptions {
    /** How long a single fetch may take (ms). Default 15000. */
    timeoutMs?: number;
    /** Optional bearer token sent as `Authorization: Bearer <token>`. */
    bearerToken?: string;
    /** Optional custom fetch implementation (for tests). */
    fetchImpl?: typeof fetch;
}
export declare function isAgentCard(value: unknown): value is AgentCard;
/**
 * Fetch and validate an agent's AgentCard.
 *
 * Discovery order (per spec §AgentCard discovery):
 *   1. Probe `GET {origin}/.well-known/agent-card.json` first.
 *   2. Fall back to the exact configured URL.
 * A configured URL that already ends in `agent-card.json` is used directly.
 */
export declare function fetchAgentCard(baseUrl: string, options?: AgentCardOptions): Promise<AgentCard>;
/**
 * Pick the best interface to talk to an agent from its AgentCard.
 *
 * Preference order: a JSONRPC interface first, then gRPC, then any other
 * binding; the card's own ordering ("first entry is preferred") is respected
 * within each binding class. Returns the interface and a normalized base URL
 * to post JSON-RPC requests to.
 */
export declare function pickInterface(card: AgentCard, preferred?: string): {
    iface: AgentInterface;
    url: string;
};
