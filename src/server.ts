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
    // When a bearer token is configured, advertise it on the AgentCard per
    // the A2A securitySchemes type so clients know to authenticate.
    if (token) {
      card.securitySchemes = {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
      };
      card.securityRequirements = [{ schemes: { bearerAuth: [] } }];
    }
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
  async handleStream(req: { method?: string; url?: string; headers?: Record<string, string>; socket?: { remoteAddress?: string; remotePort?: number } }, body: string, onEvent: (frame: string) => void): Promise<{ status: number }> {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST' || path !== this.endpointPath) {
      onEvent(`event: error\ndata: ${JSON.stringify({ code: 404, message: 'Not Found' })}\n\n`);
      return { status: 200 };
    }
    if (!this.authorized(req)) {
      onEvent(`event: error\ndata: ${JSON.stringify({ code: -32001, message: 'Unauthorized' })}\n\n`);
      return { status: 401 };
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
    const signal = new AbortController().signal;
    try {
      const reply = await this.execute({ message: msg, taskId, contextId, signal });
      this.store.addArtifact(taskId, { artifactId: 'result', parts: reply.parts, lastChunk: true });
      this.store.setStatus(taskId, TaskState.COMPLETED, reply);
      this.options.onTaskSettled?.(taskId);
      const task = this.store.get(taskId)!;
      this.emit({ task });
      this.emit({ artifactUpdate: { taskId, contextId, artifact: task.artifacts![task.artifacts!.length - 1], lastChunk: true } });
    } catch (err) {
      const message: Message = {
        messageId: crypto.randomUUID(),
        role: Role.AGENT,
        parts: [{ text: `Task failed: ${(err as Error).message ?? String(err)}` }],
      };
      this.store.setStatus(taskId, TaskState.FAILED, message);
      this.options.onTaskSettled?.(taskId);
      this.emit({ statusUpdate: { taskId, contextId, status: this.store.get(taskId)!.status } });
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
