/**
 * dsh-a2a — outbound half: bridge remote A2A agent skills into DSH's tool
 * registry (`ctx.tools`).
 *
 * Each skill on a remote AgentCard becomes a model-facing tool named
 * `a2a__<agentName>__<skillId>` (normalized to the DSH function-name
 * contract: `[A-Za-z0-9_-]`, ≤64 chars; on collision a deterministic hash is
 * appended, mirroring dsh-mcp-client's naming rule).
 */

import type { AgentCard, AgentSkill, Message, Part } from './protocol.js';
import { Role } from './protocol.js';
import { A2AClient } from './client.js';
import { A2AError } from './errors.js';

export interface ToolLike {
  register?(definition: unknown): (() => void) | void;
}

export interface OutboundOptions {
  /** Namespace prefix for tool names (lowercase, unique across instances). */
  name: string;
  agentCardUrl: string;
  bearerToken?: string;
  /** Per-call timeout in ms. Default 60000. */
  timeoutMs?: number;
  /** Register one generic tool per skill (default true). */
  mapSkills?: boolean;
  /**
   * Optional connection-lifecycle observation: called once the AgentCard is
   * fetched and the connection is usable. `connectionId` is the stable id the
   * dashboard tracks this connection under.
   */
  onReady?: (info: { connectionId: string; card: AgentCard }) => void;
  /** Called when the connection (and its tools) are torn down. */
  onDispose?: (connectionId: string) => void;
}

function normalizeToolName(raw: string): string {
  const norm = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  if (norm.length > 0 && /^[A-Za-z0-9_-]+$/.test(norm)) return norm;
  // fallback: deterministic hash
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return `_${h.toString(16)}`;
}

function skillToToolName(agentName: string, skill: AgentSkill): string {
  const raw = `a2a__${agentName}__${skill.id}`;
  const base = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  if (base === raw || base.length < 64) return base;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return `${base.slice(0, 56)}_${h.toString(16)}`;
}

/** Extract the first meaningful text from message parts. */
function partsToText(parts: Part[] | undefined): string {
  if (!parts) return '';
  return parts
    .map((p) => {
      if ('text' in p && p.text) return p.text;
      if ('url' in p && p.url) return p.url;
      if ('data' in p && p.data !== undefined) return JSON.stringify(p.data);
      if ('raw' in p && p.raw) return `[raw ${p.mediaType ?? 'application/octet-stream'}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export interface RegisteredTool {
  name: string;
  /** Stable id of the client connection this tool belongs to. */
  connectionId?: string;
  dispose: () => void;
}

/**
 * Register all skills of a remote agent on `ctx.tools` and return disposers.
 */
export async function registerAgentTools(
  tools: ToolLike,
  options: OutboundOptions,
): Promise<RegisteredTool[]> {
  const connectionId = crypto.randomUUID();
  const client = await A2AClient.connect(options.agentCardUrl, {
    bearerToken: options.bearerToken,
    timeoutMs: options.timeoutMs,
  });
  const card: AgentCard = client.card;
  const skills = card.skills ?? [];
  options.onReady?.({ connectionId, card });

  // A2A scopes a conversation by `contextId`. To give the LOCAL caller a
  // continuous conversation with this remote agent (cross-call memory), we map
  // the calling DSH agent's session id → a stable contextId, shared across all
  // of this connection's skill-tools (one remote conversation per local agent).
  // Calls with no agent context (e.g. a non-agent caller) share one fallback
  // contextId so they still form a single stable conversation rather than a new
  // remote session per call. Reused for the connection's lifetime.
  const contextByAgent = new Map<string, string>();
  const fallbackContextKey = '\0fallback';
  const contextFor = (agentId: string | undefined): string => {
    const key = agentId ?? fallbackContextKey;
    let ctxId = contextByAgent.get(key);
    if (ctxId === undefined) {
      ctxId = `a2a-out-${crypto.randomUUID()}`;
      contextByAgent.set(key, ctxId);
    }
    return ctxId;
  };

  let disposers: RegisteredTool[] = [];
  if (options.mapSkills === false || skills.length === 0) {
    // Fall back to a single generic tool for the whole agent.
    const name = normalizeToolName(`a2a__${options.name}__agent`);
    const dispose = tools.register?.(makeTool(name, client, {
      id: 'agent',
      name: options.name,
      description: `${card.name}: ${card.description} (no skills advertised)`,
    }, contextFor));
    if (dispose) disposers = [{ name, dispose }];
  } else {
    const out: RegisteredTool[] = [];
    for (const skill of skills) {
      const name = skillToToolName(options.name, skill);
      const dispose = tools.register?.(makeTool(name, client, skill, contextFor));
      if (dispose) out.push({ name, dispose });
    }
    disposers = out;
  }

  return disposers.map((r) => ({
    ...r,
    connectionId,
    dispose: () => {
      r.dispose();
      options.onDispose?.(connectionId);
    },
  }));
}

function makeTool(
  name: string,
  client: A2AClient,
  skill: Pick<AgentSkill, 'id' | 'name' | 'description' | 'examples'>,
  contextFor: (agentId: string | undefined) => string,
) {
  const description = [
    skill.description,
    ...(skill.examples?.length ? [`Examples: ${skill.examples.join(' | ')}`] : []),
  ].filter(Boolean).join('\n');

  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The task or instruction to send to the remote agent.',
        },
      },
      required: ['prompt'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: String(value) },
      ],
    },
    async execute(args: { prompt: string }, exec: { signal?: AbortSignal; agent?: { id?: string } }): Promise<string> {
      // Reuse one contextId per calling local agent so multi-turn tool use is a
      // continuous conversation with the remote agent (cross-call memory).
      const message: Message = {
        messageId: crypto.randomUUID(),
        role: Role.USER,
        contextId: contextFor(exec.agent?.id),
        parts: [{ text: args.prompt }],
      };
      try {
        const task = await client.sendAndWait(message, {}, { signal: exec.signal });
        const text = partsToText(task.artifacts?.flatMap((a) => a.parts));
        const failureMsg =
          task.status.message?.parts?.find((p) => 'text' in p && p.text);
        if (task.status.state === 'TASK_STATE_FAILED') {
          throw new A2AError(
            -32000,
            `Remote agent task failed: ${text || (failureMsg && 'text' in failureMsg ? failureMsg.text : 'no detail')}`,
          );
        }
        // INPUT_REQUIRED / AUTH_REQUIRED: surface the remote's clarification
        // request as a *usable* tool output, so the model can answer and call
        // the tool again — not as a hard error that stalls the conversation.
        if (task.status.state === 'TASK_STATE_INPUT_REQUIRED' || task.status.state === 'TASK_STATE_AUTH_REQUIRED') {
          const ask =
            (failureMsg && 'text' in failureMsg ? failureMsg.text : '') ||
            text ||
            'agent awaits input';
          return `[remote agent ${task.status.state}] ${ask}`;
        }
        return text || '(remote agent returned no output)';
      } catch (err) {
        if (err instanceof A2AError && err.code === -32001 && err.message.includes('interrupted')) {
          throw new Error(`Remote agent requires input: ${err.message}`);
        }
        throw err;
      }
    },
  };
}