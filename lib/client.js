/**
 * A2A (Agent2Agent) Protocol v1.0 — outbound client.
 *
 * A thin client that discovers an agent via its AgentCard and speaks the
 * JSONRPC binding: SendMessage (sync/async), SendStreamingMessage,
 * GetTask, CancelTask, ListTasks.
 */
import { fetchAgentCard, pickInterface } from './card.js';
import { TaskState, isTerminal } from './protocol.js';
import { JsonRpcClient } from './jsonrpc.js';
import { A2AError } from './errors.js';
/** A2A client bound to one remote agent. */
export class A2AClient {
    card;
    rpc;
    endpointUrl;
    tenant;
    static async connect(agentCardUrlOrBase, options = {}) {
        const card = await fetchAgentCard(agentCardUrlOrBase, options);
        return new A2AClient(card, options);
    }
    constructor(card, options = {}) {
        this.card = card;
        const { iface, url } = pickInterface(card, options.preferredBinding);
        this.endpointUrl = url;
        this.tenant = iface.tenant;
        this.rpc = new JsonRpcClient(url, options);
    }
    /** Send a message; returns a Task or Message per the server's choice. */
    async sendMessage(message, configuration, options = {}) {
        return this.rpc.call('SendMessage', {
            message,
            configuration,
            ...(this.tenant ? { tenant: this.tenant } : {}),
        }, options);
    }
    /** Send a message over a stream, yielding all StreamResponse events. */
    streamMessage(message, configuration = {}, options = {}) {
        return this.rpc.stream('SendStreamingMessage', {
            message,
            configuration,
            ...(this.tenant ? { tenant: this.tenant } : {}),
        }, options);
    }
    async getTask(id, historyLength, options = {}) {
        return this.rpc.call('GetTask', {
            id,
            ...(historyLength !== undefined ? { historyLength } : {}),
            ...(this.tenant ? { tenant: this.tenant } : {}),
        }, options);
    }
    async listTasks(params = {}, options = {}) {
        return this.rpc.call('ListTasks', { ...params, ...(this.tenant ? { tenant: this.tenant } : {}) }, options);
    }
    async cancelTask(id, options = {}) {
        return this.rpc.call('CancelTask', {
            id,
            ...(this.tenant ? { tenant: this.tenant } : {}),
        }, options);
    }
    /**
     * Send a message and wait (polling) until the created task reaches a
     * terminal state. Errors if the task fails or is rejected.
     */
    async sendAndWait(message, configuration = {}, options = {}) {
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
        if (!task)
            throw new A2AError(-32602, 'SendMessage returned neither a Task nor a Message');
        let t = task;
        for (;;) {
            if (isTerminal(t.status.state))
                return t;
            if (t.status.state === TaskState.INPUT_REQUIRED || t.status.state === TaskState.AUTH_REQUIRED) {
                throw new A2AError(-32001, `Task ${t.id} is interrupted (${t.status.state}): ${t.status.message?.parts?.[0] && 'text' in t.status.message.parts[0] ? t.status.message.parts[0].text : 'agent awaits input'}`);
            }
            if (options.signal?.aborted)
                throw new A2AError(408, 'Task wait aborted');
            await new Promise((r) => setTimeout(r, options.intervalMs ?? 500));
            t = await this.getTask(t.id, 0, options);
        }
    }
}
