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
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { createElement, useEffect, useState, type ReactElement } from 'react';

/** Services this plugin needs from the client runtime. */
export const inject = ['slots'];

export function apply(ctx: ClientContext): void {
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
  const [tab, setTab] = useState<'out' | 'in' | 'serve'>('out');
  /** connection ids whose skill list is expanded in the outbound tab. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  interface ServeStatus {
    enabled: boolean;
    baseUrl?: string;
    agentName?: string;
    agentDescription?: string;
    agentVersion?: string;
    endpoint?: string;
    agentCardUrl?: string;
    skills?: Array<{ id: string; name: string; description?: string }>;
    customExecutor?: boolean;
  }

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
      body: JSON.stringify({ action: 'discover-agent', agentCardUrl: u }),
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
  await act('add-agent', n, { agentCardUrl: discovered.agentCardUrl });
  if (!busy) {
    setAddUrl('');
    setDiscovered(null);
  }
};

const inputStyle = { padding: '4px 8px', fontSize: 13, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))', background: 'var(--dsw-alias-fill-l1, rgba(127,127,127,.06))', color: 'var(--dsw-alias-label-primary, #222)' };

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
    // ── intro ─────────────────────────────────────────────
    createElement(
      'div',
      { style: { color: 'var(--dsw-alias-label-secondary, #666)', fontSize: 13, lineHeight: 1.6 } },
      '管理本 DSH 的 A2A Agent 连接：连接远程 Agent（出站），查看谁在调用本 DSH 的 A2A 服务（入站）。',
    ),
    error
      ? createElement(
          'div',
          { style: { color: 'var(--dsw-danger, #c62828)', fontSize: 13, background: 'var(--dsw-alias-fill-l2, rgba(127,127,127,.08))', borderRadius: 8, padding: '8px 12px' } },
          `加载失败：${error}`,
        )
      : null,
    notice
      ? createElement(
          'div',
          { style: { color: 'var(--dsw-alias-label-primary, #222)', fontSize: 13, background: 'var(--dsw-alias-fill-l2, rgba(127,127,127,.08))', borderRadius: 8, padding: '8px 12px' } },
          notice,
        )
      : null,
    // ── tabs (underline style, same as the 插件 settings page) ─────────
    tabRail([
      tabBtn('出站 Agent', outbound.length, tab === 'out', () => setTab('out')),
      tabBtn('入站连接', inbound.length, tab === 'in', () => setTab('in')),
      serve ? tabBtn('A2A 服务', 0, tab === 'serve', () => setTab('serve')) : null,
    ]),
    // ── outbound tab ──────────────────────────────────────
    tab === 'out'
      ? createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          // Connected agents (cards)
          createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            sec('已连接 Agent', outbound.length),
            outbound.length === 0
              ? emptyRow('暂无已连接的 Agent。使用下方"添加 Agent"通过 Agent Card URL 连接远程 A2A Agent。')
              : createElement(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  ...outbound.map((a) => agentCard(a, busy, act, expanded, setExpanded)),
                ),
          ),
          // Add agent (discover → connect)
          createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--dsw-alias-fill-l2, rgba(127,127,127,.05))', borderRadius: 10, padding: '14px 16px' } },
            createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #222)' } }, '添加 Agent'),
            createElement(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              createElement('input', {
                placeholder: 'Agent Card URL（https://…/.well-known/agent-card.json）',
                value: addUrl,
                onChange: (e: { target: { value: string } }) => {
                  setAddUrl(e.target.value);
                  setDiscovered(null);
                },
                style: { ...inputStyle, flex: 1, minWidth: 260 },
              }),
              actionBtn('导入', false, () => void doDiscover(), discovering || !addUrl.trim()),
            ),
            discovering
              ? createElement('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary, #999)' } }, '正在读取 Agent Card…')
              : discovered
                ? createElement(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--dsw-alias-fill-l1, rgba(127,127,127,.06))', borderRadius: 8, padding: '12px 14px' } },
                    createElement(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                      createElement('span', { style: { fontSize: 15, fontWeight: 700, color: 'var(--dsw-alias-label-primary, #222)' } }, discovered.name),
                      discovered.version
                        ? createElement('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary, #999)', fontFamily: 'monospace' } }, `v${discovered.version}`)
                        : null,
                      stateDot('connected'),
                    ),
                    discovered.description
                      ? createElement('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary, #666)' } }, discovered.description)
                      : null,
                    (discovered.skills?.length ?? 0) > 0
                      ? createElement(
                          'div',
                          { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                          createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #666)' } }, 'Skills'),
                          ...(discovered.skills ?? []).map((s) =>
                            createElement('div', { key: s.id, style: { fontSize: 12.5, color: 'var(--dsw-alias-label-primary, #222)' } }, `• ${s.name}${s.description ? ` — ${s.description}` : ''}`),
                          ),
                        )
                      : null,
                    discovered.endpoint
                      ? createElement('div', { style: { fontSize: 11.5, fontFamily: 'monospace', color: 'var(--dsw-alias-label-tertiary, #999)' } }, `端点 ${discovered.endpoint}`)
                      : null,
                    createElement(
                      'div',
                      { style: { display: 'flex', gap: 8, marginTop: 2 } },
                      actionBtn('连接', true, () => void doConnect(), busy === 'add-agent'),
                      actionBtn('取消', false, () => { setDiscovered(null); setAddUrl(''); }, false),
                    ),
                  )
                : createElement(
                    'div',
                    { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)' } },
                    '输入远程 Agent 的 Agent Card URL 并点击"导入"，将自动读取其名称、描述、技能与能力，确认后建立连接。',
                  ),
          ),
        )
      : null,
    // ── serve tab ─────────────────────────────────────────
    tab === 'serve' && serve
      ? createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--dsw-alias-fill-l2, rgba(127,127,127,.05))', borderRadius: 10, padding: '14px 16px' } },
          createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            sec('A2A 服务（本 DSH 作为 Agent 对外）', 0),
            stateDot(serve.enabled ? 'connected' : 'disconnected'),
            createElement(
              'span',
              { style: { fontSize: 12.5, color: serve.enabled ? '#2e7d32' : '#9e9e9e' } },
              serve.enabled ? '运行中' : '已下线',
            ),
            createElement(
              'span',
              { style: { marginLeft: 'auto' } },
              serve.enabled
                ? actionBtn('下线', false, () => void act('server-disable', ''), busy === 'server-disable')
                : actionBtn('上线', true, () => void act('server-enable', ''), busy === 'server-enable'),
            ),
          ),
          createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            serve.agentName
              ? createElement(
                  'div',
                  { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #222)' } },
                  serve.agentName,
                  serve.agentVersion ? createElement('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary, #999)', fontFamily: 'monospace', marginLeft: 8 } }, `v${serve.agentVersion}`) : null,
                )
              : null,
            serve.agentDescription
              ? createElement('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary, #666)' } }, serve.agentDescription)
              : null,
            serve.endpoint
              ? createElement('div', { style: { fontSize: 12, fontFamily: 'monospace', color: 'var(--dsw-alias-label-tertiary, #999)' } }, `端点 ${serve.endpoint}`)
              : null,
            serve.agentCardUrl
              ? createElement('div', { style: { fontSize: 12, fontFamily: 'monospace', color: 'var(--dsw-alias-label-tertiary, #999)' } }, `Agent Card ${serve.agentCardUrl}`)
              : null,
            (serve.skills?.length ?? 0) > 0
              ? createElement(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                  createElement('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #666)' } }, 'Skills'),
                  ...(serve.skills ?? []).map((s) =>
                    createElement('div', { key: s.id, style: { fontSize: 12.5, color: 'var(--dsw-alias-label-primary, #222)' } }, `• ${s.name}${s.description ? ` — ${s.description}` : ''}`),
                  ),
                )
              : null,
          ),
          serve.enabled && !serve.customExecutor
            ? createElement(
                'div',
                { style: { fontSize: 12, color: 'var(--dsw-warning, #b26a00)', background: 'rgba(178,106,0,.08)', borderRadius: 6, padding: '6px 10px' } },
                '⚠ 默认 executor 会执行 shell 命令。生产环境请通过配置指定受限的 execute 实现。',
              )
            : null,
        )
      : null,
    // ── inbound tab ────────────────────────────────────────
    tab === 'in'
      ? createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          sec('入站连接（谁在连接本 DSH）', inbound.length),
          inbound.length === 0
            ? emptyRow('暂无入站连接。其他 A2A 客户端调用本 DSH 的 JSON-RPC 端点后会显示在这里。')
            : createElement('table', tblStyle, createElement('thead', null, headRow(['来源', '地址', '首次连接', '最近活动', '任务', '流', '操作'])), createElement('tbody', null, ...inbound.map((p) => inboundRow(p, busy, act)))),
        )
      : null,
    createElement(
      'div',
      { style: { color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: 12 } },
      `快照时间 ${snap ? new Date(snap.at).toLocaleTimeString() : '—'} · 每 3 秒自动刷新`,
    ),
  );
}

// ── connected agent card (pure: hooks live in the parent section) ────────
function agentCard(
  a: OutboundAgentApi,
  busy: string | null,
  act: (a: string, t: string, p?: Record<string, unknown>) => Promise<void>,
  expanded: Set<string>,
  setExpanded: (s: Set<string>) => void,
): ReactElement {
  const target = a.connectionId ?? a.id;
  const open = expanded.has(target);
  const skills = a.skills ?? [];
  const toggle = (): void => {
    const next = new Set(expanded);
    if (next.has(target)) next.delete(target);
    else next.add(target);
    setExpanded(next);
  };
  return createElement(
    'div',
    { key: a.id, style: { display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--dsw-alias-fill-l1, rgba(127,127,127,.05))', borderRadius: 10, padding: '12px 14px', opacity: a.enabled === false ? 0.72 : 1 } },
    // header row — click toggles skill list
    createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' as const, flexWrap: 'wrap' as const }, onClick: toggle },
      createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #999)', width: 14, display: 'inline-block', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' } }, '▶'),
      stateDot(a.enabled === false ? 'disabled' : a.state),
      createElement('span', { style: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #222)' } }, a.agentName ?? a.name),
      a.enabled === false
        ? createElement('span', { style: { fontSize: 11.5, ...sourceBadge('#b26a00', 'rgba(178,106,0,.1)', '已禁用') } }, '已禁用')
        : createElement(
            'span',
            { style: { fontSize: 11.5, ...(a.configured ? sourceBadge('#666', 'rgba(127,127,127,.12)', '配置') : sourceBadge('#4a7dff', 'rgba(74,125,255,.1)', '运行时')) } },
            a.configured ? '配置' : '运行时',
          ),
      createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } }, `${a.skillCount} 技能 · ${a.toolCount} 工具 · ${new Date(a.lastSeen).toLocaleTimeString()}`),
      // ── three operations: reconnect/enable · disable · delete (never wrap) ──
      createElement(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 'auto', paddingLeft: 10 } },
        a.enabled === false
          ? actionBtn('启用', true, () => void act('enable-agent', target), busy === `enable-agent:${target}`)
          : actionBtn('重连', true, () => void act('reconnect-agent', target), busy === `reconnect-agent:${target}`),
        actionBtn('禁用', false, () => void act('disable-agent', target), busy === `disable-agent:${target}`),
        actionBtn('删除', false, () => void act('remove-agent', target), busy === `remove-agent:${target}`),
      ),
    ),
    createElement(
      'div',
      { style: { fontSize: 12, fontFamily: 'monospace', color: 'var(--dsw-alias-label-tertiary, #999)', wordBreak: 'break-all' } },
      a.agentCardUrl,
    ),
    // expandable skills
    open && skills.length > 0
      ? createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--dsw-alias-fill-l2, rgba(0,0,0,.04))', borderRadius: 8, padding: '10px 12px', marginTop: 2 } },
          ...skills.map((s) =>
            createElement(
              'div',
              { key: s.id, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              createElement(
                'div',
                { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
                createElement('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #222)', fontFamily: 'monospace' } }, s.name),
                s.tags?.length
                  ? createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #999)' } }, s.tags.join(', '))
                  : null,
              ),
              s.description
                ? createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #666)' } }, s.description)
                : null,
            ),
          ),
        )
      : open
        ? createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)' } }, '（该 Agent 未声明技能）')
        : null,
  );
}

function sourceBadge(color: string, bg: string, _label: string): Record<string, string | number> {
  return { color, background: bg, borderRadius: 4, padding: '1px 6px' };
}

/** A tab button matching the settings "插件" page's underline tab style. */
function tabBtn(label: string, count: number, active: boolean, onClick: () => void): ReactElement {
  return createElement(
    'button',
    {
      onClick,
      'aria-selected': active,
      role: 'tab',
      'data-active': active,
      style: {
        padding: '7px 1px 9px',
        fontSize: 13,
        lineHeight: '20px',
        fontWeight: 400,
        color: active ? 'var(--dsw-alias-label-primary, #0f1115)' : 'var(--dsw-alias-label-tertiary, #81858c)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        // underline via box-shadow inset (React inline styles can't do ::after)
        boxShadow: active ? 'inset 0 -2px 0 var(--dsw-alias-label-primary, #0f1115)' : 'none',
        borderRadius: '2px 2px 0 0',
        transition: 'color .15s, box-shadow .15s',
      },
    },
    label,
    count > 0 ? createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)', marginLeft: 6 } }, String(count)) : null,
  );
}

/** The tab strip container replicating `.pbvGtq_tabs` (border-bottom rail). */
function tabRail(children: Array<ReactElement | null>): ReactElement {
  return createElement(
    'div',
    { role: 'tablist', style: { display: 'flex', alignItems: 'flex-end', gap: 22, borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))', marginTop: 2 } },
    ...children,
  );
}

function sec(title: string, count: number): ReactElement {
  return createElement(
    'h3',
    { style: { margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #222)', display: 'flex', alignItems: 'center', gap: 8 } },
    title,
    createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)', background: 'var(--dsw-alias-fill-l2, rgba(127,127,127,.1))', borderRadius: 10, padding: '1px 8px' } }, String(count)),
  );
}

function emptyRow(text: string): ReactElement {
  return createElement(
    'div',
    { style: { color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: 13, background: 'var(--dsw-alias-fill-l2, rgba(127,127,127,.06))', borderRadius: 8, padding: '12px 14px' } },
    text,
  );
}

const tblStyle = { borderCollapse: 'collapse' as const, width: '100%', fontSize: 13 };
const thStyle = { textAlign: 'left' as const, padding: '6px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18))', color: 'var(--dsw-alias-label-secondary, #666)', fontWeight: 600, whiteSpace: 'nowrap' as const };
const tdStyle = { padding: '6px 8px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.1))', color: 'var(--dsw-alias-label-primary, #222)', verticalAlign: 'top' as const, fontSize: 12.5 };

function headRow(cols: string[]): ReactElement {
  return createElement('tr', null, ...cols.map((c) => createElement('th', { style: thStyle }, c)));
}

const stateColor: Record<string, string> = {
  connected: '#2e7d32',
  disconnected: '#9e9e9e',
  reconnecting: '#f57c00',
  disabled: '#b26a00',
};

function stateDot(state: string): ReactElement {
  return createElement('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6, background: stateColor[state] ?? '#9e9e9e' } });
}

function actionBtn(label: string, primary: boolean, onClick: () => void, disabled: boolean): ReactElement {
  return createElement(
    'button',
    {
      onClick,
      disabled,
      style: {
        marginRight: 6,
        padding: '3px 10px',
        fontSize: 12,
        lineHeight: '18px',
        borderRadius: 6,
        border: `1px solid ${primary ? 'var(--dsw-brand, #4a7dff)' : 'var(--dsw-alias-border-l2, rgba(127,127,127,.3))'}`,
        background: primary ? 'var(--dsw-brand, #4a7dff)' : 'transparent',
        color: primary ? '#fff' : 'var(--dsw-alias-label-primary, #222)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      },
    },
    label,
  );
}

function inboundRow(p: InboundPeerApi, busy: string | null, act: (a: string, t: string) => void): ReactElement {
  return createElement(
    'tr',
    { key: p.id },
    createElement('td', { style: tdStyle }, p.label),
    createElement('td', { style: { ...tdStyle, fontFamily: 'monospace', fontSize: 12 } }, p.source ?? '—'),
    createElement('td', { style: tdStyle }, new Date(p.firstSeen).toLocaleTimeString()),
    createElement('td', { style: tdStyle }, new Date(p.lastSeen).toLocaleTimeString()),
    createElement('td', { style: tdStyle }, String(p.taskCount)),
    createElement('td', { style: tdStyle }, p.streaming ? '● 流' : '—'),
    createElement(
      'td',
      { style: tdStyle },
      actionBtn('关闭', false, () => void act('close-peer', p.id), busy === `close-peer:${p.id}`),
    ),
  );
}
