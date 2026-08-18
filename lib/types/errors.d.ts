/**
 * A2A (Agent2Agent) Protocol v1.0 — errors.
 */
/** An error produced by a remote A2A agent (JSON-RPC error object). */
export interface A2ARemoteErrorInfo {
    code: number;
    message: string;
    data?: unknown;
}
/** Error class for A2A protocol failures, mirroring JSON-RPC error semantics. */
export declare class A2AError extends Error {
    readonly code: number;
    readonly data?: unknown;
    /** True when this error came from a remote agent over the wire. */
    readonly remote: boolean;
    constructor(code: number, message: string, data?: unknown, remote?: boolean);
    toJsonRpc(): {
        code: number;
        message: string;
        data?: unknown;
    };
    static fromJsonRpc(err: A2ARemoteErrorInfo): A2AError;
}
//# sourceMappingURL=errors.d.ts.map