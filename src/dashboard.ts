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
  /** Last-activity ISO timestamp. */
  lastSeen: string;
  /** Per-process connection id assigned by the outbound registry. */
  connectionId?: string;
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
  /** Close an outbound agent by its connection id. */
  closeAgent?: (connectionId: string) => Promise<ControlResult>;
  /** Close (sever) an inbound peer by its id. */
  closePeer?: (peerId: string) => Promise<ControlResult>;
  /** Reconnect is not meaningful for an inbound peer — rejects unless overridden. */
  reconnectPeer?: (peerId: string) => Promise<ControlResult>;
}

/** Registry of live A2A connections, both directions. */
export class DashboardRegistry {
  private peers = new Map<string, InboundPeer>();
  private agents = new Map<string, OutboundAgent>();
  private hooks: DashboardControlHooks = {};
  private seq = 0;

  setHooks(hooks: DashboardControlHooks): void {
    this.hooks = hooks;
  }

  // ── inbound ───────────────────────────────────────────────────────────────

  /** Record one inbound request (or stream open). Returns the peer id. */
  touchInbound(req: { headers?: Record<string, string>; source?: string }, taskIds: string[] = []): string {
    const now = new Date().toISOString();
    const ua = req.headers?.['user-agent'] ?? req.headers?.['User-Agent'] ?? 'unknown';
    const remote = req.source;
    const label = peerLabel(ua, remote);

    // Reuse an existing peer when the same socket address keeps talking.
    let peer: InboundPeer | undefined;
    for (const p of this.peers.values()) {
      if (remote && p.source === remote) {
        peer = p;
        break;
      }
    }
    if (!peer) {
      const id = `in-${++this.seq}`;
      peer = { id, label, source: remote, firstSeen: now, lastSeen: now, taskCount: 0, activeTaskIds: [], streaming: false };
      this.peers.set(id, peer);
    }
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

  async control(action: string, target: string): Promise<ControlResult> {
    switch (action) {
      case 'reconnect-agent':
        return this.hooks.reconnectAgent
          ? this.hooks.reconnectAgent(target)
          : { ok: false, message: 'reconnect-agent is not wired' };
      case 'close-agent':
        return this.hooks.closeAgent
          ? this.hooks.closeAgent(target)
          : { ok: false, message: 'close-agent is not wired' };
      case 'reconnect-peer':
        return this.hooks.reconnectPeer
          ? this.hooks.reconnectPeer(target)
          : { ok: false, message: 'reconnect-peer is not supported' };
      case 'close-peer':
        return Promise.resolve(this.closePeerLocal(target));
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