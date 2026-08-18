/**
 * A2A (Agent2Agent) Protocol v1.0 — outbound client.
 *
 * A thin client that discovers an agent via its AgentCard and speaks the
 * JSONRPC binding: SendMessage (sync/async), SendStreamingMessage,
 * GetTask, CancelTask, ListTasks.
 */

import { fetchAgentCard, pickInterface } from './card.js';
import type { AgentCard, Message, SendMessageConfiguration, SendMessageResponse, StreamResponse, Task } from './protocol.js';
import { TaskState, isTerminal } from './protocol.js';
import { JsonRpcClient, type JsonRpcClientOptions, type JsonRpcCallOptions } from './jsonrpc.js';
import { A2AError } from './errors.js';

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
export class A2AClient {
  readonly card: AgentCard;
  private readonly rpc: JsonRpcClient;
  readonly endpointUrl: string;
  readonly tenant?: string;

  static async connect(
    agentCardUrlOrBase: string,
    options: A2AClientOptions = {},
  ): Promise<A2AClient> {
    const card = await fetchAgentCard(agentCardUrlOrBase, options);
    return new A2AClient(card, options);
  }

  constructor(card: AgentCard, options: A2AClientOptions = {}) {
    this.card = card;
    const { iface, url } = pickInterface(card, options.preferredBinding);
    this.endpointUrl = url;
    this.tenant = iface.tenant;
    this.rpc = new JsonRpcClient(url, options);
  }

  /** Send a message; returns a Task or Message per the server's choice. */
  async sendMessage(
    message: Message,
    configuration?: SendMessageConfiguration,
    options: JsonRpcCallOptions = {},
  ): Promise<SendMessageResponse> {
    return this.rpc.call<SendMessageResponse>('SendMessage', {
      message,
      configuration,
      ...(this.tenant ? { tenant: this.tenant } : {}),
    }, options);
  }

  /** Send a message over a stream, yielding all StreamResponse events. */
  streamMessage(
    message: Message,
    configuration: SendMessageConfiguration = {},
    options: JsonRpcCallOptions = {},
  ): AsyncGenerator<StreamResponse> {
    return this.rpc.stream<StreamResponse>('SendStreamingMessage', {
      message,
      configuration,
      ...(this.tenant ? { tenant: this.tenant } : {}),
    }, options);
  }

  async getTask(id: string, historyLength?: number, options: JsonRpcCallOptions = {}): Promise<Task> {
    return this.rpc.call<Task>('GetTask', {
      id,
      ...(historyLength !== undefined ? { historyLength } : {}),
      ...(this.tenant ? { tenant: this.tenant } : {}),
    }, options);
  }

  async listTasks(params: {
    contextId?: string;
    status?: TaskState;
    pageSize?: number;
    pageToken?: string;
    includeArtifacts?: boolean;
  } = {}, options: JsonRpcCallOptions = {}): Promise<{
    tasks: Task[];
    nextPageToken: string;
    pageSize: number;
    totalSize: number;
  }> {
    return this.rpc.call('ListTasks', { ...params, ...(this.tenant ? { tenant: this.tenant } : {}) }, options);
  }

  async cancelTask(id: string, options: JsonRpcCallOptions = {}): Promise<Task> {
    return this.rpc.call<Task>('CancelTask', {
      id,
      ...(this.tenant ? { tenant: this.tenant } : {}),
    }, options);
  }

  /**
   * Send a message and wait (polling) until the created task reaches a
   * terminal state. Errors if the task fails or is rejected.
   */
  async sendAndWait(
    message: Message,
    configuration: SendMessageConfiguration = {},
    options: JsonRpcCallOptions & WaitForTaskOptions = {},
  ): Promise<Task> {
    const resp = await this.sendMessage(message, { ...configuration, returnImmediately: true }, options);
    if ('message' in resp && resp.message) {
      // Stateless agent: no task to track; synthesize a completed task.
      return {
        id: 'message',
        status: { state: TaskState.COMPLETED, timestamp: new Date().toISOString() },
        artifacts: [{ artifactId: 'message', parts: resp.message.parts }],
        history: [resp.message],
      };
    }
    const task = 'task' in resp && resp.task ? resp.task : undefined;
    if (!task) throw new A2AError(-32602, 'SendMessage returned neither a Task nor a Message');
    let t = task;
    for (;;) {
      if (isTerminal(t.status.state as TaskState)) return t;
      // INPUT_REQUIRED / AUTH_REQUIRED are NOT hard errors: the remote agent
      // is asking for clarification (or credentials). Return the task so the
      // caller can surface `status.message` to the model and let it respond,
      // instead of throwing and stalling the tool call.
      if (t.status.state === TaskState.INPUT_REQUIRED || t.status.state === TaskState.AUTH_REQUIRED) {
        return t;
      }
      if (options.signal?.aborted) throw new A2AError(408, 'Task wait aborted');
      await new Promise((r) => setTimeout(r, options.intervalMs ?? 500));
      t = await this.getTask(t.id, 0, options);
    }
  }
}