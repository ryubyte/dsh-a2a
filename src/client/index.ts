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

async function postControl(action: string, target: string): Promise<ControlResultApi> {
  const res = await fetch('/a2a/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, target }),
  });
  const body = (await res.json()) as ControlResultApi;
  return body;
}

type SectionProps = PropsRuntime<'settings.section'>;

/** The A2A connection dashboard settings section. */
export function DashboardSection(props: SectionProps): ReactElement {
  const [snap, setSnap] = useState<SnapshotApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      setError(null);
      setSnap(await fetchSnapshot());
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

  const act = async (action: string, target: string): Promise<void> => {
    setBusy(`${action}:${target}`);
    setNotice(null);
    try {
      const result = await postControl(action, target);
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

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
    createElement(
      'div',
      { style: { color: 'var(--dsw-alias-label-secondary, #666)', fontSize: 13, lineHeight: 1.6 } },
      '查看 A2A 连接的实时状态：谁在连接本 DSH（入站），以及本 DSH 连接了哪些远程 Agent（出站）。可对每条连接执行重连或关闭。',
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
    sec('入站连接（谁在连接本 DSH）', inbound.length),
    inbound.length === 0
      ? emptyRow('暂无入站连接。其他 A2A 客户端调用本 DSH 的 JSON-RPC 端点后会显示在这里。')
      : createElement('table', tblStyle, createElement('thead', null, headRow(['来源', '地址', '首次连接', '最近活动', '任务', '流', '操作'])), createElement('tbody', null, ...inbound.map((p) => inboundRow(p, busy, act)))),
    sec('出站连接（本 DSH 连接了谁）', outbound.length),
    outbound.length === 0
      ? emptyRow('暂无出站连接。在 profile 中配置 mode: client 的 dsh-a2a 实例后会显示在这里。')
      : createElement('table', tblStyle, createElement('thead', null, headRow(['Agent', '状态', '地址', '技能', '工具', '最近活动', '操作'])), createElement('tbody', null, ...outbound.map((a) => outboundRow(a, busy, act)))),
    createElement(
      'div',
      { style: { color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: 12 } },
      `快照时间 ${snap ? new Date(snap.at).toLocaleTimeString() : '—'} · 每 3 秒自动刷新`,
    ),
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

function outboundRow(a: OutboundAgentApi, busy: string | null, act: (a: string, t: string) => void): ReactElement {
  const target = a.connectionId ?? a.id;
  return createElement(
    'tr',
    { key: a.id },
    createElement('td', { style: tdStyle }, a.agentName ?? a.name),
    createElement('td', { style: tdStyle }, stateDot(a.state), a.state),
    createElement('td', { style: { ...tdStyle, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' } }, a.agentCardUrl),
    createElement('td', { style: tdStyle }, String(a.skillCount)),
    createElement('td', { style: tdStyle }, String(a.toolCount)),
    createElement('td', { style: tdStyle }, new Date(a.lastSeen).toLocaleTimeString()),
    createElement(
      'td',
      { style: tdStyle },
      actionBtn('重连', true, () => void act('reconnect-agent', target), busy === `reconnect-agent:${target}`),
      actionBtn('关闭', false, () => void act('close-agent', target), busy === `close-agent:${target}`),
    ),
  );
}