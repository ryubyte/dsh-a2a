/**
 * dsh-a2a — inbound half: serve DSH as an A2A agent.
 *
 * Implements the server side of A2A v1.0 JSONRPC binding:
 *   - `/.well-known/agent-card.json` agent manifest
 *   - POST JSON-RPC endpoint handling SendMessage / GetTask / ListTasks /
 *     CancelTask / SendStreamingMessage (SSE) / SubscribeToTask
 *
 * Task execution is delegated to an injectable executor so compositions can
 * wire DSH's real agent loop; plugin ships a default executor that runs
 * shell commands in the workspace.
 */

import type {
  AgentCard,
  AgentInterface,
  AgentSkill,
  JsonRpcError,
  JsonRpcRequest,
  Message,
  Part,
  StreamResponse,
  Task,
} from './protocol.js';
import {
  TaskState,
  Role,
  A2A_METHODS,
  A2A_ERROR_CODES,
  isTerminal,
} from './protocol.js';

export interface ServerSkill extends AgentSkill {}

export interface ServerOptions {
  /** Public base URL (scheme + host + optional prefix) where this DSH is exposed. */
  baseUrl: string;
  agentName: string;
  agentDescription: string;
  agentVersion: string;
  agentProvider?: { url: string; organization: string };
  skills?: ServerSkill[];
  /** Override the executor that runs an incoming task. */
  execute?: TaskExecutor;
  /**
   * Optional shared bearer token. When set, the AgentCard declares an
   * `http`/`bearer` security scheme and every inbound JSON-RPC request must
   * carry `Authorization: Bearer <token>` or it is rejected with 401. When
   * unset, no scheme is advertised and requests are not token-gated (but the
   * default executor still refuses to act unless one is injected).
   */
  authToken?: string;
  /** Extra custom headers on the AgentCard (rarely needed). */
  iconUrl?: string;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  /** Where tasks are accepted — the JSON-RPC POST route path. */
  endpointPath?: string;
  /**
   * Optional inbound observation hook: called for every JSON-RPC request with
   * the request facts and the task ids it touched. Lets the connection
   * dashboard track "who is talking to us".
   */
  onInbound?: (facts: InboundFacts) => void;
  /** Called when a task reaches a terminal state (completed/failed/canceled). */
  onTaskSettled?: (taskId: string) => void;
}

/** Observational facts about one inbound JSON-RPC request. */
export interface InboundFacts {
  method: string;
  headers?: Record<string, string>;
  source?: string;
  taskIds: string[];
  streaming: boolean;
}

export interface TaskExecutor {
  (input: { message: Message; taskId: string; contextId: string; signal: AbortSignal }): Promise<Message>;
}

export interface InboundHandle {
  card: AgentCard;
  endpointPath: string;
  taskStore: TaskStore;
  dispose: () => void;
}

/** In-memory task store with the full A2A Task lifecycle. */
export class TaskStore {
  private tasks = new Map<string, Task>();
  private messages = new Map<string, Message>();

  create(message: Message): Task {
    const taskId = crypto.randomUUID();
    const contextId = message.contextId ?? crypto.randomUUID();
    const task: Task = {
      id: taskId,
      contextId,
      status: { state: TaskState.SUBMITTED, timestamp: new Date().toISOString() },
      artifacts: [],
      history: [message],
      metadata: {},
    };
    this.tasks.set(taskId, task);
    this.messages.set(message.messageId, message);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(): Task[] {
    return [...this.tasks.values()];
  }

  setStatus(taskId: string, state: TaskState, message?: Message): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    task.status = { state, message, timestamp: new Date().toISOString() };
    if (message) {
      this.messages.set(message.messageId, message);
      task.history = [...(task.history ?? []), message];
    }
    return task;
  }

  addArtifact(taskId: string, artifact: { artifactId: string; parts: Part[]; name?: string; append?: boolean; lastChunk?: boolean }): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    const existing = task.artifacts?.find((a) => a.artifactId === artifact.artifactId);
    if (existing) {
      existing.parts.push(...artifact.parts);
    } else {
      task.artifacts = [...(task.artifacts ?? []), { artifactId: artifact.artifactId, name: artifact.name, parts: artifact.parts }];
    }
    return task;
  }

  getMessage(id: string): Message | undefined {
    return this.messages.get(id);
  }
}

/** Extract a human-readable source address from a request (when visible). */
function sourceOf(req: { socket?: { remoteAddress?: string; remotePort?: number } }): string | undefined {
  const s = req.socket;
  if (!s?.remoteAddress) return undefined;
  return `${s.remoteAddress}:${s.remotePort ?? ''}`;
}

/** A2A JSON-RPC server handler over a raw HTTP request/response pair. */
export class A2AServer {
  readonly options: ServerOptions;
  readonly store: TaskStore;
  readonly card: AgentCard;
  readonly endpointPath: string;
  private execute: TaskExecutor;
  private listeners = new Set<(ev: StreamResponse) => void>();
  private baseUrl: string;
  /** Abort controllers for in-flight tasks, so CancelTask can abort the executor. */
  private running = new Map<string, AbortController>();

  constructor(options: ServerOptions, store = new TaskStore()) {
    this.options = options;
    this.store = store;
    // Safe default: refuse to act when no executor is configured. A
    // shell-based executor is available but must be opted in explicitly
    // (see `shellExecutor`), so the path of least resistance is NOT
    // arbitrary shell execution.
    this.execute = options.execute ?? notConfiguredExecutor;
    this.endpointPath = options.endpointPath ?? '/a2a';
    this.baseUrl = options.baseUrl;
    this.card = this.buildCard();
  }

  /**
   * Update the base URL advertised in the AgentCard after the real listen
   * address is known (e.g. ephemeral port). Mutates `card` in place.
   */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.card.supportedInterfaces = this.card.supportedInterfaces.map((iface) => ({
      ...iface,
      url: `${this.baseUrl}${this.endpointPath}`,
    }));
  }

  /**
   * Set or clear the shared bearer token that gates the inbound endpoint at
   * runtime. Rebuilds the AgentCard so the `bearerAuth` security scheme is
   * advertised (token set) or withdrawn (token cleared); `authorized()` reads
   * `options.authToken` on each request, so the gate flips immediately. Pass
   * `undefined` or an empty string to disable token gating.
   */
  setAuthToken(token?: string): void {
    this.options.authToken = token && token.length > 0 ? token : undefined;
    // `card` is readonly (mutated in place, like setBaseUrl): add or withdraw
    // the bearer security scheme to match the new token state.
    if (this.options.authToken) {
      applyAuthScheme(this.card, this.options.authToken);
    } else {
      delete this.card.securitySchemes;
      delete this.card.securityRequirements;
    }
  }

  /** Whether the inbound endpoint is currently token-gated. */
  get authConfigured(): boolean {
    return Boolean(this.options.authToken);
  }

  private buildCard(): AgentCard {
    const iface: AgentInterface = {
      url: `${this.baseUrl.replace(/\/$/, '')}${this.endpointPath}`,
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    };
    // No implicit skills: only what the deployer configured. Publishing
    // nothing is safer than inventing a default capability.
    const skills: AgentSkill[] = this.options.skills ?? [];
    const token = this.options.authToken;
    const card: AgentCard = {
      name: this.options.agentName,
      description: this.options.agentDescription,
      version: this.options.agentVersion,
      supportedInterfaces: [iface],
      provider: this.options.agentProvider ?? { url: 'https://deepseek.com', organization: 'DeepSeek' },
      capabilities: { streaming: true, pushNotifications: false, extensions: [] },
      defaultInputModes: this.options.defaultInputModes ?? ['text/plain'],
      defaultOutputModes: this.options.defaultOutputModes ?? ['text/plain'],
      skills,
      ...(this.options.iconUrl ? { iconUrl: this.options.iconUrl } : {}),
    };
    applyAuthScheme(card, token);
    return card;
  }

  /** True when the request carries the configured bearer token. */
  private authorized(req: { headers?: Record<string, string> }): boolean {
    const token = this.options.authToken;
    if (!token) return true; // no scheme configured → not token-gated
    const h = req.headers ?? {};
    const auth = h['authorization'] ?? h['Authorization'];
    if (!auth) return false;
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    return !!m && m[1] === token;
  }

  private emit(ev: StreamResponse) {
    for (const l of this.listeners) l(ev);
  }

  /** Route an inbound HTTP request; returns true when handled. */
  async handle(req: { method?: string; url?: string; headers?: { 'content-type'?: string }; socket?: { remoteAddress?: string; remotePort?: number } }, body: string): Promise<{ status: number; contentType: string; body: string; headers?: Record<string, string> }> {
    const path = (req.url ?? '').split('?')[0];
    // AgentCard discovery
    if (req.method === 'GET' && (path === '/.well-known/agent-card.json' || path === this.endpointPath + '/card')) {
      return {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(this.card),
      };
    }
    // JSON-RPC
    if (req.method === 'POST' && path === this.endpointPath) {
      if (!this.authorized(req)) {
        return {
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32001, message: 'Unauthorized' },
          }),
          headers: { 'WWW-Authenticate': 'Bearer' },
        };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        return this.jsonRpcError(null, A2A_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON', 'Parse error');
      }
      const rpc = payload as JsonRpcRequest;
      if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
        return this.jsonRpcError(rpc?.id ?? null, A2A_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC request');
      }
      try {
        const result = await this.dispatch(rpc);
        this.options.onInbound?.({
          method: rpc.method,
          headers: req.headers as Record<string, string> | undefined,
          source: sourceOf(req),
          taskIds: extractTaskIds(result),
          streaming: false,
        });
        return {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }),
        };
      } catch (err) {
        const e = err as { code?: number; message?: string; data?: unknown };
        return this.jsonRpcError(
          rpc.id ?? null,
          typeof e.code === 'number' ? e.code : A2A_ERROR_CODES.INTERNAL_ERROR,
          e.message ?? String(err),
          e.data,
        );
      }
    }
    return { status: 404, contentType: 'text/plain', body: 'Not Found' };
  }
  async handleStream(req: { method?: string; url?: string; headers?: Record<string, string>; socket?: { remoteAddress?: string; remotePort?: number } }, body: string, onEvent: (frame: string) => void): Promise<{ status: number; headers?: Record<string, string> }> {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST' || path !== this.endpointPath) {
      onEvent(`event: error\ndata: ${JSON.stringify({ code: 404, message: 'Not Found' })}\n\n`);
      return { status: 200 };
    }
    if (!this.authorized(req)) {
      // Do not emit on the SSE stream — the caller flips the HTTP status to
      // 401 + WWW-Authenticate.  (Spec §7.4: fail closed on missing tokens.)
      return { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      onEvent(`event: error\ndata: ${JSON.stringify({ code: A2A_ERROR_CODES.INVALID_REQUEST, message: 'Parse error' })}\n\n`);
      return { status: 200 };
    }
    const rpc = payload as JsonRpcRequest;
    const method = rpc?.method;
    if (method === A2A_METHODS.sendStreamingMessage || method === A2A_METHODS.subscribeToTask) {
      const taskId =
        method === A2A_METHODS.subscribeToTask
          ? (rpc.params as { id?: string })?.id
          : await this.ensureTask(rpc.params as { message?: Message });
      if (!taskId) {
        onEvent(`event: error\ndata: ${JSON.stringify({ code: A2A_ERROR_CODES.INVALID_PARAMS, message: 'Missing message' })}\n\n`);
        return { status: 200 };
      }
      const task = this.store.get(taskId);
      if (!task) {
        onEvent(`event: error\ndata: ${JSON.stringify({ code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: `Task ${taskId} not found` })}\n\n`);
        return { status: 200 };
      }
      const sub = (ev: StreamResponse) => onEvent(`data: ${JSON.stringify(ev)}\n\n`);
      this.listeners.add(sub);
      this.options.onInbound?.({
        method,
        headers: req.headers as Record<string, string> | undefined,
        source: sourceOf(req),
        taskIds: taskId ? [taskId] : [],
        streaming: true,
      });
      try {
        // If this was a fresh SendStreamingMessage, kick off execution now.
        if (method === A2A_METHODS.sendStreamingMessage) {
          const msg = (rpc.params as { message?: Message }).message!;
          this.runTask(task.id, task.contextId!, msg);
        }
        // Keep the stream open until the task reaches a terminal state.
        await this.waitTerminal(task.id);
        onEvent(`data: ${JSON.stringify({ task: this.store.get(taskId) })}\n\n`);
      } finally {
        this.listeners.delete(sub);
      }
      return { status: 200 };
    }
    onEvent(`event: error\ndata: ${JSON.stringify({ code: A2A_ERROR_CODES.METHOD_NOT_FOUND, message: `Unknown method ${method}` })}\n\n`);
    return { status: 200 };
  }

  private async ensureTask(params: { message?: Message } | undefined): Promise<string | undefined> {
    if (!params?.message) return undefined;
    const msg = params.message;
    // If message references an existing task, continue it; else create.
    if (msg.taskId && this.store.get(msg.taskId)) return msg.taskId;
    const task = this.store.create(msg);
    return task.id;
  }

  private async waitTerminal(taskId: string): Promise<void> {
    for (;;) {
      const t = this.store.get(taskId);
      if (t && isTerminal(t.status.state as TaskState)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Execute a task in the background, streaming status/artifact updates. */
  private async runTask(taskId: string, contextId: string, msg: Message) {
    this.store.setStatus(taskId, TaskState.WORKING);
    this.emit({ statusUpdate: { taskId, contextId, status: this.store.get(taskId)!.status } });
    // Track a live controller so CancelTask can abort the running executor.
    const controller = new AbortController();
    this.running.set(taskId, controller);
    try {
      const reply = await this.execute({ message: msg, taskId, contextId, signal: controller.signal });
      // CancelTask aborts the signal AND sets the task terminal (CANCELED); the
      // executor still returns normally, so guard against clobbering that
      // terminal state with COMPLETED (and firing onTaskSettled a second time).
      if (controller.signal.aborted || isTerminal(this.store.get(taskId)?.status.state as TaskState)) return;
      this.store.addArtifact(taskId, { artifactId: 'result', parts: reply.parts, lastChunk: true });
      this.store.setStatus(taskId, TaskState.COMPLETED, reply);
      this.options.onTaskSettled?.(taskId);
      const task = this.store.get(taskId)!;
      this.emit({ task });
      this.emit({ artifactUpdate: { taskId, contextId, artifact: task.artifacts![task.artifacts!.length - 1], lastChunk: true } });
    } catch (err) {
      // Don't overwrite an already-terminal task (e.g. CANCELED) with FAILED.
      if (controller.signal.aborted || isTerminal(this.store.get(taskId)?.status.state as TaskState)) return;
      const message: Message = {
        messageId: crypto.randomUUID(),
        role: Role.AGENT,
        parts: [{ text: `Task failed: ${(err as Error).message ?? String(err)}` }],
      };
      this.store.setStatus(taskId, TaskState.FAILED, message);
      this.options.onTaskSettled?.(taskId);
      this.emit({ statusUpdate: { taskId, contextId, status: this.store.get(taskId)!.status } });
    } finally {
      this.running.delete(taskId);
    }
  }

  private async dispatch(rpc: JsonRpcRequest): Promise<unknown> {
    const method = rpc.method;
    const params = (rpc.params ?? {}) as Record<string, unknown>;
    switch (method) {
      case A2A_METHODS.sendMessage: {
        const msg = params.message as Message | undefined;
        if (!msg?.parts?.length) throw { code: A2A_ERROR_CODES.INVALID_PARAMS, message: 'Missing message' };
        const taskId = await this.ensureTask(params as { message?: Message });
        const task = this.store.get(taskId!)!;
        // Run synchronously (returnImmediately=false default) — execute inline,
        // but don't block forever: the executor contract returns a Message.
        this.runTask(task.id, task.contextId!, msg);
        // For a stateless-style SendMessage, wait for completion.
        await this.waitTerminal(task.id);
        return { task: this.store.get(task.id) };
      }
      case A2A_METHODS.getTask: {
        const id = params.id as string;
        const task = this.store.get(id);
        if (!task) throw { code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: `Task ${id} not found` };
        return task;
      }
      case A2A_METHODS.listTasks: {
        const tasks = this.store.list();
        return {
          tasks,
          nextPageToken: '',
          pageSize: tasks.length,
          totalSize: tasks.length,
        };
      }
      case A2A_METHODS.cancelTask: {
        const id = params.id as string;
        const task = this.store.get(id);
        if (!task) throw { code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: `Task ${id} not found` };
        if (isTerminal(task.status.state as TaskState)) {
          throw { code: A2A_ERROR_CODES.TASK_CANCEL_NOT_ALLOWED, message: `Task ${id} already in terminal state ${task.status.state}` };
        }
        // Abort the running executor (if any) so the work actually stops, not
        // just the store status. The executor observes this via its signal.
        this.running.get(id)?.abort();
        this.store.setStatus(id, TaskState.CANCELED);
        this.options.onTaskSettled?.(id);
        return this.store.get(id);
      }
      case A2A_METHODS.getExtendedAgentCard:
        return this.card;
      default:
        throw { code: A2A_ERROR_CODES.METHOD_NOT_FOUND, message: `Method ${method} not supported` };
    }
  }

  private jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): { status: number; contentType: string; body: string } {
    const err: JsonRpcError = { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
    return { status: 200, contentType: 'application/json', body: JSON.stringify(err) };
  }
}

/**
 * Advertise the `bearerAuth` HTTP security scheme on an AgentCard when a token
 * is configured. Mutates in place; a no-op when `token` is falsy. Shared by
 * {@link A2AServer.buildCard} and {@link A2AServer.setAuthToken}.
 */
function applyAuthScheme(card: AgentCard, token?: string): void {
  if (!token) return;
  card.securitySchemes = { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' } };
  card.securityRequirements = [{ schemes: { bearerAuth: [] } }];
}

/** Pull task ids out of a dispatch result for inbound peer tracking. */
function extractTaskIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as { task?: { id?: string }; tasks?: Array<{ id?: string }> };
  if (typeof r.task?.id === 'string') return [r.task.id];
  if (Array.isArray(r.tasks)) {
    return r.tasks.map((t) => t.id).filter((id): id is string => typeof id === 'string');
  }
  return [];
}

export const defaultSkills: ServerSkill[] = [
  {
    id: 'coding',
    name: 'Coding',
    description: 'Execute coding and shell tasks inside the DSH workspace.',
    tags: ['coding', 'shell'],
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
  },
];

/**
 * Safe default executor: refuses to act, telling the caller to inject a real
 * executor. Used when an `A2AServer` is constructed without an `execute`
 * option, so an inbound message never triggers arbitrary action (in particular
 * never a shell command) unless the operator explicitly configured one.
 */
export const notConfiguredExecutor: TaskExecutor = async ({ message }) => {
  const text = message.parts
    .map((p) => ('text' in p ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .slice(0, 120);
  const detail = text ? ` (prompt: ${text}…)` : '';
  return {
    messageId: crypto.randomUUID(),
    role: Role.AGENT,
    parts: [{ text: `no executor configured — inject one via the \`execute\` option${detail}` }],
  };
};

/**
 * Shell executor: run the incoming prompt through the system shell and
 * return the captured stdout/stderr as the task artifact. Honors the
 * AbortSignal (task cancellation / shutdown) by killing the child process.
 *
 * This is local-testing-only: arbitrary text from an inbound message becomes
 * a `/bin/sh -c` command, so only use it against a trusted client. It is
 * deliberately NOT the default — pass it explicitly to opt in:
 *
 * ```ts
 * const server = new A2AServer({ ..., execute: shellExecutor }, store);
 * ```
 */
export const shellExecutor: TaskExecutor = async ({ message, signal }) => {
  const text = message.parts
    .map((p) => ('text' in p ? p.text : ''))
    .filter(Boolean)
    .join('\n');
  if (!text.trim()) {
    return { messageId: crypto.randomUUID(), role: Role.AGENT, parts: [{ text: 'No prompt provided.' }] };
  }
  try {
    const { execFile } = await import('node:child_process');
    const out = await new Promise<string>((resolve, _reject) => {
      const child = execFile(
        '/bin/sh',
        ['-c', text],
        { timeout: 30000, maxBuffer: 1024 * 1024, signal },
        (err, stdout, stderr) => {
          if (err) {
            if ((err as NodeJS.ErrnoException & { killed?: boolean }).killed || signal?.aborted) {
              resolve(`(aborted) ${stdout}${stderr}`.trim() || '(aborted)');
              return;
            }
            resolve(`(exit ${(err as { code?: number | string }).code ?? '?'}) ${stdout}\n${stderr}`);
            return;
          }
          resolve(`${stdout}\n${stderr}`.trim());
        },
      );
      // Redundant safety: if the signal fires between spawn and execFile's
      // internal wiring, make sure the child is killed.
      signal?.addEventListener('abort', () => child.kill(), { once: true });
    });
    return { messageId: crypto.randomUUID(), role: Role.AGENT, parts: [{ text: out || '(no output)' }] };
  } catch (err) {
    return { messageId: crypto.randomUUID(), role: Role.AGENT, parts: [{ text: `Executor error: ${(err as Error).message}` }] };
  }
};
/**
 * Backwards-compatible alias for {@link shellExecutor}. Kept for code that
 * explicitly opted into the shell executor before it was renamed; the safe
 * default for `A2AServer` is now {@link notConfiguredExecutor}, so using
 * this alias still requires an explicit opt-in.
 */
export const defaultExecutor: TaskExecutor = shellExecutor;

// ─────────────────────────────────────────────────────────────────────────────
// DSH agent executor — run an inbound A2A task through this harness's own agent
// loop, instead of a shell.
//
// The shapes below are declared STRUCTURALLY (same philosophy as the
// `WebServerService` interface in `index.ts`): this package builds against
// `@deepseek-ai/cordis` alone and never hard-depends on `@deepseek-ai/dsh-agent`
// or `@deepseek-ai/dsh-agent-loop`. We only describe the slice of the live
// `ctx.agents` service surface we actually call. The concrete runtime shapes
// are owned by `@deepseek-ai/dsh-agent`; the agent-creation FACTORY that makes
// `create()` succeed is owned by `@deepseek-ai/dsh-agent-loop`. A composition
// that lacks the loop still has `ctx.agents` (the registry), but `create()`
// rejects — which is exactly why enabling this executor is gated on a
// factory-readiness probe in `index.ts`, and why it degrades to a readable
// error rather than throwing raw.
// ─────────────────────────────────────────────────────────────────────────────

/** The one ordered pending-message list we route inbound turns to. */
type InboxTarget = 'next-turn' | 'next-step';

/** A model-facing text block (mirrors `@deepseek-ai/dsh-llm` `TextBlock`). */
interface AgentTextBlock {
  type: 'text';
  text: string;
}

/** The subset of the derived message history we read back (mirrors `Message`). */
interface AgentMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: ReadonlyArray<{ type: string; text?: string }>;
}

/** A user-role message accepted by `agent.send` (mirrors `UserMessage`). */
interface AgentUserMessage {
  readonly id: string;
  readonly role: 'user';
  readonly content: AgentTextBlock[];
  readonly source: { kind: 'plugin'; plugin: string };
}

/** The slice of a live `Agent` we drive (mirrors `@deepseek-ai/dsh-agent` `Agent`). */
interface LiveAgent {
  readonly session: { deriveMessages(): AgentMessage[] };
  send(message: AgentUserMessage, target: InboxTarget, wakeup: boolean): void;
  whenIdle(): Promise<void>;
  cancel(cause: string): void;
}

/** Owned agent + capability disposer (mirrors `AgentHandle`). */
interface AgentHandle {
  agent: LiveAgent;
  dispose(): Promise<void>;
}

/**
 * The slice of `ctx.agents` (mirrors `AgentRegistry`) this executor calls.
 * `create()` mints a brand-new session on a caller-supplied id and REJECTS when
 * no agent-loop factory is registered, or when a persisted log already owns the
 * id. `resume()` loads a persisted session by id.
 *
 * `setup` mirrors `CreateAgentOptions.setup`: it runs inside the DSH agent
 * factory's unpublished creation window. That is the ONLY supported place to
 * join an agent preset (`agentPresets.mount()`), because the join must exist
 * before `session/created`/`agent/created` — otherwise the agent publishes
 * with an empty tool catalog (its tools, prompt sections, and skills resolve
 * against the "empty global layer", which is exactly the failure this executor
 * used to produce for every inbound task).
 */
export interface AgentRegistryLike {
  create(options: {
    readonly sessionId: string;
    readonly meta?: { readonly cwd?: string; readonly agentPreset?: string };
    readonly agentOptions?: { provider?: string; model?: string; maxTokens?: number };
    readonly setup?: (agentCtx: unknown) => void | Promise<void>;
  }): Promise<AgentHandle>;
  resume(options: {
    readonly resumeSessionId: string;
    readonly agentOptions?: { provider?: string; model?: string; maxTokens?: number };
    readonly setup?: (agentCtx: unknown) => void | Promise<void>;
  }): Promise<AgentHandle>;
}

/**
 * Structural slice of `ctx.agentPresets` (owned by `@deepseek-ai/dsh-agent-presets`),
 * the preset roster service. Mirrors exactly the two methods the DSH host's own
 * session entry point (`dsh-host-apiproxy` `composeAgent`) uses to compose a
 * fresh agent:
 *   - `resolve(id)` resolves the requested preset (or the deployment default
 *     when `undefined`) and returns `{ id }`;
 *   - `mount(agentCtx, id)` joins the agent's scope to the preset's standing
 *     composition — the ONLY supported call site is the agent factory's
 *     `setup` hook, where a failure rolls the whole creation back.
 */
export interface AgentPresetsLike {
  resolve(id?: string): Promise<{ id: string }>;
  mount(agentCtx: unknown, id: string): Promise<unknown>;
}

/** The executor function returned by {@link createDshAgentExecutor}, plus teardown. */
interface DshAgentExecutor extends TaskExecutor {
  /** Dispose every live per-context session this executor created. */
  disposeAll(): Promise<void>;
}

/** Options for {@link createDshAgentExecutor}. */
export interface DshAgentExecutorOptions {
  /**
   * Absolute workspace path bound to each spawned session's durable header.
   * DSH validates this is absolute and freezes it at creation, so it MUST be
   * absolute — pass `process.cwd()` (the profile's workspace) at wire time.
   */
  cwd: string;
  /** `source.plugin` tag stamped on inbound messages (defaults to `'a2a'`). */
  plugin?: string;
  /** Optional static per-agent model routing forwarded to `create()`. */
  agentOptions?: { provider?: string; model?: string; maxTokens?: number };
  /**
   * Optional resolver for the per-agent model selection, evaluated ONCE PER
   * TASK just before `create()`. This is how a workspace-bound session gets a
   * model: DSH's persona system-prompt section interpolates a `{{model}}`
   * variable that is only filled when the agent has a selected model, and
   * seeding that selection is the creating entry point's responsibility (the
   * deployment default lives on `ctx.agentDefaultModel`, not on the agent).
   * Resolving per task (rather than fixing it at wire time) means a later model
   * switch in Settings is picked up by the next inbound task. Takes precedence
   * over the static {@link agentOptions} when it returns a value.
   */
  resolveAgentOptions?: () => { provider?: string; model?: string; maxTokens?: number } | undefined;
  /**
   * Called ONCE per A2A context, right after its session is first opened
   * (create or resume) and its first prompt sent. Lets the composition name the
   * session and group it (e.g. `ctx.sessionTitle.rename` + a workspace attach)
   * without this module depending on those services. Failures are swallowed by
   * the caller — naming/grouping is cosmetic and must never fail a task.
   */
  onSessionOpened?: (info: { sessionId: string; contextId: string; session: LiveAgent['session']; firstPrompt: string }) => void | Promise<void>;
  /**
   * The DSH agent-preset roster (`ctx.agentPresets`), probed by the caller via
   * the reflection layer — see `probeAgentPresets` in `index.ts`. When present,
   * every spawned session is composed from the deployment's default preset so
   * it actually gets tools (shell, fs, skills …). Without a roster, sessions
   * keep the legacy behavior: they run against the host composition only.
   */
  agentPresets?: AgentPresetsLike;
}

/** Flatten A2A message parts into a single prompt string (text parts only). */
function partsToPrompt(parts: Part[]): string {
  return parts
    .map((p) => ('text' in p && typeof p.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** Read the last assistant message's text off an agent's derived history. */
function lastAssistantText(agent: LiveAgent): string {
  const history = agent.session.deriveMessages();
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      return history[i].content
        .map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
    }
  }
  return '';
}

/** Derive a stable session id for an A2A context id. */
function sessionIdForContext(contextId: string): string {
  return `a2a-${contextId}`;
}

/**
 * DSH agent executor: forward each inbound A2A task to this harness's own agent
 * loop and return the assistant reply as the task artifact.
 *
 * ONE A2A CONTEXT ⇒ ONE SESSION. A2A already scopes a conversation by
 * `contextId`, so this executor keeps one workspace-bound agent session per
 * context: the first task for a context `create()`s it (session id derived from
 * the context, `meta.cwd` from `opts.cwd`), and later tasks for the same
 * context reuse the SAME live agent so history accumulates. Distinct contexts
 * get distinct sessions. A fresh process that sees a known context first tries
 * `resume()` (load persisted history), falling back to `create()`.
 *
 * Sessions are NOT disposed per task — a disposed session couldn't accumulate
 * context. The returned executor exposes {@link DshAgentExecutor.disposeAll} so
 * the plugin disposes every live per-context session on unload/teardown.
 *
 * Per-context work is serialized on a promise chain so concurrent tasks for the
 * same context (and the shared `whenIdle()` — a whole-agent quiescence signal,
 * not a per-message one) can't interleave. Different contexts run in parallel.
 *
 * Enable this via the plugin's `execute` precedence in `index.ts`; it is not
 * `A2AServer`'s default (the default stays {@link notConfiguredExecutor}).
 */
export function createDshAgentExecutor(
  agents: AgentRegistryLike,
  opts: DshAgentExecutorOptions,
): DshAgentExecutor {
  const plugin = opts.plugin ?? 'a2a';
  // Live per-context handles and the serialization tail for each context.
  const handles = new Map<string, AgentHandle>();
  const tails = new Map<string, Promise<unknown>>();

  /**
   * Get or open the live agent for a context. Returns the agent and whether it
   * was JUST opened (so the caller fires the one-time onSessionOpened hook after
   * the first prompt lands, keeping "open" and "first message" atomic per tail).
   * `justOpened` is true only on the create/resume path — a cached handle returns
   * false — so it alone gates the once-per-context hook; serialization on the
   * per-context tail guarantees no two openings race.
   */
  const agentFor = async (contextId: string): Promise<{ agent: LiveAgent; sessionId: string; justOpened: boolean }> => {
    const sessionId = sessionIdForContext(contextId);
    const existing = handles.get(contextId);
    if (existing) return { agent: existing.agent, sessionId, justOpened: false };
    const agentOptions = opts.resolveAgentOptions?.() ?? opts.agentOptions;
    const withModel = agentOptions ? { agentOptions } : {};
    // Join an agent preset so the spawned session actually has tools: in DSH,
    // an agent's tool catalog, prompt sections, and skills all come from its
    // preset composition. Without the join, the agent publishes against the
    // "empty global layer" and every inbound task degenerates to pure text
    // (the model can only write `<invoke …>` markup as if it were text — the
    // exact failure the a2a-test report described). Resolution mirrors
    // dsh-host-apiproxy's composeAgent(): resolve the id BEFORE create (the
    // session boundary snapshots meta before async setup) and mount inside
    // setup (failure rolls creation back). A deployment without a preset
    // roster (no `agentPresets` service) keeps the pre-preset behavior.
    const presets = opts.agentPresets;
    let presetId: string | undefined;
    let setup: ((agentCtx: unknown) => Promise<void>) | undefined;
    if (presets) {
      try {
        presetId = (await presets.resolve()).id;
        if (!presetId) throw new Error('agent preset roster resolved to no id');
        setup = async (agentCtx: unknown): Promise<void> => {
          await presets.mount(agentCtx, presetId!);
        };
      } catch (err) {
        // A broken/unknown roster must fail creation loudly, not silently
        // spawn a tool-less agent — that is exactly the defect being fixed.
        throw new Error(`a2a: failed to resolve agent preset: ${(err as Error).message}`);
      }
    }
    const withPreset = presetId ? { meta: { cwd: opts.cwd, agentPreset: presetId } } : { meta: { cwd: opts.cwd } };
    const createOptions = { sessionId, ...withPreset, ...withModel, ...(setup ? { setup } : {}) };
    // Create fresh; if a persisted log already owns the id, resume it so history
    // carries over. Any other create() failure is re-thrown.
    let handle: AgentHandle;
    try {
      handle = await agents.create(createOptions);
    } catch (err) {
      if (/already (has|owns)|persisted/i.test((err as Error).message)) {
        handle = await agents.resume({ resumeSessionId: sessionId, ...withModel, ...(setup ? { setup } : {}) });
      } else {
        throw err;
      }
    }
    handles.set(contextId, handle);
    return { agent: handle.agent, sessionId, justOpened: true };
  };

  /** Run one turn on a context's session, serialized behind its tail. */
  const runTurn = async (contextId: string, prompt: string, signal?: AbortSignal): Promise<string> => {
    const { agent, sessionId, justOpened } = await agentFor(contextId);
    const onAbort = (): void => agent.cancel('a2a-canceled');
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const userMessage: AgentUserMessage = Object.freeze<AgentUserMessage>({
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin },
    });
    agent.send(userMessage, 'next-turn', true);
    // Fire the one-time naming/grouping hook after the first prompt is queued
    // (so the title provider has an eligible message).
    if (justOpened) {
      try {
        await opts.onSessionOpened?.({ sessionId, contextId, session: agent.session, firstPrompt: prompt });
      } catch {
        // Naming/grouping is cosmetic — never fail the task over it.
      }
    }
    await agent.whenIdle();
    return lastAssistantText(agent);
  };

  const executor = (async ({ message, contextId, signal }) => {
    const prompt = partsToPrompt(message.parts);
    if (!prompt) {
      return { messageId: crypto.randomUUID(), role: Role.AGENT, parts: [{ text: 'No prompt provided.' }] };
    }
    // A2A guarantees a stable contextId per conversation (TaskStore assigns one
    // when a message omits it), so it's the session key directly.
    const ctxKey = contextId;
    // Serialize per context: chain this task behind the context's tail so
    // concurrent tasks for the same conversation never interleave turns.
    const prior = tails.get(ctxKey) ?? Promise.resolve();
    const run = prior.catch(() => {}).then(() => runTurn(ctxKey, prompt, signal));
    tails.set(ctxKey, run);
    try {
      const replyText = await run;
      const text = signal?.aborted ? `(canceled) ${replyText}`.trim() : replyText || '(no reply)';
      return { messageId: crypto.randomUUID(), role: Role.AGENT, parts: [{ text }] };
    } catch (err) {
      // Most common cause: no agent-loop factory (bare dsh-base) — create()
      // rejects. Surface it as a readable artifact, not a raw throw.
      return {
        messageId: crypto.randomUUID(),
        role: Role.AGENT,
        parts: [{ text: `DSH agent executor error: ${(err as Error).message}` }],
      };
    } finally {
      // Clear the tail only if it's still ours (no later task chained on).
      if (tails.get(ctxKey) === run) tails.delete(ctxKey);
    }
  }) as DshAgentExecutor;

  executor.disposeAll = async (): Promise<void> => {
    const live = [...handles.values()];
    const pending = [...tails.values()];
    handles.clear();
    tails.clear();
    // Let in-flight turns settle before tearing their sessions down, so a
    // running turn isn't disposed out from under itself.
    await Promise.allSettled(pending);
    // dispose() is a capability: not calling it leaks the agent + session.
    await Promise.allSettled(live.map((h) => h.dispose()));
  };

  return executor;
}
