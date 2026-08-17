/**
 * A2A (Agent2Agent) Protocol v1.0 — AgentCard discovery and validation.
 *
 * Reproduces the protocol's discovery contract: fetch the manifest at
 * `/.well-known/agent-card.json` (or a configured URL). Per the spec, when a
 * path is configured without a well-known segment the client SHOULD probe the
 * well-known location first, then fall back to the configured path.
 */
import { A2AError } from './errors.js';
export function isAgentCard(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return (typeof v.name === 'string' &&
        typeof v.description === 'string' &&
        typeof v.version === 'string' &&
        Array.isArray(v.supportedInterfaces) &&
        typeof v.capabilities === 'object' &&
        v.capabilities !== null &&
        Array.isArray(v.defaultInputModes) &&
        Array.isArray(v.defaultOutputModes) &&
        Array.isArray(v.skills));
}
function normalizeUrl(base, path) {
    const b = base.endsWith('/') ? base.slice(0, -1) : base;
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${b}${p}`;
}
/**
 * Fetch and validate an agent's AgentCard.
 *
 * Discovery order (per spec §AgentCard discovery):
 *   1. Probe `GET {origin}/.well-known/agent-card.json` first.
 *   2. Fall back to the exact configured URL.
 * A configured URL that already ends in `agent-card.json` is used directly.
 */
export async function fetchAgentCard(baseUrl, options = {}) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 15000;
    const headers = { Accept: 'application/json' };
    if (options.bearerToken)
        headers.Authorization = `Bearer ${options.bearerToken}`;
    const wellKnown = normalizeUrl(baseUrl, '/.well-known/agent-card.json');
    const isExactCard = baseUrl.endsWith('agent-card.json') || baseUrl.endsWith('agent-card.json/');
    const candidates = isExactCard ? [baseUrl] : [wellKnown, baseUrl];
    let lastError;
    for (const url of candidates) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetchImpl(url, { headers, signal: ctrl.signal });
            if (res.status === 404) {
                lastError = new A2AError(404, `AgentCard not found at ${url}`, undefined, true);
                continue;
            }
            if (!res.ok) {
                throw new A2AError(res.status, `AgentCard request failed (${res.status}) at ${url}`, undefined, true);
            }
            const json = await res.json();
            if (!isAgentCard(json)) {
                throw new A2AError(400, `Invalid AgentCard at ${url}: missing required fields`, undefined, true);
            }
            return json;
        }
        catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                throw new A2AError(408, `AgentCard fetch timed out after ${timeoutMs}ms at ${url}`, undefined, true);
            }
            lastError = err instanceof Error ? err : new Error(String(err));
        }
        finally {
            clearTimeout(timer);
        }
    }
    throw (lastError ??
        new A2AError(404, `AgentCard could not be fetched from ${baseUrl}`, undefined, true));
}
/**
 * Pick the best interface to talk to an agent from its AgentCard.
 *
 * Preference order: a JSONRPC interface first, then gRPC, then any other
 * binding; the card's own ordering ("first entry is preferred") is respected
 * within each binding class. Returns the interface and a normalized base URL
 * to post JSON-RPC requests to.
 */
export function pickInterface(card, preferred) {
    const ifaces = card.supportedInterfaces ?? [];
    if (ifaces.length === 0) {
        throw new A2AError(-32000, `AgentCard for "${card.name}" declares no supportedInterfaces`);
    }
    const want = preferred ?? 'JSONRPC';
    const ordered = [...ifaces].sort((a, b) => {
        const ab = a.protocolBinding === want ? 0 : a.protocolBinding === 'GRPC' ? 1 : 2;
        const bb = b.protocolBinding === want ? 0 : b.protocolBinding === 'GRPC' ? 1 : 2;
        return ab - bb;
    });
    const iface = ordered[0];
    const url = iface.url.endsWith('/') ? iface.url.slice(0, -1) : iface.url;
    return { iface, url };
}
