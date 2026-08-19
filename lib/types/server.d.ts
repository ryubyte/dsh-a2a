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
import type { AgentCard, AgentSkill, Message, Part, Task } from './protocol.js';
import { TaskState } from './protocol.js';
export interface ServerSkill extends AgentSkill {
}
export interface ServerOptions {
    /** Public base URL (scheme + host + optional prefix) where this DSH is exposed. */
    baseUrl: string;
    agentName: string;
    agentDescription: string;
    agentVersion: string;
    agentProvider?: {
        url: string;
        organization: string;
    };
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
    (input: {
        message: Message;
        taskId: string;
        contextId: string;
        signal: AbortSignal;
    }): Promise<Message>;
}
export interface InboundHandle {
    card: AgentCard;
    endpointPath: string;
    taskStore: TaskStore;
    dispose: () => void;
}
/** In-memory task store with the full A2A Task lifecycle. */
export declare class TaskStore {
    private tasks;
    private messages;
    create(message: Message): Task;
    get(id: string): Task | undefined;
    list(): Task[];
    setStatus(taskId: string, state: TaskState, message?: Message): Task;
    addArtifact(taskId: string, artifact: {
        artifactId: string;
        parts: Part[];
        name?: string;
        append?: boolean;
        lastChunk?: boolean;
    }): Task;
    getMessage(id: string): Message | undefined;
}
/** A2A JSON-RPC server handler over a raw HTTP request/response pair. */
export declare class A2AServer {
    readonly options: ServerOptions;
    readonly store: TaskStore;
    readonly card: AgentCard;
    readonly endpointPath: string;
    private execute;
    private listeners;
    private baseUrl;
    constructor(options: ServerOptions, store?: TaskStore);
    /**
     * Update the base URL advertised in the AgentCard after the real listen
     * address is known (e.g. ephemeral port). Mutates `card` in place.
     */
    setBaseUrl(baseUrl: string): void;
    private buildCard;
    /** True when the request carries the configured bearer token. */
    private authorized;
    private emit;
    /** Route an inbound HTTP request; returns true when handled. */
    handle(req: {
        method?: string;
        url?: string;
        headers?: {
            'content-type'?: string;
        };
        socket?: {
            remoteAddress?: string;
            remotePort?: number;
        };
    }, body: string): Promise<{
        status: number;
        contentType: string;
        body: string;
        headers?: Record<string, string>;
    }>;
    handleStream(req: {
        method?: string;
        url?: string;
        headers?: Record<string, string>;
        socket?: {
            remoteAddress?: string;
            remotePort?: number;
        };
    }, body: string, onEvent: (frame: string) => void): Promise<{
        status: number;
    }>;
    private ensureTask;
    private waitTerminal;
    /** Execute a task in the background, streaming status/artifact updates. */
    private runTask;
    private dispatch;
    private jsonRpcError;
}
export declare const defaultSkills: ServerSkill[];
/**
 * Safe default executor: refuses to act, telling the caller to inject a real
 * executor. Used when an `A2AServer` is constructed without an `execute`
 * option, so an inbound message never triggers arbitrary action (in particular
 * never a shell command) unless the operator explicitly configured one.
 */
export declare const notConfiguredExecutor: TaskExecutor;
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
export declare const shellExecutor: TaskExecutor;
/**
 * Backwards-compatible alias for {@link shellExecutor}. Kept for code that
 * explicitly opted into the shell executor before it was renamed; the safe
 * default for `A2AServer` is now {@link notConfiguredExecutor}, so using
 * this alias still requires an explicit opt-in.
 */
export declare const defaultExecutor: TaskExecutor;
//# sourceMappingURL=server.d.ts.map