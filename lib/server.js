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
import { TaskState, Role, A2A_METHODS, A2A_ERROR_CODES, isTerminal, } from './protocol.js';
/** In-memory task store with the full A2A Task lifecycle. */
export class TaskStore {
    tasks = new Map();
    messages = new Map();
    create(message) {
        const taskId = crypto.randomUUID();
        const contextId = message.contextId ?? crypto.randomUUID();
        const task = {
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
    get(id) {
        return this.tasks.get(id);
    }
    list() {
        return [...this.tasks.values()];
    }
    setStatus(taskId, state, message) {
        const task = this.tasks.get(taskId);
        if (!task)
            throw new Error(`task ${taskId} not found`);
        task.status = { state, message, timestamp: new Date().toISOString() };
        if (message) {
            this.messages.set(message.messageId, message);
            task.history = [...(task.history ?? []), message];
        }
        return task;
    }
    addArtifact(taskId, artifact) {
        const task = this.tasks.get(taskId);
        if (!task)
            throw new Error(`task ${taskId} not found`);
        const existing = task.artifacts?.find((a) => a.artifactId === artifact.artifactId);
        if (existing) {
            existing.parts.push(...artifact.parts);
        }
        else {
            task.artifacts = [...(task.artifacts ?? []), { artifactId: artifact.artifactId, name: artifact.name, parts: artifact.parts }];
        }
        return task;
    }
    getMessage(id) {
        return this.messages.get(id);
    }
}
/** Extract a human-readable source address from a request (when visible). */
function sourceOf(req) {
    const s = req.socket;
    if (!s?.remoteAddress)
        return undefined;
    return `${s.remoteAddress}:${s.remotePort ?? ''}`;
}
/** A2A JSON-RPC server handler over a raw HTTP request/response pair. */
export class A2AServer {
    options;
    store;
    card;
    endpointPath;
    execute;
    listeners = new Set();
    baseUrl;
    constructor(options, store = new TaskStore()) {
        this.options = options;
        this.store = store;
        this.execute = options.execute ?? defaultExecutor;
        this.endpointPath = options.endpointPath ?? '/a2a';
        this.baseUrl = options.baseUrl;
        this.card = this.buildCard();
    }
    /**
     * Update the base URL advertised in the AgentCard after the real listen
     * address is known (e.g. ephemeral port). Mutates `card` in place.
     */
    setBaseUrl(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.card.supportedInterfaces = this.card.supportedInterfaces.map((iface) => ({
            ...iface,
            url: `${this.baseUrl}${this.endpointPath}`,
        }));
    }
    buildCard() {
        const iface = {
            url: `${this.baseUrl.replace(/\/$/, '')}${this.endpointPath}`,
            protocolBinding: 'JSONRPC',
            protocolVersion: '1.0',
        };
        const skills = this.options.skills ?? defaultSkills;
        return {
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
    }
    emit(ev) {
        for (const l of this.listeners)
            l(ev);
    }
    /** Route an inbound HTTP request; returns true when handled. */
    async handle(req, body) {
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
            let payload;
            try {
                payload = JSON.parse(body);
            }
            catch {
                return this.jsonRpcError(null, A2A_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON', 'Parse error');
            }
            const rpc = payload;
            if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
                return this.jsonRpcError(rpc?.id ?? null, A2A_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC request');
            }
            try {
                const result = await this.dispatch(rpc);
                this.options.onInbound?.({
                    method: rpc.method,
                    headers: req.headers,
                    source: sourceOf(req),
                    taskIds: [],
                    streaming: false,
                });
                return {
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }),
                };
            }
            catch (err) {
                const e = err;
                return this.jsonRpcError(rpc.id ?? null, typeof e.code === 'number' ? e.code : A2A_ERROR_CODES.INTERNAL_ERROR, e.message ?? String(err), e.data);
            }
        }
        return { status: 404, contentType: 'text/plain', body: 'Not Found' };
    }
    async handleStream(req, body, onEvent) {
        const path = (req.url ?? '').split('?')[0];
        if (req.method !== 'POST' || path !== this.endpointPath) {
            onEvent(`event: error\ndata: ${JSON.stringify({ code: 404, message: 'Not Found' })}\n\n`);
            return { status: 200 };
        }
        let payload;
        try {
            payload = JSON.parse(body);
        }
        catch {
            onEvent(`event: error\ndata: ${JSON.stringify({ code: A2A_ERROR_CODES.INVALID_REQUEST, message: 'Parse error' })}\n\n`);
            return { status: 200 };
        }
        const rpc = payload;
        const method = rpc?.method;
        if (method === A2A_METHODS.sendStreamingMessage || method === A2A_METHODS.subscribeToTask) {
            const taskId = method === A2A_METHODS.subscribeToTask
                ? rpc.params?.id
                : await this.ensureTask(rpc.params);
            if (!taskId) {
                onEvent(`event: error\ndata: ${JSON.stringify({ code: A2A_ERROR_CODES.INVALID_PARAMS, message: 'Missing message' })}\n\n`);
                return { status: 200 };
            }
            const task = this.store.get(taskId);
            if (!task) {
                onEvent(`event: error\ndata: ${JSON.stringify({ code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: `Task ${taskId} not found` })}\n\n`);
                return { status: 200 };
            }
            const sub = (ev) => onEvent(`data: ${JSON.stringify(ev)}\n\n`);
            this.listeners.add(sub);
            this.options.onInbound?.({
                method,
                headers: req.headers,
                source: sourceOf(req),
                taskIds: taskId ? [taskId] : [],
                streaming: true,
            });
            try {
                // If this was a fresh SendStreamingMessage, kick off execution now.
                if (method === A2A_METHODS.sendStreamingMessage) {
                    const msg = rpc.params.message;
                    this.runTask(task.id, task.contextId, msg, sub);
                }
                // Keep the stream open until the task reaches a terminal state.
                await this.waitTerminal(task.id);
                onEvent(`data: ${JSON.stringify({ task: this.store.get(taskId) })}\n\n`);
            }
            finally {
                this.listeners.delete(sub);
            }
            return { status: 200 };
        }
        onEvent(`event: error\ndata: ${JSON.stringify({ code: A2A_ERROR_CODES.METHOD_NOT_FOUND, message: `Unknown method ${method}` })}\n\n`);
        return { status: 200 };
    }
    async ensureTask(params) {
        if (!params?.message)
            return undefined;
        const msg = params.message;
        // If message references an existing task, continue it; else create.
        if (msg.taskId && this.store.get(msg.taskId))
            return msg.taskId;
        const task = this.store.create(msg);
        return task.id;
    }
    async waitTerminal(taskId) {
        for (;;) {
            const t = this.store.get(taskId);
            if (t && isTerminal(t.status.state))
                return;
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    /** Execute a task in the background, streaming status/artifact updates. */
    async runTask(taskId, contextId, msg, emit) {
        this.store.setStatus(taskId, TaskState.WORKING);
        this.emit({ statusUpdate: { taskId, contextId, status: this.store.get(taskId).status } });
        const signal = new AbortController().signal;
        try {
            const reply = await this.execute({ message: msg, taskId, contextId, signal });
            this.store.addArtifact(taskId, { artifactId: 'result', parts: reply.parts, lastChunk: true });
            this.store.setStatus(taskId, TaskState.COMPLETED, reply);
            const task = this.store.get(taskId);
            this.emit({ task });
            this.emit({ artifactUpdate: { taskId, contextId, artifact: task.artifacts[task.artifacts.length - 1], lastChunk: true } });
        }
        catch (err) {
            const message = {
                messageId: crypto.randomUUID(),
                role: Role.AGENT,
                parts: [{ text: `Task failed: ${err.message ?? String(err)}` }],
            };
            this.store.setStatus(taskId, TaskState.FAILED, message);
            this.emit({ statusUpdate: { taskId, contextId, status: this.store.get(taskId).status } });
        }
    }
    async dispatch(rpc) {
        const method = rpc.method;
        const params = (rpc.params ?? {});
        switch (method) {
            case A2A_METHODS.sendMessage: {
                const msg = params.message;
                if (!msg?.parts?.length)
                    throw { code: A2A_ERROR_CODES.INVALID_PARAMS, message: 'Missing message' };
                const taskId = await this.ensureTask(params);
                const task = this.store.get(taskId);
                // Run synchronously (returnImmediately=false default) — execute inline,
                // but don't block forever: the executor contract returns a Message.
                this.runTask(task.id, task.contextId, msg);
                // For a stateless-style SendMessage, wait for completion.
                await this.waitTerminal(task.id);
                return { task: this.store.get(task.id) };
            }
            case A2A_METHODS.getTask: {
                const id = params.id;
                const task = this.store.get(id);
                if (!task)
                    throw { code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: `Task ${id} not found` };
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
                const id = params.id;
                const task = this.store.get(id);
                if (!task)
                    throw { code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: `Task ${id} not found` };
                if (isTerminal(task.status.state)) {
                    throw { code: A2A_ERROR_CODES.TASK_CANCEL_NOT_ALLOWED, message: `Task ${id} already in terminal state ${task.status.state}` };
                }
                this.store.setStatus(id, TaskState.CANCELED);
                return this.store.get(id);
            }
            case A2A_METHODS.getExtendedAgentCard:
                return this.card;
            default:
                throw { code: A2A_ERROR_CODES.METHOD_NOT_FOUND, message: `Method ${method} not supported` };
        }
    }
    jsonRpcError(id, code, message, data) {
        const err = { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
        return { status: 200, contentType: 'application/json', body: JSON.stringify(err) };
    }
}
export const defaultSkills = [
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
 * Default executor: run the incoming prompt through the system shell and
 * return the captured stdout/stderr as the task artifact. Honors the
 * AbortSignal (task cancellation / shutdown) by killing the child process.
 */
export const defaultExecutor = async ({ message, signal }) => {
    const text = message.parts
        .map((p) => ('text' in p ? p.text : ''))
        .filter(Boolean)
        .join('\n');
    if (!text.trim()) {
        return { messageId: crypto.randomUUID(), role: Role.AGENT, parts: [{ text: 'No prompt provided.' }] };
    }
    try {
        const { execFile } = await import('node:child_process');
        const out = await new Promise((resolve, reject) => {
            const child = execFile('/bin/sh', ['-c', text], { timeout: 30000, maxBuffer: 1024 * 1024, signal }, (err, stdout, stderr) => {
                if (err) {
                    if (err.killed || signal?.aborted) {
                        resolve(`(aborted) ${stdout}${stderr}`.trim() || '(aborted)');
                        return;
                    }
                    resolve(`(exit ${err.code ?? '?'}) ${stdout}\n${stderr}`);
                    return;
                }
                resolve(`${stdout}\n${stderr}`.trim());
            });
            // Redundant safety: if the signal fires between spawn and execFile's
            // internal wiring, make sure the child is killed.
            signal?.addEventListener('abort', () => child.kill(), { once: true });
        });
        return { messageId: crypto.randomUUID(), role: Role.AGENT, parts: [{ text: out || '(no output)' }] };
    }
    catch (err) {
        return { messageId: crypto.randomUUID(), role: Role.AGENT, parts: [{ text: `Executor error: ${err.message}` }] };
    }
};
