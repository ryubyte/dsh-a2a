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
  skills?: Array<{ id: string; name: string; description?: string; tags?: string[] }>;
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
  addAgent?: (name: string, agentCardUrl: string, opts?: { bearerToken?: string }) => Promise<ControlResult>;
  /** Discover an Agent Card without connecting (for the import preview). */
  discoverAgent?: (agentCardUrl: string, opts?: { bearerToken?: string }) => Promise<ControlResult>;
  /** Enable/disable the inbound A2A server (serve routes) at runtime. */
  setServerEnabled?: (enabled: boolean) => Promise<ControlResult>;
  /** Set or clear the inbound server's shared bearer token at runtime (persisted). */
  setServerAuthToken?: (token?: string) => Promise<ControlResult>;
  /** Read current inbound server status (for the serve panel). */
  serverStatus?: () => ControlResult;
  /** Runtime-remove an outbound agent by its connection id. */
  removeAgent?: (connectionId: string) => Promise<ControlResult>;
  /** Update the outbound-server identity (AgentCard) at runtime (persisted). */
  setServerIdentity?: (patch: {
    agentName?: string;
    agentDescription?: string;
    agentVersion?: string;
    baseUrl?: string;
    endpointPath?: string;
    skills?: Array<{ id: string; name: string; description: string; tags?: string[] }>;
  }) => Promise<ControlResult>;
  /** Update a saved outbound agent's advanced fields, reconnecting to apply. */
  updateAgent?: (
    connectionId: string,
    patch: { timeoutMs?: number; mapSkills?: boolean; bearerToken?: string },
  ) => Promise<ControlResult>;
}

/** Registry of live A2A connections, both directions. */
export class DashboardRegistry {
  private peers = new Map<string, InboundPeer>();
  private agents = new Map<string, OutboundAgent>();
  private hooks: DashboardControlHooks = {};
  private seq = 0;

  setHooks(hooks: DashboardControlHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  // ── inbound ───────────────────────────────────────────────────────────────

  /** Record one inbound request (or stream open). Returns the peer id. */
  touchInbound(req: { headers?: Record<string, string>; source?: string }, taskIds: string[] = []): string {
    const now = new Date().toISOString();
    const ua = req.headers?.['user-agent'] ?? req.headers?.['User-Agent'] ?? 'unknown';
    const remote = req.source;
    const label = peerLabel(ua, remote);

    // Reuse an existing peer when the same client identity keeps talking.
    // `source` is a socket address (`ip:port`); the port changes on every new
    // HTTP connection, so it cannot be the dedup key — otherwise every request
    // from the same agent would spawn a new row. Dedup on label + host IP and
    // refresh the displayed socket address to the latest one.
    const host = remote?.replace(/:\d+$/, '');
    const key = `${label}|${host ?? ''}`;
    let peer: InboundPeer | undefined;
    for (const p of this.peers.values()) {
      const pHost = p.source?.replace(/:\d+$/, '') ?? '';
      if (`${p.label}|${pHost}` === key) {
        peer = p;
        break;
      }
    }
    if (!peer) {
      const id = `in-${++this.seq}`;
      peer = { id, label, source: remote, firstSeen: now, lastSeen: now, taskCount: 0, activeTaskIds: [], streaming: false };
      this.peers.set(id, peer);
    }
    peer.source = remote ?? peer.source;
    peer.lastSeen = now;
    if (taskIds.length) {
      peer.taskCount += taskIds.length;
      for (const t of taskIds) if (!peer.activeTaskIds.includes(t)) peer.activeTaskIds.push(t);
    }
    return peer.id;
  }

  /** Mark a task finished for a peer (drops it from the active list). */
  finishTask(peerId: string, taskId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.activeTaskIds = peer.activeTaskIds.filter((t) => t !== taskId);
  }

  /** Mark a peer's streaming flag. */
  setStreaming(peerId: string, streaming: boolean): void {
    const peer = this.peers.get(peerId);
    if (peer) peer.streaming = streaming;
  }

  /** Remove an inbound peer (the "关闭" action severs tracking). */
  removePeer(id: string): void {
    this.peers.delete(id);
  }

  // ── outbound ──────────────────────────────────────────────────────────────

  /** Register or refresh an outbound agent connection. */
  upsertAgent(agent: Omit<OutboundAgent, 'id' | 'lastSeen'>): string {
    const now = new Date().toISOString();
    // Key by connectionId when present (the same agent can be re-created).
    let id: string | undefined;
    if (agent.connectionId) {
      for (const [k, v] of this.agents) {
        if (v.connectionId === agent.connectionId) {
          id = k;
          break;
        }
      }
    }
    if (!id) {
      id = `out-${++this.seq}`;
      this.agents.set(id, { ...agent, id, lastSeen: now });
    } else {
      const existing = this.agents.get(id)!;
      // Merge: zero/absent optional fields keep their existing value (a
      // refresh reporting only toolCount must not wipe skillCount).
      this.agents.set(id, {
        ...existing,
        ...agent,
        skillCount: agent.skillCount > 0 ? agent.skillCount : existing.skillCount,
        toolCount: agent.toolCount > 0 ? agent.toolCount : existing.toolCount,
        agentName: agent.agentName ?? existing.agentName,
        skills: agent.skills ? agent.skills : existing.skills,
        state: agent.state ?? existing.state,
        id,
        lastSeen: now,
      });
    }
    return id;
  }

  /** Remove an outbound agent by id or connectionId. */
  removeAgent(connectionId: string): boolean {
    for (const [k, v] of this.agents) {
      if (v.connectionId === connectionId || k === connectionId) {
        this.agents.delete(k);
        return true;
      }
    }
    return false;
  }

  /** Update one agent's state. */
  setAgentState(connectionId: string, state: OutboundAgent['state']): void {
    for (const v of this.agents.values()) {
      if (v.connectionId === connectionId) {
        v.state = state;
        v.lastSeen = new Date().toISOString();
      }
    }
  }

  /** Touch one agent's last activity. */
  touchAgent(connectionId: string): void {
    for (const v of this.agents.values()) {
      if (v.connectionId === connectionId) v.lastSeen = new Date().toISOString();
    }
  }

  // ── snapshot + control ────────────────────────────────────────────────────

  snapshot(): DashboardSnapshot {
    return {
      inbound: [...this.peers.values()].map((p) => ({ ...p, activeTaskIds: [...p.activeTaskIds] })),
      outbound: [...this.agents.values()].map((a) => ({ ...a })),
      at: Date.now(),
    };
  }

  async control(action: string, target: string, payload?: Record<string, unknown>): Promise<ControlResult> {
    switch (action) {
      case 'reconnect-agent':
        return this.hooks.reconnectAgent
          ? this.hooks.reconnectAgent(target)
          : { ok: false, message: 'reconnect-agent is not wired' };
      case 'close-agent':
        return this.hooks.closeAgent
          ? this.hooks.closeAgent(target)
          : { ok: false, message: 'close-agent is not wired' };
      case 'disable-agent':
        return this.hooks.disableAgent
          ? this.hooks.disableAgent(target)
          : { ok: false, message: 'disable-agent is not wired (client mode not mounted)' };
      case 'enable-agent':
        return this.hooks.enableAgent
          ? this.hooks.enableAgent(target)
          : { ok: false, message: 'enable-agent is not wired (client mode not mounted)' };
      case 'reconnect-peer':
        return this.hooks.reconnectPeer
          ? this.hooks.reconnectPeer(target)
          : { ok: false, message: 'reconnect-peer is not supported' };
      case 'close-peer':
        return Promise.resolve(this.closePeerLocal(target));
      case 'discover-agent': {
        const url = (payload?.agentCardUrl as string) ?? target;
        if (!url) return { ok: false, message: 'discover-agent requires agentCardUrl' };
        const bearerToken = (payload?.bearerToken as string) || undefined;
        return this.hooks.discoverAgent
          ? this.hooks.discoverAgent(url, { bearerToken })
          : { ok: false, message: 'discover-agent is not wired' };
      }
      case 'add-agent': {
        const name = (payload?.name as string) ?? target;
        const url = payload?.agentCardUrl as string | undefined;
        if (!url) return { ok: false, message: 'add-agent requires agentCardUrl' };
        const bearerToken = (payload?.bearerToken as string) || undefined;
        return this.hooks.addAgent
          ? this.hooks.addAgent(name, url, { bearerToken })
          : { ok: false, message: 'add-agent is not wired (client mode not mounted)' };
      }
      case 'remove-agent':
        return this.hooks.removeAgent
          ? this.hooks.removeAgent(target)
          : { ok: false, message: 'remove-agent is not wired (client mode not mounted)' };
      case 'server-enable':
        return this.hooks.setServerEnabled
          ? this.hooks.setServerEnabled(true)
          : { ok: false, message: 'server control is not wired (server mode not mounted)' };
      case 'server-disable':
        return this.hooks.setServerEnabled
          ? this.hooks.setServerEnabled(false)
          : { ok: false, message: 'server control is not wired (server mode not mounted)' };
      case 'set-server-auth': {
        // Empty/missing token clears the gate. The token value is never echoed
        // back in the result message.
        const token = (payload?.authToken as string) || undefined;
        return this.hooks.setServerAuthToken
          ? this.hooks.setServerAuthToken(token)
          : { ok: false, message: 'set-server-auth is not wired (server mode not mounted)' };
      }
      case 'server-status':
        return this.hooks.serverStatus
          ? Promise.resolve(this.hooks.serverStatus())
          : { ok: false, message: 'server-status is not wired (server mode not mounted)' };
      case 'set-server-identity': {
        if (!this.hooks.setServerIdentity) {
          return { ok: false, message: 'set-server-identity is not wired (server not mounted)' };
        }
        return this.hooks.setServerIdentity({
          agentName: payload?.agentName as string | undefined,
          agentDescription: payload?.agentDescription as string | undefined,
          agentVersion: payload?.agentVersion as string | undefined,
          baseUrl: payload?.baseUrl as string | undefined,
          endpointPath: payload?.endpointPath as string | undefined,
          skills: payload?.skills as
            | Array<{ id: string; name: string; description: string; tags?: string[] }>
            | undefined,
        });
      }
      case 'update-agent': {
        if (!this.hooks.updateAgent) {
          return { ok: false, message: 'update-agent is not wired (client mode not mounted)' };
        }
        return this.hooks.updateAgent(target, {
          timeoutMs: typeof payload?.timeoutMs === 'number' ? (payload.timeoutMs as number) : undefined,
          mapSkills: typeof payload?.mapSkills === 'boolean' ? (payload.mapSkills as boolean) : undefined,
          bearerToken: (payload?.bearerToken as string) || undefined,
        });
      }
      default:
        return { ok: false, message: `unknown action ${action}` };
    }
  }

  private closePeerLocal(id: string): ControlResult {
    if (!this.peers.has(id)) return { ok: false, message: `peer ${id} not found` };
    this.removePeer(id);
    return { ok: true, message: `peer ${id} closed` };
  }
}

function peerLabel(ua: string, remote?: string): string {
  // Common A2A client user agents; else show a compact token.
  const lower = ua.toLowerCase();
  if (lower.includes('python-requests') || lower.includes('a2a-python')) return 'Python A2A client';
  if (lower.includes('node')) return 'Node A2A client';
  if (lower.includes('curl')) return 'curl';
  if (lower.includes('mozilla')) return 'Browser';
  const compact = ua.replace(/[^A-Za-z0-9._-]/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ');
  return compact || (remote ?? 'unknown');
}

/** A client owned by the plugin entry, tracked for the dashboard. */
export interface TrackedClient {
  client: A2AClient;
  connectionId: string;
  name: string;
  agentCardUrl: string;
}

// ── process-wide shared registry ───────────────────────────────────────────
// Multiple dsh-a2a plugin instances (client and/or server) share ONE
// registry, so the dashboard API shows every connection regardless of which
// instance observed it. The first `apply` creates it; later instances reuse
// it and merely attach their own control hooks.

let shared: DashboardRegistry | undefined;

/** Get the process-wide dashboard registry (creating it on first use). */
export function getSharedRegistry(): DashboardRegistry {
  if (!shared) shared = new DashboardRegistry();
  return shared;
}

/** Test hook: reset the shared registry (and any hooks). */
export function resetSharedRegistry(): void {
  shared = undefined;
}