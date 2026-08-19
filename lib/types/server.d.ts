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
    /** Abort controllers for in-flight tasks, so CancelTask can abort the executor. */
    private running;
    constructor(options: ServerOptions, store?: TaskStore);
    /**
     * Update the base URL advertised in the AgentCard after the real listen
     * address is known (e.g. ephemeral port). Mutates `card` in place.
     */
    setBaseUrl(baseUrl: string): void;
    /**
     * Set or clear the shared bearer token that gates the inbound endpoint at
     * runtime. Rebuilds the AgentCard so the `bearerAuth` security scheme is
     * advertised (token set) or withdrawn (token cleared); `authorized()` reads
     * `options.authToken` on each request, so the gate flips immediately. Pass
     * `undefined` or an empty string to disable token gating.
     */
    setAuthToken(token?: string): void;
    /** Whether the inbound endpoint is currently token-gated. */
    get authConfigured(): boolean;
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
        headers?: Record<string, string>;
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
    readonly content: ReadonlyArray<{
        type: string;
        text?: string;
    }>;
}
/** A user-role message accepted by `agent.send` (mirrors `UserMessage`). */
interface AgentUserMessage {
    readonly id: string;
    readonly role: 'user';
    readonly content: AgentTextBlock[];
    readonly source: {
        kind: 'plugin';
        plugin: string;
    };
}
/** The slice of a live `Agent` we drive (mirrors `@deepseek-ai/dsh-agent` `Agent`). */
interface LiveAgent {
    readonly session: {
        deriveMessages(): AgentMessage[];
    };
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
        readonly meta?: {
            readonly cwd?: string;
            readonly agentPreset?: string;
        };
        readonly agentOptions?: {
            provider?: string;
            model?: string;
            maxTokens?: number;
        };
        readonly setup?: (agentCtx: unknown) => void | Promise<void>;
    }): Promise<AgentHandle>;
    resume(options: {
        readonly resumeSessionId: string;
        readonly agentOptions?: {
            provider?: string;
            model?: string;
            maxTokens?: number;
        };
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
    resolve(id?: string): Promise<{
        id: string;
    }>;
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
    agentOptions?: {
        provider?: string;
        model?: string;
        maxTokens?: number;
    };
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
    resolveAgentOptions?: () => {
        provider?: string;
        model?: string;
        maxTokens?: number;
    } | undefined;
    /**
     * Called ONCE per A2A context, right after its session is first opened
     * (create or resume) and its first prompt sent. Lets the composition name the
     * session and group it (e.g. `ctx.sessionTitle.rename` + a workspace attach)
     * without this module depending on those services. Failures are swallowed by
     * the caller — naming/grouping is cosmetic and must never fail a task.
     */
    onSessionOpened?: (info: {
        sessionId: string;
        contextId: string;
        session: LiveAgent['session'];
        firstPrompt: string;
    }) => void | Promise<void>;
    /**
     * The DSH agent-preset roster (`ctx.agentPresets`), probed by the caller via
     * the reflection layer — see `probeAgentPresets` in `index.ts`. When present,
     * every spawned session is composed from the deployment's default preset so
     * it actually gets tools (shell, fs, skills …). Without a roster, sessions
     * keep the legacy behavior: they run against the host composition only.
     */
    agentPresets?: AgentPresetsLike;
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
export declare function createDshAgentExecutor(agents: AgentRegistryLike, opts: DshAgentExecutorOptions): DshAgentExecutor;
export {};
//# sourceMappingURL=server.d.ts.map