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
export class A2AError extends Error {
  readonly code: number;
  readonly data?: unknown;
  /** True when this error came from a remote agent over the wire. */
  readonly remote: boolean;

  constructor(code: number, message: string, data?: unknown, remote = false) {
    super(message);
    this.name = 'A2AError';
    this.code = code;
    this.data = data;
    this.remote = remote;
  }

  toJsonRpc(): { code: number; message: string; data?: unknown } {
    const out: { code: number; message: string; data?: unknown } = {
      code: this.code,
      message: this.message,
    };
    if (this.data !== undefined) out.data = this.data;
    return out;
  }

  static fromJsonRpc(err: A2ARemoteErrorInfo): A2AError {
    return new A2AError(err.code, err.message, err.data, true);
  }
}