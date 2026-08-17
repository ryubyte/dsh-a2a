/**
 * dsh-a2a — outbound half: bridge remote A2A agent skills into DSH's tool
 * registry (`ctx.tools`).
 *
 * Each skill on a remote AgentCard becomes a model-facing tool named
 * `a2a__<agentName>__<skillId>` (normalized to the DSH function-name
 * contract: `[A-Za-z0-9_-]`, ≤64 chars; on collision a deterministic hash is
 * appended, mirroring dsh-mcp-client's naming rule).
 */
import { Role } from './protocol.js';
import { A2AClient } from './client.js';
import { A2AError } from './errors.js';
function normalizeToolName(raw) {
    const norm = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
    if (norm.length > 0 && /^[A-Za-z0-9_-]+$/.test(norm))
        return norm;
    // fallback: deterministic hash
    let h = 0;
    for (let i = 0; i < raw.length; i++)
        h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    return `_${h.toString(16)}`;
}
function skillToToolName(agentName, skill) {
    const raw = `a2a__${agentName}__${skill.id}`;
    const base = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
    if (base === raw || base.length < 64)
        return base;
    let h = 0;
    for (let i = 0; i < raw.length; i++)
        h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    return `${base.slice(0, 56)}_${h.toString(16)}`;
}
/** Extract the first meaningful text from message parts. */
function partsToText(parts) {
    if (!parts)
        return '';
    return parts
        .map((p) => {
        if ('text' in p && p.text)
            return p.text;
        if ('url' in p && p.url)
            return p.url;
        if ('data' in p && p.data !== undefined)
            return JSON.stringify(p.data);
        if ('raw' in p && p.raw)
            return `[raw ${p.mediaType ?? 'application/octet-stream'}]`;
        return '';
    })
        .filter(Boolean)
        .join('\n');
}
/**
 * Register all skills of a remote agent on `ctx.tools` and return disposers.
 */
export async function registerAgentTools(tools, options) {
    const connectionId = crypto.randomUUID();
    const client = await A2AClient.connect(options.agentCardUrl, {
        bearerToken: options.bearerToken,
        timeoutMs: options.timeoutMs,
    });
    const card = client.card;
    const skills = card.skills ?? [];
    options.onReady?.({ connectionId, card });
    let disposers = [];
    if (options.mapSkills === false || skills.length === 0) {
        // Fall back to a single generic tool for the whole agent.
        const name = normalizeToolName(`a2a__${options.name}__agent`);
        const dispose = tools.register?.(makeTool(name, client, {
            id: 'agent',
            name: options.name,
            description: `${card.name}: ${card.description} (no skills advertised)`,
        }));
        if (dispose)
            disposers = [{ name, dispose }];
    }
    else {
        const out = [];
        for (const skill of skills) {
            const name = skillToToolName(options.name, skill);
            const dispose = tools.register?.(makeTool(name, client, skill));
            if (dispose)
                out.push({ name, dispose });
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
function makeTool(name, client, skill) {
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
            render: (_args, value) => [
                { type: 'text', text: String(value) },
            ],
        },
        async execute(args, exec) {
            const message = {
                messageId: crypto.randomUUID(),
                role: Role.USER,
                parts: [{ text: args.prompt }],
            };
            try {
                const task = await client.sendAndWait(message, {}, { signal: exec.signal });
                const text = partsToText(task.artifacts?.flatMap((a) => a.parts));
                const failureMsg = task.status.message?.parts?.find((p) => 'text' in p && p.text);
                if (task.status.state === 'TASK_STATE_FAILED') {
                    throw new A2AError(-32000, `Remote agent task failed: ${text || (failureMsg && 'text' in failureMsg ? failureMsg.text : 'no detail')}`);
                }
                return text || '(remote agent returned no output)';
            }
            catch (err) {
                if (err instanceof A2AError && err.code === -32001 && err.message.includes('interrupted')) {
                    throw new Error(`Remote agent requires input: ${err.message}`);
                }
                throw err;
            }
        },
    };
}
