/**
 * A2A (Agent2Agent) Protocol v1.0 — errors.
 */
/** Error class for A2A protocol failures, mirroring JSON-RPC error semantics. */
export class A2AError extends Error {
    code;
    data;
    /** True when this error came from a remote agent over the wire. */
    remote;
    constructor(code, message, data, remote = false) {
        super(message);
        this.name = 'A2AError';
        this.code = code;
        this.data = data;
        this.remote = remote;
    }
    toJsonRpc() {
        const out = {
            code: this.code,
            message: this.message,
        };
        if (this.data !== undefined)
            out.data = this.data;
        return out;
    }
    static fromJsonRpc(err) {
        return new A2AError(err.code, err.message, err.data, true);
    }
}
