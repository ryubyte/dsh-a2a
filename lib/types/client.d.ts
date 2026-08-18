/**
 * A2A (Agent2Agent) Protocol v1.0 — outbound client.
 *
 * A thin client that discovers an agent via its AgentCard and speaks the
 * JSONRPC binding: SendMessage (sync/async), SendStreamingMessage,
 * GetTask, CancelTask, ListTasks.
 */
import type { AgentCard, Message, SendMessageConfiguration, SendMessageResponse, StreamResponse, Task } from './protocol.js';
import { TaskState } from './protocol.js';
import { type JsonRpcClientOptions, type JsonRpcCallOptions } from './jsonrpc.js';
export interface A2AClientOptions extends JsonRpcClientOptions {
    /** Prefer a specific protocol binding. Default 'JSONRPC'. */
    preferredBinding?: string;
}
export interface WaitForTaskOptions {
    /** Poll interval in ms. Default 500. */
    intervalMs?: number;
    signal?: AbortSignal;
}
/** A2A client bound to one remote agent. */
export declare class A2AClient {
    readonly card: AgentCard;
    private readonly rpc;
    readonly endpointUrl: string;
    readonly tenant?: string;
    static connect(agentCardUrlOrBase: string, options?: A2AClientOptions): Promise<A2AClient>;
    constructor(card: AgentCard, options?: A2AClientOptions);
    /** Send a message; returns a Task or Message per the server's choice. */
    sendMessage(message: Message, configuration?: SendMessageConfiguration, options?: JsonRpcCallOptions): Promise<SendMessageResponse>;
    /** Send a message over a stream, yielding all StreamResponse events. */
    streamMessage(message: Message, configuration?: SendMessageConfiguration, options?: JsonRpcCallOptions): AsyncGenerator<StreamResponse>;
    getTask(id: string, historyLength?: number, options?: JsonRpcCallOptions): Promise<Task>;
    listTasks(params?: {
        contextId?: string;
        status?: TaskState;
        pageSize?: number;
        pageToken?: string;
        includeArtifacts?: boolean;
    }, options?: JsonRpcCallOptions): Promise<{
        tasks: Task[];
        nextPageToken: string;
        pageSize: number;
        totalSize: number;
    }>;
    cancelTask(id: string, options?: JsonRpcCallOptions): Promise<Task>;
    /**
     * Send a message and wait (polling) until the created task reaches a
     * terminal state. Errors if the task fails or is rejected.
     */
    sendAndWait(message: Message, configuration?: SendMessageConfiguration, options?: JsonRpcCallOptions & WaitForTaskOptions): Promise<Task>;
}
//# sourceMappingURL=client.d.ts.map