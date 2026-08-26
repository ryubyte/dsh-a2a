/**
 * dsh-a2a — browser half.
 *
 * Contributes the "A2A 连接" settings section: a dashboard showing who is
 * connected TO this DSH (inbound peers) and who this DSH is connected TO
 * (outbound agents), with reconnect / close controls per connection.
 *
 * The data and the controls live behind the host's `/a2a/api` routes
 * (served by the node half on the same webserver); the browser half is a
 * thin read/write client with no protocol knowledge.
 *
 * Styling: a single idempotent stylesheet (dashboard.css.ts) built entirely
 * on the product's `--dsw-alias-*` design tokens, so light/dark themes and
 * narrow-window layouts follow the DSH shell. No inline styles.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { createElement, useEffect, useState, type ReactElement } from 'react';
import { injectDashboardStyles } from './dashboard.css.js';

/** Services this plugin needs from the client runtime. */
export const inject = ['slots'];

export function apply(ctx: ClientContext): void {
  // Inject the dashboard stylesheet once; removed when the plugin unloads.
  ctx.effect(() => {
    const dispose = injectDashboardStyles();
    return () => dispose();
  }, 'dsh-a2a: dashboard styles');

  ctx.effect(() => {
    try {
      const off = ctx.slots.register(
        {
          name: 'settings.section',
          id: 'a2a',
          order: 90,
          label: () => 'A2A 连接',
          inject: () => ({}),
        },
        DashboardSection,
      );
      return () => off();
    } catch (err) {
      console.error('[dsh-a2a] failed to register settings section:', err);
      return () => {};
    }
  }, 'dsh-a2a: settings section');
}

// ── wire types (mirror the host dashboard.ts) ──────────────────────────────

interface InboundPeerApi {
  id: string;
  label: string;
  source?: string;
  firstSeen: string;
  lastSeen: string;
  taskCount: number;
  activeTaskIds: string[];
  streaming: boolean;
}

interface OutboundAgentApi {
  id: string;
  name: string;
  agentCardUrl: string;
  agentName?: string;
  skillCount: number;
  toolCount: number;
  state: 'connected' | 'disconnected' | 'reconnecting';
  /** Last-activity ISO timestamp. */
  lastSeen: string;
  /** Stable connection id the control actions operate on. */
  connectionId?: string;
  /** True when this connection comes from the profile config. */
  configured?: boolean;
  /** False when this agent is configured but disabled (no live connection). */
  enabled?: boolean;
  /** Skills advertised by the remote AgentCard. */
  skills?: Array<{ id: string; name: string; description?: string; tags?: string[] }>;
}

interface SnapshotApi {
  inbound: InboundPeerApi[];
  outbound: OutboundAgentApi[];
  at: number;
}

interface ControlResultApi {
  ok: boolean;
  message: string;
}

async function fetchSnapshot(): Promise<SnapshotApi> {
  const res = await fetch('/a2a/api', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /a2a/api → HTTP ${res.status}`);
  return (await res.json()) as SnapshotApi;
}

async function postControl(action: string, target: string, payload?: Record<string, unknown>): Promise<ControlResultApi> {
  const res = await fetch('/a2a/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, target, ...payload }),
  });
  const body = (await res.json()) as ControlResultApi;
  return body;
}

type SectionProps = PropsRuntime<'settings.section'>;

interface ServeStatus {
  enabled: boolean;
  baseUrl?: string;
  agentName?: string;
  agentDescription?: string;
  agentVersion?: string;
  endpoint?: string;
  /** Raw JSON-RPC path (for the edit form; `endpoint` is the full URL). */
  endpointPath?: string;
  agentCardUrl?: string;
  skills?: Array<{ id: string; name: string; description?: string; tags?: string[] }>;
  /** Legacy: true when a custom executor was injected (kept for old snapshots). */
  customExecutor?: boolean;
  /** How inbound tasks are executed. */
  executor?: 'custom' | 'dsh-agent' | 'none';
  /** Whether the inbound endpoint is token-gated (never the token value). */
  authConfigured?: boolean;
}

interface DiscoveredCard {
  name: string;
  description?: string;
  version?: string;
  agentCardUrl: string;
  endpoint?: string;
  skills?: Array<{ id: string; name: string; description?: string }>;
  capabilities?: Record<string, unknown>;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

/** One editable skill row in the serve-identity form (tags as a raw CSV). */
interface SkillDraft {
  id: string;
  name: string;
  description: string;
  tags: string;
}

/** Serve-identity edit form draft (server tab). */
interface ServeDraft {
  agentName: string;
  agentDescription: string;
  agentVersion: string;
  baseUrl: string;
  endpointPath: string;
  skills: SkillDraft[];
}

/** Per-agent advanced-settings form draft (client tab). */
interface AgentDraft {
  /** Raw string so the field can be empty; parsed to a number on save. */
  timeoutMs: string;
  mapSkills: boolean;
  /** Empty means "leave unchanged". */
  bearerToken: string;
}

/**
 * Sensible starter values for the first-time guided setup, so a new user edits
 * a ready-to-go config instead of filling every field from scratch — they can
 * accept it as-is and click "创建并上线", or tweak what they want. baseUrl /
 * endpointPath stay blank (auto-inferred). The seed skill is a placeholder the
 * user renames or removes.
 */
function guidedServeDraft(): ServeDraft {
  return {
    agentName: 'DSH Agent',
    agentDescription: '基于 DeepSeek Harness 的 A2A Agent',
    agentVersion: '0.1.0',
    baseUrl: '',
    endpointPath: '',
    skills: [{ id: 'coding', name: 'Coding', description: '在 DSH 工作区中执行编码与命令行任务', tags: 'coding, shell' }],
  };
}

/** Build a serve draft from the live serve status (prefill the edit form). */
function serveDraftFrom(serve: ServeStatus): ServeDraft {
  return {
    agentName: serve.agentName ?? '',
    agentDescription: serve.agentDescription ?? '',
    agentVersion: serve.agentVersion ?? '',
    baseUrl: serve.baseUrl ?? '',
    endpointPath: serve.endpointPath ?? '',
    skills: (serve.skills ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      tags: (s.tags ?? []).join(', '),
    })),
  };
}

/** The A2A connection dashboard settings section. */
export function DashboardSection(_props: SectionProps): ReactElement {
  // ── state (all hooks at the top, fixed order; helper components below
  // never call hooks — otherwise React #310 crashes the whole slot) ──────
  const [snap, setSnap] = useState<SnapshotApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serve, setServe] = useState<ServeStatus | null>(null);
  const [addUrl, setAddUrl] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredCard | null>(null);
  // Two tabs, one per role this DSH plays: `client` (it connects out to remote
  // agents) and `server` (it serves inbound A2A callers). The server tab folds
  // together the serve-config panel and the live inbound-connection list.
  const [tab, setTab] = useState<'client' | 'server'>('client');
  /** connection ids whose skill list is expanded in the outbound tab. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Optional bearer token for the add-agent form (outbound). */
  const [addToken, setAddToken] = useState('');
  /** Inbound authToken input (serve tab); empty string means "clear". */
  const [authInput, setAuthInput] = useState('');
  /** Serve-identity edit mode + form draft (server tab). All hooks stay at the
   * top level in fixed order; a single shared draft avoids per-card hooks. */
  const [editingServe, setEditingServe] = useState(false);
  // Seed with guided starter values so the first-time setup form is pre-filled
  // and editable, not blank. Editing an existing server overwrites this draft
  // via startEditServe → serveDraftFrom(serve).
  const [serveDraft, setServeDraft] = useState<ServeDraft>(guidedServeDraft());
  /** connectionId of the outbound agent whose advanced-settings form is open
   * (null = none). One shared draft keeps agentCard() a pure, hookless fn. */
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentDraft>({ timeoutMs: '', mapSkills: true, bearerToken: '' });

  const refresh = async (): Promise<void> => {
    try {
      setError(null);
      setSnap(await fetchSnapshot());
      const sres = await fetch('/a2a/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'server-status' }),
      });
      const sbody = (await sres.json()) as ControlResultApi;
      if (sbody.ok && sbody.message) setServe(JSON.parse(sbody.message) as ServeStatus);
      else setServe(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // initial load + 3s polling (live view)
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, []);

  const act = async (action: string, target: string, payload?: Record<string, unknown>): Promise<void> => {
    setBusy(`${action}:${target}`);
    setNotice(null);
    try {
      const result = await postControl(action, target, payload);
      setNotice(`${result.ok ? '✓' : '✗'} ${result.message}`);
    } catch (err) {
      setNotice(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const inbound = snap?.inbound ?? [];
  const outbound = snap?.outbound ?? [];

  const doDiscover = async (): Promise<void> => {
    const u = addUrl.trim();
    if (!u) return;
    setDiscovering(true);
    setDiscovered(null);
    setNotice(null);
    try {
      const res = await fetch('/a2a/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'discover-agent', agentCardUrl: u, bearerToken: addToken.trim() || undefined }),
      });
      const body = (await res.json()) as ControlResultApi;
      if (!body.ok || !body.message) {
        setNotice(`✗ ${body.message}`);
        return;
      }
      setDiscovered(JSON.parse(body.message) as DiscoveredCard);
    } catch (err) {
      setNotice(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDiscovering(false);
    }
  };

  const doConnect = async (): Promise<void> => {
    if (!discovered) return;
    const n = discovered.name.trim() || 'remote';
    await act('add-agent', n, { agentCardUrl: discovered.agentCardUrl, bearerToken: addToken.trim() || undefined });
    if (!busy) {
      setAddUrl('');
      setAddToken('');
      setDiscovered(null);
    }
  };

  // Open the serve-identity editor, prefilled from the current status.
  const startEditServe = (): void => {
    if (serve) setServeDraft(serveDraftFrom(serve));
    setEditingServe(true);
  };

  // Serialize the serve draft → set-server-identity. Skills with a blank id or
  // name are dropped; tags split on comma. `also` optionally chains a follow-up
  // action (used by guided init to enable the server right after creating it).
  const saveServeIdentity = async (also?: 'enable'): Promise<void> => {
    const skills = serveDraft.skills
      .map((s) => ({
        id: s.id.trim(),
        name: s.name.trim(),
        description: s.description.trim(),
        tags: s.tags.split(',').map((t) => t.trim()).filter(Boolean),
      }))
      .filter((s) => s.id && s.name);
    await act('set-server-identity', '', {
      agentName: serveDraft.agentName.trim(),
      agentDescription: serveDraft.agentDescription.trim(),
      agentVersion: serveDraft.agentVersion.trim(),
      // Always send baseUrl (even ''): empty means "clear pin → auto-infer from
      // the real listen address", which the host can only honor if it sees the
      // empty string rather than a dropped field.
      baseUrl: serveDraft.baseUrl.trim(),
      endpointPath: serveDraft.endpointPath.trim() || undefined,
      skills,
    });
    if (also === 'enable') await act('server-enable', '');
    setEditingServe(false);
  };

  // Open the per-agent advanced editor, prefilled from the agent's card values.
  const startEditAgent = (a: OutboundAgentApi): void => {
    const target = a.connectionId ?? a.id;
    setAgentDraft({ timeoutMs: '', mapSkills: true, bearerToken: '' });
    setEditingAgent(target);
  };

  const saveAgentAdvanced = async (target: string): Promise<void> => {
    const t = agentDraft.timeoutMs.trim();
    await act('update-agent', target, {
      timeoutMs: t ? Number(t) : undefined,
      mapSkills: agentDraft.mapSkills,
      bearerToken: agentDraft.bearerToken.trim() || undefined,
    });
    setEditingAgent(null);
  };

  return createElement(
    // `.a2a-root` is the inline-size query container; the responsive
    // `@container` rules in dashboard.css react to this element's width (the
    // settings drawer), not the browser viewport. Keep it as the outermost
    // node so the whole section is measured.
    'div',
    { className: 'a2a-root' },
    createElement(
    'div',
    { className: 'a2a-section' },
    // ── intro ─────────────────────────────────────────────
    createElement(
      'p',
      { className: 'a2a-intro' },
      '管理本 DSH 的 A2A 连接：在「连接的 Agent」里连接并调用远程 Agent，在「对外服务」里把本 DSH 作为 Agent 发布、并查看谁在调用它。',
    ),
    error
      ? createElement('div', { className: 'a2a-notice a2a-error' }, `加载失败：${error}`)
      : null,
    notice ? createElement('div', { className: 'a2a-notice' }, notice) : null,
    // ── tabs (underline style, same as the 插件 settings page) ─────────
    tabRail([
      tabBtn('连接的 Agent', outbound.length, tab === 'client', () => setTab('client')),
      tabBtn('对外服务', inbound.length, tab === 'server', () => setTab('server')),
    ]),
    // ── client tab (outbound: agents this DSH connects out to) ──────────
    tab === 'client'
      ? createElement(
          'div',
          { className: 'a2a-stack' },
          // Connected agents (cards)
          createElement(
            'div',
            { className: 'a2a-crew' },
            sec('已连接 Agent', outbound.length),
            outbound.length === 0
              ? emptyRow('暂无已连接的 Agent。使用下方"添加 Agent"通过 Agent Card URL 连接远程 A2A Agent。')
              : createElement(
                  'div',
                  { className: 'a2a-card-list' },
                  ...outbound.map((a) =>
                    agentCard(a, busy, act, expanded, setExpanded, {
                      editingAgent,
                      agentDraft,
                      setAgentDraft,
                      startEditAgent,
                      saveAgentAdvanced: (t: string) => void saveAgentAdvanced(t),
                      cancelEditAgent: () => setEditingAgent(null),
                    }),
                  ),
                ),
          ),
          // Add agent (discover → connect)
          createElement(
            'div',
            { className: 'a2a-panel' },
            createElement('div', { className: 'a2a-panel-title' }, '添加 Agent'),
            createElement(
              'div',
              { className: 'a2a-field-row' },
              createElement('input', {
                className: 'a2a-input',
                placeholder: 'Agent Card URL（https://…/.well-known/agent-card.json）',
                value: addUrl,
                onChange: (e: { target: { value: string } }) => {
                  setAddUrl(e.target.value);
                  setDiscovered(null);
                },
              }),
              actionBtn('导入', false, () => void doDiscover(), discovering || !addUrl.trim()),
            ),
            createElement(
              'div',
              { className: 'a2a-field-row' },
              createElement('input', {
                className: 'a2a-input',
                type: 'password',
                placeholder: 'Bearer Token(可选,发送为 Authorization: Bearer …)',
                value: addToken,
                onChange: (e: { target: { value: string } }) => setAddToken(e.target.value),
              }),
            ),
            createElement(
              'div',
              { className: 'a2a-hint' },
              '若远程 Agent 需要鉴权,填入 token;导入与后续调用都会带上。token 会明文存入 a2a.json。',
            ),
            discovering
              ? createElement('div', { className: 'a2a-hint' }, '正在读取 Agent Card…')
              : discovered
                ? createElement(
                    'div',
                    { className: 'a2a-preview' },
                    createElement(
                      'div',
                      { className: 'a2a-preview-head' },
                      createElement('span', { className: 'a2a-preview-name' }, discovered.name),
                      discovered.version
                        ? createElement('span', { className: 'a2a-preview-version a2a-mono' }, `v${discovered.version}`)
                        : null,
                      stateDot('connected'),
                    ),
                    discovered.description
                      ? createElement('div', { className: 'a2a-preview-desc' }, discovered.description)
                      : null,
                    (discovered.skills?.length ?? 0) > 0
                      ? createElement(
                          'div',
                          { className: 'a2a-skill-list' },
                          createElement('div', { className: 'a2a-skill-list-title' }, 'Skills'),
                          ...(discovered.skills ?? []).map((s) =>
                            createElement('div', { key: s.id }, `• ${s.name}${s.description ? ` — ${s.description}` : ''}`),
                          ),
                        )
                      : null,
                    discovered.endpoint
                      ? createElement('div', { className: 'a2a-preview-meta a2a-mono' }, `端点 ${discovered.endpoint}`)
                      : null,
                    createElement(
                      'div',
                      { className: 'a2a-btn-row' },
                      actionBtn('连接', true, () => void doConnect(), busy?.startsWith('add-agent:') ?? false),
                      actionBtn('取消', false, () => { setDiscovered(null); setAddUrl(''); }, false),
                    ),
                  )
                : createElement(
                    'div',
                    { className: 'a2a-hint' },
                    '输入远程 Agent 的 Agent Card URL 并点击"导入"，将自动读取其名称、描述、技能与能力，确认后建立连接。',
                  ),
          ),
        )
      : null,
    // ── server tab (this DSH as an A2A agent: serve config + inbound) ──────
    tab === 'server'
      ? createElement(
          'div',
          { className: 'a2a-stack' },
          // (1) serve configuration panel — read-only view, edit form, or (for
          //     a never-configured server) a guided setup card.
          serve
            ? editingServe
              ? serveEditPanel(serveDraft, setServeDraft, (also) => void saveServeIdentity(also), () => setEditingServe(false), busy, false)
              : needsServeSetup(serve)
                ? serveEditPanel(serveDraft, setServeDraft, (also) => void saveServeIdentity(also), () => setEditingServe(false), busy, true)
                : serveViewPanel(serve, busy, act, authInput, setAuthInput, startEditServe)
            : null,
          // (2) inbound connections — who is calling this DSH's A2A endpoint
          createElement(
            'div',
            { className: 'a2a-crew' },
            sec('入站连接（谁在连接本 DSH）', inbound.length),
            inbound.length === 0
              ? emptyRow('暂无入站连接。其他 A2A 客户端调用本 DSH 的 JSON-RPC 端点后会显示在这里。')
              : createElement(
                  'div',
                  { className: 'a2a-table-wrap' },
                  createElement(
                    'table',
                    { className: 'a2a-table' },
                    createElement('thead', null, headRow(['来源', '地址', '首次连接', '最近活动', '任务', '流', '操作'])),
                    createElement('tbody', null, ...inbound.map((p) => inboundRow(p, busy, act))),
                  ),
                ),
          ),
        )
      : null,
    createElement(
      'div',
      { className: 'a2a-footer' },
      `快照时间 ${snap ? new Date(snap.at).toLocaleTimeString() : '—'} · 每 3 秒自动刷新`,
    ),
    ),
  );
}

/** Editing wiring passed from the section into the (pure) agent card. */
interface AgentEditProps {
  editingAgent: string | null;
  agentDraft: AgentDraft;
  setAgentDraft: (d: AgentDraft) => void;
  startEditAgent: (a: OutboundAgentApi) => void;
  saveAgentAdvanced: (target: string) => void;
  cancelEditAgent: () => void;
}

// ── connected agent card (pure: hooks live in the parent section) ────────
function agentCard(
  a: OutboundAgentApi,
  busy: string | null,
  act: (a: string, t: string, p?: Record<string, unknown>) => Promise<void>,
  expanded: Set<string>,
  setExpanded: (s: Set<string>) => void,
  edit: AgentEditProps,
): ReactElement {
  const target = a.connectionId ?? a.id;
  const open = expanded.has(target);
  const skills = a.skills ?? [];
  const editingThis = edit.editingAgent === target;
  const toggle = (): void => {
    const next = new Set(expanded);
    if (next.has(target)) next.delete(target);
    else next.add(target);
    setExpanded(next);
  };
  return createElement(
    'div',
    { key: a.id, className: a.enabled === false ? 'a2a-card a2a-card-disabled' : 'a2a-card' },
    // header row — click toggles skill list
    createElement(
      'div',
      { className: 'a2a-card-header', onClick: toggle },
      createElement(
        'span',
        { className: 'a2a-card-chevron', 'data-open': String(open) },
        '▶',
      ),
      stateDot(a.enabled === false ? 'disabled' : a.state),
      createElement('span', { className: 'a2a-card-title' }, a.agentName ?? a.name),
      a.enabled === false
        ? badge('disabled', '已禁用')
        : badge(a.configured ? 'config' : 'runtime', a.configured ? '配置' : '运行时'),
      createElement('span', { className: 'a2a-card-sub' }, `${a.skillCount} 技能 · ${a.toolCount} 工具 · ${new Date(a.lastSeen).toLocaleTimeString()}`),
      // ── three operations: reconnect/enable · disable · delete (never wrap) ──
      createElement(
        'div',
        { className: 'a2a-card-ops' },
        a.enabled === false
          ? actionBtn('启用', true, () => void act('enable-agent', target), busy === `enable-agent:${target}`)
          : actionBtn('重连', true, () => void act('reconnect-agent', target), busy === `reconnect-agent:${target}`),
        // Advanced settings only for saved (configured) agents.
        a.configured
          ? actionBtn('设置', false, () => (editingThis ? edit.cancelEditAgent() : edit.startEditAgent(a)), false)
          : null,
        actionBtn('禁用', false, () => void act('disable-agent', target), busy === `disable-agent:${target}`),
        actionBtn('删除', false, () => void act('remove-agent', target), busy === `remove-agent:${target}`),
      ),
    ),
    createElement(
      'div',
      { className: 'a2a-meta-row' },
      createElement('span', { className: 'a2a-card-url a2a-mono' }, a.agentCardUrl),
      createElement(CopyButton, { text: a.agentCardUrl, label: 'Agent Card URL' }),
    ),
    // expandable skills
    open && skills.length > 0
      ? createElement(
          'div',
          { className: 'a2a-skills' },
          ...skills.map((s) =>
            createElement(
              'div',
              { key: s.id, className: 'a2a-skill-row' },
              createElement(
                'div',
                { className: 'a2a-skill-name' },
                s.name,
                s.tags?.length
                  ? createElement('span', { className: 'a2a-skill-tags' }, s.tags.join(', '))
                  : null,
              ),
              s.description
                ? createElement('div', { className: 'a2a-skill-desc' }, s.description)
                : null,
            ),
          ),
        )
      : open
        ? createElement('div', { className: 'a2a-skill-none' }, '（该 Agent 未声明技能）')
        : null,
    // advanced settings form (toggled by the 设置 button; independent of skills)
    editingThis ? agentAdvancedForm(target, edit, busy) : null,
  );
}

/**
 * Per-agent advanced-settings form: timeoutMs / mapSkills / bearerToken. Saving
 * persists to a2a.json and reconnects the agent to apply. Pure — draft lives in
 * the parent section.
 */
function agentAdvancedForm(target: string, edit: AgentEditProps, busy: string | null): ReactElement {
  const d = edit.agentDraft;
  const saving = busy === `update-agent:${target}`;
  return createElement(
    'div',
    { className: 'a2a-adv' },
    createElement('div', { className: 'a2a-form-label' }, '高级设置'),
    createElement(
      'div',
      { className: 'a2a-form-row' },
      createElement('label', { className: 'a2a-form-label' }, '超时 (ms)'),
      createElement('input', {
        className: 'a2a-input',
        type: 'number',
        placeholder: '留空用默认',
        value: d.timeoutMs,
        onChange: (e: { target: { value: string } }) => edit.setAgentDraft({ ...d, timeoutMs: e.target.value }),
      }),
    ),
    createElement(
      'label',
      { className: 'a2a-check-row' },
      createElement('input', {
        type: 'checkbox',
        checked: d.mapSkills,
        onChange: (e: { target: { checked: boolean } }) => edit.setAgentDraft({ ...d, mapSkills: e.target.checked }),
      }),
      createElement('span', null, '按技能拆分为多个工具（关闭则合并为单个工具）'),
    ),
    createElement(
      'div',
      { className: 'a2a-form-row' },
      createElement('label', { className: 'a2a-form-label' }, 'Token'),
      createElement('input', {
        className: 'a2a-input',
        type: 'password',
        placeholder: '留空不修改',
        value: d.bearerToken,
        onChange: (e: { target: { value: string } }) => edit.setAgentDraft({ ...d, bearerToken: e.target.value }),
      }),
    ),
    createElement(
      'div',
      { className: 'a2a-hint' },
      '保存后会以新配置重连该 Agent，使超时/工具拆分/Token 生效。',
    ),
    createElement(
      'div',
      { className: 'a2a-btn-row' },
      actionBtn('保存并重连', true, () => edit.saveAgentAdvanced(target), saving),
      actionBtn('取消', false, edit.cancelEditAgent, false),
    ),
  );
}

function badge(kind: 'config' | 'runtime' | 'disabled', label: string): ReactElement {
  return createElement('span', { className: `a2a-badge a2a-badge-${kind}` }, label);
}

/** A tab button matching the settings "插件" page's underline tab style. */
function tabBtn(label: string, count: number, active: boolean, onClick: () => void): ReactElement {
  return createElement(
    'button',
    {
      onClick,
      'aria-selected': active,
      role: 'tab',
      'data-active': String(active),
      className: 'a2a-tab',
    },
    label,
    count > 0 ? createElement('span', { className: 'a2a-tab-count' }, String(count)) : null,
  );
}

/** The tab strip container (underline rail, like first-party settings pages). */
function tabRail(children: Array<ReactElement | null>): ReactElement {
  return createElement('div', { role: 'tablist', className: 'a2a-tabs' }, ...children);
}

function sec(title: string, count: number): ReactElement {
  return createElement(
    'h3',
    { className: 'a2a-h3' },
    title,
    createElement('span', { className: 'a2a-count' }, String(count)),
  );
}

function emptyRow(text: string): ReactElement {
  return createElement('div', { className: 'a2a-empty' }, text);
}

function headRow(cols: string[]): ReactElement {
  return createElement('tr', null, ...cols.map((c) => createElement('th', null, c)));
}

function stateDot(state: string): ReactElement {
  return createElement('span', { className: 'a2a-dot', 'data-state': state });
}

function actionBtn(label: string, primary: boolean, onClick: () => void, disabled: boolean): ReactElement {
  return createElement(
    'button',
    {
      onClick,
      disabled,
      className: primary ? 'a2a-btn a2a-btn-primary' : 'a2a-btn',
    },
    label,
  );
}

/**
 * One-click copy button with transient "已复制 ✓" feedback. Uses the async
 * Clipboard API when available (secure contexts), falls back to execCommand
 * otherwise. The copied state lives in this component so the section's hook
 * order stays untouched.
 */
function CopyButton(props: { text: string; label?: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      return;
    } catch {
      // Clipboard API unavailable (non-secure context) — fall through.
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = props.text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
    } catch {
      // Give up silently; the button is cosmetic.
    }
  };
  return createElement(
    'button',
    {
      type: 'button',
      className: 'a2a-copy-btn',
      onClick: () => void onCopy(),
      'data-copied': String(copied),
      'aria-label': `${copied ? '已复制' : '复制'}${props.label ? ` ${props.label}` : ''}`,
    },
    copied ? '已复制 ✓' : '复制',
  );
}

/**
 * A semantically-correct note about how inbound tasks are executed. Dispatches
 * on the `executor` field; falls back to the legacy `customExecutor` boolean
 * for snapshots from an older host that didn't send `executor`.
 */
function executorNote(serve: {
  executor?: 'custom' | 'dsh-agent' | 'none';
  customExecutor?: boolean;
}): ReactElement | null {
  const kind = serve.executor ?? (serve.customExecutor ? 'custom' : undefined);
  if (kind === 'custom') return null; // operator wired their own executor
  if (kind === 'dsh-agent') {
    return createElement(
      'div',
      { className: 'a2a-note' },
      'ℹ 入站任务由本 DSH 的 agent 会话执行,按 A2A contextId 一个对话一个会话。',
    );
  }
  if (kind === 'none') {
    return createElement(
      'div',
      { className: 'a2a-note a2a-note-warn' },
      '⚠ 未配置 executor,且未检测到可用的 agent 循环:入站任务会被拒绝。通过配置注入 execute,或加载 agent-loop 插件。',
    );
  }
  return null;
}

/**
 * True when the server has never been given an identity — no agentName (or the
 * bare default) and no skills. Drives the guided-setup card for fresh installs.
 */
function needsServeSetup(serve: ServeStatus): boolean {
  const name = (serve.agentName ?? '').trim();
  const unnamed = name === '' || name === 'DSH Agent';
  const noSkills = (serve.skills?.length ?? 0) === 0;
  return unnamed && noSkills;
}

/**
 * Read-only serve panel: status + identity + endpoints + executor/auth, with an
 * "编辑" button that flips the section into {@link serveEditPanel}. Pure (no
 * hooks): the edit-mode flag and draft live in the parent section.
 */
function serveViewPanel(
  serve: ServeStatus,
  busy: string | null,
  act: (a: string, t: string, p?: Record<string, unknown>) => Promise<void>,
  authInput: string,
  setAuthInput: (v: string) => void,
  onEdit: () => void,
): ReactElement {
  return createElement(
    'div',
    { className: 'a2a-panel' },
    createElement(
      'div',
      { className: 'a2a-serve-head' },
      sec('A2A 服务（本 DSH 作为 Agent 对外）', 0),
      stateDot(serve.enabled ? 'connected' : 'disconnected'),
      createElement(
        'span',
        { className: 'a2a-serve-status', 'data-on': String(serve.enabled) },
        serve.enabled ? '运行中' : '已下线',
      ),
      createElement(
        'span',
        { className: 'a2a-serve-ops' },
        actionBtn('编辑', false, onEdit, false),
        serve.enabled
          ? actionBtn('下线', false, () => void act('server-disable', ''), busy === 'server-disable:')
          : actionBtn('上线', true, () => void act('server-enable', ''), busy === 'server-enable:'),
      ),
    ),
    createElement(
      'div',
      { className: 'a2a-serve-meta' },
      serve.agentName
        ? createElement(
            'div',
            { className: 'a2a-serve-name' },
            serve.agentName,
            serve.agentVersion ? createElement('span', { className: 'a2a-serve-version a2a-mono' }, `v${serve.agentVersion}`) : null,
          )
        : null,
      serve.agentDescription
        ? createElement('div', { className: 'a2a-serve-desc' }, serve.agentDescription)
        : null,
      serve.endpoint
        ? createElement(
            'div',
            { className: 'a2a-meta-row' },
            createElement('span', { className: 'a2a-meta-key' }, '端点'),
            createElement('span', { className: 'a2a-serve-endpoint a2a-mono' }, serve.endpoint),
            createElement(CopyButton, { text: serve.endpoint, label: '端点' }),
          )
        : null,
      serve.agentCardUrl
        ? createElement(
            'div',
            { className: 'a2a-meta-row' },
            createElement('span', { className: 'a2a-meta-key' }, 'Agent Card'),
            createElement('span', { className: 'a2a-serve-endpoint a2a-mono' }, serve.agentCardUrl),
            createElement(CopyButton, { text: serve.agentCardUrl, label: 'Agent Card URL' }),
          )
        : null,
      (serve.skills?.length ?? 0) > 0
        ? createElement(
            'div',
            { className: 'a2a-skill-list' },
            createElement('div', { className: 'a2a-skill-list-title' }, 'Skills'),
            ...(serve.skills ?? []).map((s) =>
              createElement('div', { key: s.id }, `• ${s.name}${s.description ? ` — ${s.description}` : ''}`),
            ),
          )
        : null,
    ),
    serve.enabled ? executorNote(serve) : null,
    serve.enabled ? authControl(serve, busy, act, authInput, setAuthInput) : null,
  );
}

/**
 * Serve-identity edit form (also the guided-setup card for fresh installs).
 * Pure: the draft + setter live in the parent section. `guided` switches the
 * copy and the primary action (create-and-serve vs save).
 */
function serveEditPanel(
  draft: ServeDraft,
  setDraft: (d: ServeDraft) => void,
  onSave: (also?: 'enable') => void,
  onCancel: () => void,
  busy: string | null,
  guided: boolean,
): ReactElement {
  const set = (patch: Partial<ServeDraft>): void => setDraft({ ...draft, ...patch });
  const setSkill = (i: number, patch: Partial<SkillDraft>): void =>
    setDraft({ ...draft, skills: draft.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addSkill = (): void => setDraft({ ...draft, skills: [...draft.skills, { id: '', name: '', description: '', tags: '' }] });
  const delSkill = (i: number): void => setDraft({ ...draft, skills: draft.skills.filter((_, j) => j !== i) });
  const saving = busy === 'set-server-identity:' || busy === 'server-enable:';
  const field = (label: string, key: keyof Omit<ServeDraft, 'skills'>, placeholder: string): ReactElement =>
    createElement(
      'div',
      { className: 'a2a-form-row' },
      createElement('label', { className: 'a2a-form-label' }, label),
      createElement('input', {
        className: 'a2a-input',
        placeholder,
        value: draft[key],
        onChange: (e: { target: { value: string } }) => set({ [key]: e.target.value } as Partial<ServeDraft>),
      }),
    );
  return createElement(
    'div',
    { className: 'a2a-panel' },
    createElement(
      'div',
      { className: 'a2a-panel-title' },
      guided ? '配置对外服务（首次设置）' : '编辑对外服务',
    ),
    guided
      ? createElement(
          'div',
          { className: 'a2a-note' },
          'ℹ 填写下面的信息即可把本 DSH 作为 A2A Agent 发布，保存后自动上线。所有配置写入 a2a.json，无需手改文件。',
        )
      : null,
    field('名称', 'agentName', '如 My DSH Agent'),
    field('描述', 'agentDescription', '一句话说明这个 Agent 能做什么'),
    field('版本', 'agentVersion', '如 0.1.0'),
    field('Base URL', 'baseUrl', '留空自动推断（对外可达地址）'),
    createElement(
      'div',
      { className: 'a2a-hint' },
      '留空则按服务实际监听地址自动推断；仅在有反向代理或公网域名时才需要手动填写。',
    ),
    field('端点路径', 'endpointPath', '留空默认 /a2a'),
    // ── skills editor ──
    createElement(
      'div',
      { className: 'a2a-skill-edit-head' },
      createElement('span', { className: 'a2a-form-label' }, `技能（${draft.skills.length}）`),
      actionBtn('+ 添加技能', false, addSkill, false),
    ),
    draft.skills.length === 0
      ? createElement('div', { className: 'a2a-hint' }, '至少添加一个技能，远程调用方才知道本 Agent 能做什么。')
      : createElement(
          'div',
          { className: 'a2a-skill-edit-list' },
          ...draft.skills.map((s, i) => skillEditRow(s, i, setSkill, delSkill)),
        ),
    createElement(
      'div',
      { className: 'a2a-btn-row' },
      guided
        ? actionBtn('创建并上线', true, () => onSave('enable'), saving)
        : actionBtn('保存', true, () => onSave(), saving),
      actionBtn('取消', false, onCancel, false),
    ),
  );
}

/** One editable skill row (id/name/description + tags) with a delete button. */
function skillEditRow(
  s: SkillDraft,
  i: number,
  setSkill: (i: number, patch: Partial<SkillDraft>) => void,
  delSkill: (i: number) => void,
): ReactElement {
  const inp = (key: keyof SkillDraft, placeholder: string): ReactElement =>
    createElement('input', {
      className: 'a2a-input',
      placeholder,
      value: s[key],
      onChange: (e: { target: { value: string } }) => setSkill(i, { [key]: e.target.value } as Partial<SkillDraft>),
    });
  return createElement(
    'div',
    { key: String(i), className: 'a2a-skill-edit-row' },
    createElement(
      'div',
      { className: 'a2a-skill-edit-grid' },
      inp('id', 'id（唯一标识，如 coding）'),
      inp('name', '名称（如 Coding）'),
    ),
    inp('description', '描述'),
    createElement(
      'div',
      { className: 'a2a-skill-edit-foot' },
      createElement('input', {
        className: 'a2a-input',
        placeholder: '标签（逗号分隔，可选）',
        value: s.tags,
        onChange: (e: { target: { value: string } }) => setSkill(i, { tags: e.target.value }),
      }),
      actionBtn('删除', false, () => delSkill(i), false),
    ),
  );
}

/**
 * Inbound bearer-token control for the serve tab: shows whether the endpoint is
 * token-gated, and lets the operator set or clear the shared token. The token
 * value is never read back from the host — only whether one is configured.
 */
function authControl(
  serve: { authConfigured?: boolean },
  busy: string | null,
  act: (a: string, t: string, p?: Record<string, unknown>) => Promise<void>,
  authInput: string,
  setAuthInput: (v: string) => void,
): ReactElement {
  return createElement(
    'div',
    { className: 'a2a-auth' },
    createElement(
      'div',
      { className: 'a2a-auth-row' },
      createElement('span', { className: 'a2a-auth-label' }, '入站鉴权'),
      stateDot(serve.authConfigured ? 'connected' : 'disabled'),
      createElement(
        'span',
        { className: 'a2a-auth-state', 'data-on': String(serve.authConfigured) },
        serve.authConfigured ? '已启用 Bearer 鉴权' : '未鉴权(任何客户端可调用)',
      ),
    ),
    createElement(
      'div',
      { className: 'a2a-auth-input-row' },
      createElement('input', {
        className: 'a2a-input',
        type: 'password',
        placeholder: serve.authConfigured ? '输入新 token 以替换' : '设置 Bearer Token 以开启鉴权',
        value: authInput,
        onChange: (e: { target: { value: string } }) => setAuthInput(e.target.value),
      }),
      actionBtn('保存', true, () => { void act('set-server-auth', '', { authToken: authInput.trim() }); setAuthInput(''); }, busy === 'set-server-auth:' || !authInput.trim()),
      serve.authConfigured
        ? actionBtn('清除', false, () => { void act('set-server-auth', '', { authToken: '' }); setAuthInput(''); }, busy === 'set-server-auth:')
        : null,
    ),
    createElement(
      'div',
      { className: 'a2a-hint' },
      'token 会明文存入 a2a.json,重启后仍生效。设置后,入站 JSON-RPC 请求需带 Authorization: Bearer <token>。',
    ),
  );
}

function inboundRow(p: InboundPeerApi, busy: string | null, act: (a: string, t: string) => void): ReactElement {
  return createElement(
    'tr',
    { key: p.id },
    createElement('td', { 'data-label': '来源' }, p.label),
    createElement('td', { className: 'a2a-cell-mono', 'data-label': '地址' }, p.source ?? '—'),
    createElement('td', { 'data-label': '首次连接' }, new Date(p.firstSeen).toLocaleTimeString()),
    createElement('td', { 'data-label': '最近活动' }, new Date(p.lastSeen).toLocaleTimeString()),
    createElement('td', { 'data-label': '任务' }, String(p.taskCount)),
    createElement('td', { 'data-label': '流' }, p.streaming ? '● 流' : '—'),
    createElement(
      'td',
      { 'data-label': '操作' },
      actionBtn('关闭', false, () => void act('close-peer', p.id), busy === `close-peer:${p.id}`),
    ),
  );
}