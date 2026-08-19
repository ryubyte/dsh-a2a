/**
 * dsh-a2a — connection dashboard.
 *
 * Tracks both directions of A2A connectivity so the operator (and the
 * settings dashboard) can see:
 *
 *  - **inbound**  — which remote peers are talking to THIS DSH's A2A server
 *                   (peer label, source address, last activity, live tasks).
 *  - **outbound** — which remote agents THIS DSH is connected to via the
 *                   client mode (agent name, AgentCard URL, skill count,
 *                   connection state) with reconnect/close controls.
 *
 * The registry is process-local and purely observational: entries never
 * affect protocol behavior by themselves. Control operations
 * (`reconnectPeer`, `closePeer`, `reconnectAgent`, `closeAgent`) are wired
 * by the plugin entry to the real connection owners.
 */
import type { A2AClient } from './client.js';
export interface InboundPeer {
    /** Stable per-process id (random). */
    id: string;
    /** Short display label derived from the request. */
    label: string;
    /** Source socket address, when visible ("127.0.0.1:54321"). */
    source?: string;
    /** First-seen ISO timestamp. */
    firstSeen: string;
    /** Last-activity ISO timestamp. */
    lastSeen: string;
    /** Number of tasks this peer has created/continued. */
    taskCount: number;
    /** Ids of tasks still running for this peer. */
    activeTaskIds: string[];
    /** True while at least one streaming (SSE) connection is open. */
    streaming: boolean;
}
export interface OutboundAgent {
    /** Stable per-process id. */
    id: string;
    /** Namespace used for tool names ("research" → a2a__research__<skill>). */
    name: string;
    /** AgentCard URL the client was connected to. */
    agentCardUrl: string;
    /** Remote agent display name (from the AgentCard). */
    agentName?: string;
    /** Number of skills mapped to tools. */
    skillCount: number;
    /** Number of tools registered for this agent. */
    toolCount: number;
    /** Connection state. */
    state: 'connected' | 'disconnected' | 'reconnecting';
    /** False when this agent is configured but disabled in a2a.json (no live connection). */
    enabled?: boolean;
    /** Last-activity ISO timestamp. */
    lastSeen: string;
    /** Per-process connection id assigned by the outbound registry. */
    connectionId?: string;
    /** True when this connection came from the profile config (vs runtime-added). */
    configured?: boolean;
    /** Skills advertised by the remote AgentCard (for the detail view). */
    skills?: Array<{
        id: string;
        name: string;
        description?: string;
        tags?: string[];
    }>;
}
export interface DashboardSnapshot {
    inbound: InboundPeer[];
    outbound: OutboundAgent[];
    /** Epoch ms of the snapshot. */
    at: number;
}
export interface ControlResult {
    ok: boolean;
    message: string;
}
/** How the plugin entry wires control operations to connection owners. */
export interface DashboardControlHooks {
    /** Reconnect an outbound agent by its connection id. */
    reconnectAgent?: (connectionId: string) => Promise<ControlResult>;
    /** Disable (disconnect + persist enabled:false) an outbound agent without removing it. */
    disableAgent?: (connectionId: string) => Promise<ControlResult>;
    /** Enable a disabled outbound agent (persist enabled:true and reconnect). */
    enableAgent?: (connectionId: string) => Promise<ControlResult>;
    /** Close an outbound agent by its connection id. */
    closeAgent?: (connectionId: string) => Promise<ControlResult>;
    /** Close (sever) an inbound peer by its id. */
    closePeer?: (peerId: string) => Promise<ControlResult>;
    /** Reconnect is not meaningful for an inbound peer — rejects unless overridden. */
    reconnectPeer?: (peerId: string) => Promise<ControlResult>;
    /** Runtime-add an outbound agent (visual config). Returns the new connection id. */
    addAgent?: (name: string, agentCardUrl: string, opts?: {
        bearerToken?: string;
    }) => Promise<ControlResult>;
    /** Discover an Agent Card without connecting (for the import preview). */
    discoverAgent?: (agentCardUrl: string, opts?: {
        bearerToken?: string;
    }) => Promise<ControlResult>;
    /** Enable/disable the inbound A2A server (serve routes) at runtime. */
    setServerEnabled?: (enabled: boolean) => Promise<ControlResult>;
    /** Set or clear the inbound server's shared bearer token at runtime (persisted). */
    setServerAuthToken?: (token?: string) => Promise<ControlResult>;
    /** Read current inbound server status (for the serve panel). */
    serverStatus?: () => ControlResult;
    /** Runtime-remove an outbound agent by its connection id. */
    removeAgent?: (connectionId: string) => Promise<ControlResult>;
}
/** Registry of live A2A connections, both directions. */
export declare class DashboardRegistry {
    private peers;
    private agents;
    private hooks;
    private seq;
    setHooks(hooks: DashboardControlHooks): void;
    /** Record one inbound request (or stream open). Returns the peer id. */
    touchInbound(req: {
        headers?: Record<string, string>;
        source?: string;
    }, taskIds?: string[]): string;
    /** Mark a task finished for a peer (drops it from the active list). */
    finishTask(peerId: string, taskId: string): void;
    /** Mark a peer's streaming flag. */
    setStreaming(peerId: string, streaming: boolean): void;
    /** Remove an inbound peer (the "关闭" action severs tracking). */
    removePeer(id: string): void;
    /** Register or refresh an outbound agent connection. */
    upsertAgent(agent: Omit<OutboundAgent, 'id' | 'lastSeen'>): string;
    /** Remove an outbound agent by id or connectionId. */
    removeAgent(connectionId: string): boolean;
    /** Update one agent's state. */
    setAgentState(connectionId: string, state: OutboundAgent['state']): void;
    /** Touch one agent's last activity. */
    touchAgent(connectionId: string): void;
    snapshot(): DashboardSnapshot;
    control(action: string, target: string, payload?: Record<string, unknown>): Promise<ControlResult>;
    private closePeerLocal;
}
/** A client owned by the plugin entry, tracked for the dashboard. */
export interface TrackedClient {
    client: A2AClient;
    connectionId: string;
    name: string;
    agentCardUrl: string;
}
/** Get the process-wide dashboard registry (creating it on first use). */
export declare function getSharedRegistry(): DashboardRegistry;
/** Test hook: reset the shared registry (and any hooks). */
export declare function resetSharedRegistry(): void;
//# sourceMappingURL=dashboard.d.ts.map