/**
 * A2A (Agent2Agent) Protocol v1.0 — JSON-RPC 2.0 transport client.
 *
 * Implements the JSONRPC protocol binding of A2A v1.0: a thin JSON-RPC 2.0
 * client for unary calls plus an SSE reader for `SendStreamingMessage`.
 */
import type { StreamResponse } from './protocol.js';
export interface JsonRpcClientOptions {
    /** Timeout (ms) for a single unary call. Default 60000. */
    timeoutMs?: number;
    /** Optional bearer token. */
    bearerToken?: string;
    /** Custom fetch (tests). */
    fetchImpl?: typeof fetch;
}
export interface JsonRpcCallOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}
export declare class JsonRpcClient {
    readonly url: string;
    private readonly timeoutMs;
    private readonly bearerToken?;
    private readonly fetchImpl;
    private seq;
    constructor(url: string, options?: JsonRpcClientOptions);
    private headers;
    /** Perform a unary JSON-RPC call. */
    call<T>(method: string, params: unknown, options?: JsonRpcCallOptions): Promise<T>;
    /**
     * Open a streaming JSON-RPC call (`SendStreamingMessage`) over SSE and
     * yield the `StreamResponse` events as they arrive. The connection is
     * closed when the returned async iterator is broken or the request is
     * cancelled. Events are decoded from SSE `data:` lines (JSON-RPC result
     * frames); per A2A v1.0 the JSON structure uses member names to
     * discriminate `task` / `message` / `statusUpdate` / `artifactUpdate`.
     */
    stream<T = StreamResponse>(method: string, params: unknown, options?: JsonRpcCallOptions): AsyncGenerator<T>;
}
//# sourceMappingURL=jsonrpc.d.ts.map