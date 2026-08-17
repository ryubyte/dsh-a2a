/**
 * A2A (Agent2Agent) Protocol v1.0 — JSON-RPC 2.0 transport client.
 *
 * Implements the JSONRPC protocol binding of A2A v1.0: a thin JSON-RPC 2.0
 * client for unary calls plus an SSE reader for `SendStreamingMessage`.
 */
import { A2AError } from './errors.js';
export class JsonRpcClient {
    url;
    timeoutMs;
    bearerToken;
    fetchImpl;
    seq = 0;
    constructor(url, options = {}) {
        this.url = url;
        this.timeoutMs = options.timeoutMs ?? 60000;
        this.bearerToken = options.bearerToken;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    }
    headers(extra) {
        const h = {
            'content-type': 'application/json',
            accept: 'application/json',
            ...extra,
        };
        if (this.bearerToken)
            h.authorization = `Bearer ${this.bearerToken}`;
        return h;
    }
    /** Perform a unary JSON-RPC call. */
    async call(method, params, options = {}) {
        const req = {
            jsonrpc: '2.0',
            id: ++this.seq,
            method,
            params,
        };
        const ctrl = options.signal ? new AbortController() : undefined;
        const onAbort = () => ctrl?.abort();
        options.signal?.addEventListener('abort', onAbort);
        const timeout = setTimeout(() => ctrl?.abort(), options.timeoutMs ?? this.timeoutMs);
        try {
            const res = await this.fetchImpl(this.url, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify(req),
                signal: ctrl?.signal,
            });
            if (!res.ok) {
                throw new A2AError(res.status, `A2A JSON-RPC request failed (HTTP ${res.status}) at ${this.url}`, undefined, true);
            }
            const json = (await res.json());
            if ('error' in json && json.error) {
                throw A2AError.fromJsonRpc(json.error);
            }
            return json.result;
        }
        catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                throw new A2AError(408, `A2A JSON-RPC call "${method}" timed out`, undefined, true);
            }
            throw err;
        }
        finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', onAbort);
        }
    }
    /**
     * Open a streaming JSON-RPC call (`SendStreamingMessage`) over SSE and
     * yield the `StreamResponse` events as they arrive. The connection is
     * closed when the returned async iterator is broken or the request is
     * cancelled. Events are decoded from SSE `data:` lines (JSON-RPC result
     * frames); per A2A v1.0 the JSON structure uses member names to
     * discriminate `task` / `message` / `statusUpdate` / `artifactUpdate`.
     */
    async *stream(method, params, options = {}) {
        const req = {
            jsonrpc: '2.0',
            id: ++this.seq,
            method,
            params,
        };
        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        options.signal?.addEventListener('abort', onAbort);
        const timeout = setTimeout(() => ctrl.abort(), options.timeoutMs ?? this.timeoutMs);
        let res;
        try {
            res = await this.fetchImpl(this.url, {
                method: 'POST',
                headers: this.headers({ accept: 'text/event-stream' }),
                body: JSON.stringify(req),
                signal: ctrl.signal,
            });
        }
        catch (err) {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', onAbort);
            if (err instanceof Error && err.name === 'AbortError') {
                throw new A2AError(408, `A2A stream "${method}" timed out`, undefined, true);
            }
            throw err;
        }
        if (!res.ok || !res.body) {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', onAbort);
            throw new A2AError(res.status, `A2A stream request failed (HTTP ${res.status}) at ${this.url}`, undefined, true);
        }
        try {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                // SSE frames are separated by a blank line.
                const frames = buffer.split(/\r?\n\r?\n/);
                buffer = frames.pop() ?? '';
                for (const frame of frames) {
                    const data = frame
                        .split(/\r?\n/)
                        .filter((l) => l.startsWith('data:'))
                        .map((l) => l.slice(5).trimStart())
                        .join('\n');
                    if (!data)
                        continue;
                    let payload;
                    try {
                        payload = JSON.parse(data);
                    }
                    catch {
                        continue; // ignore malformed frames
                    }
                    // A JSON-RPC error frame terminates the stream.
                    const envelope = payload;
                    if (envelope && 'error' in envelope && envelope.error) {
                        throw A2AError.fromJsonRpc(envelope.error);
                    }
                    yield payload;
                }
            }
        }
        finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', onAbort);
        }
    }
}
