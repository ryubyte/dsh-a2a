/**
 * dsh-a2a — dashboard stylesheet.
 *
 * The browser half is a compiled bundle (not a dynamic cordis plugin), so it
 * injects its own stylesheet the same way first-party DSH client UI packages
 * do: a single idempotent <style> tag, styled entirely with the product's
 * `--dsw-alias-*` design tokens (so light/dark themes and future token
 * changes apply automatically), plus `@media` queries for narrow windows.
 *
 * Class names are prefixed with `a2a-` to avoid collisions with product or
 * third-party styles.
 */

export const DASHBOARD_CSS_ID = '@ryubyte/dsh-a2a/dashboard.css';

const css = String.raw`
/* ── layout ─────────────────────────────────────────────── */
/*
 * The settings drawer is a fixed-ish narrow column (~560px), unrelated to the
 * browser viewport, so responsive rules key off the container width, not the
 * viewport. .a2a-root is our own wrapper (the host's immediate parent is
 * display:contents and can't be a query container), scoped as an inline-size
 * container so the @container rules below react to the real panel width.
 */
.a2a-root { container-type: inline-size; container-name: a2a; }
.a2a-section { display: flex; flex-direction: column; gap: 20px; transition: gap .2s ease; }
.a2a-stack { display: flex; flex-direction: column; gap: 16px; }
.a2a-crew { display: flex; flex-direction: column; gap: 10px; }
.a2a-card-list { display: flex; flex-direction: column; gap: 8px; }
.a2a-btn-row { display: flex; gap: 8px; margin-top: 2px; }
.a2a-intro { color: var(--dsw-alias-label-secondary, #61666b); font-size: 13px; line-height: 1.6; margin: 0; }
.a2a-h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); display: flex; align-items: center; gap: 8px; }
.a2a-count { font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-tertiary, #81858c); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); border-radius: 10px; padding: 1px 8px; }
.a2a-empty { color: var(--dsw-alias-label-tertiary, #81858c); font-size: 13px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06)); border-radius: 8px; padding: 12px 14px; }
.a2a-hint { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #81858c); line-height: 1.6; }
.a2a-mono { font-family: var(--ds-font-family-code, "SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"); }

/* status / error / notice */
.a2a-notice { padding: 8px 12px; border-radius: 8px; font-size: 13px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-error { color: var(--dsw-alias-state-error-primary, #d92d20); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 9%, transparent); }

/* state dot */
.a2a-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #81858c); flex: none; }
.a2a-dot[data-state='connected'] { background: var(--dsw-alias-state-success-primary, #12b76a); }
.a2a-dot[data-state='reconnecting'] { background: var(--dsw-alias-state-warn-primary, #f79009); }
.a2a-dot[data-state='disabled']   { background: var(--dsw-alias-state-warn-primary, #f79009); }

/* ---- buttons ---- */
.a2a-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  margin-right: 6px; padding: 4px 12px; font-size: 12px; line-height: 18px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: transparent; color: var(--dsw-alias-label-primary, #0f1115);
  cursor: pointer; transition: background .15s, border-color .15s, color .15s, opacity .15s;
}
.a2a-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08)); border-color: var(--dsw-alias-border-l3, rgba(127,127,127,.45)); }
.a2a-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4a7dff); outline-offset: 1px; }
.a2a-btn:disabled { opacity: .5; cursor: default; }
.a2a-btn:last-child { margin-right: 0; }
.a2a-btn-primary { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4a7dff)); border-color: transparent; color: #fff; }
.a2a-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #4a7dff)); border-color: transparent; }

/* ---- copy button ---- */
.a2a-copy-btn {
  flex: none; margin-left: 8px; padding: 2px 8px; font-size: 11px; line-height: 16px;
  border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: transparent; color: var(--dsw-alias-label-tertiary, #81858c);
  cursor: pointer; white-space: nowrap;
  transition: color .15s, border-color .15s, background .15s;
}
.a2a-copy-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary, #0f1115); border-color: var(--dsw-alias-border-l3, rgba(127,127,127,.45)); background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08)); }
.a2a-copy-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4a7dff); outline-offset: 1px; }
.a2a-copy-btn[data-copied='true'] { color: var(--dsw-alias-state-success-primary, #12b76a); border-color: var(--dsw-alias-state-success-primary, #12b76a); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #12b76a) 10%, transparent); }

/* ---- meta rows (label + value + copy) ---- */
.a2a-meta-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.a2a-meta-key { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }
.a2a-meta-row .a2a-mono { flex: 1; min-width: 0; word-break: break-all; }
.a2a-meta-row .a2a-copy-btn { margin-left: auto; flex: none; }

/* ---- tabs (underline, matching first-party settings pages) ---- */
.a2a-tabs { display: flex; align-items: flex-end; gap: 22px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); margin-top: 2px; transition: gap .2s ease; }
.a2a-tab {
  position: relative; padding: 7px 1px 9px; font-size: 13px; line-height: 20px; font-weight: 400;
  color: var(--dsw-alias-label-tertiary, #81858c); background: transparent; border: none;
  cursor: pointer; transition: color .15s;
}
.a2a-tab:hover { color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-tab:focus-visible { outline: none; color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-tab[data-active='true'] { color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-tab[data-active='true']::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; border-radius: 1px; background: var(--dsw-alias-label-primary, #0f1115); }
.a2a-tab-count { margin-left: 6px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }

/* ---- inputs ---- */
.a2a-field-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.a2a-field-row .a2a-input { flex: 1; min-width: 260px; }
.a2a-input {
  padding: 5px 10px; font-size: 13px; line-height: 20px; border-radius: 8px; min-width: 0;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06)); color: var(--dsw-alias-label-primary, #0f1115);
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.a2a-input::placeholder { color: var(--dsw-alias-label-tertiary, #81858c); }
.a2a-input:hover { border-color: var(--dsw-alias-border-l3, rgba(127,127,127,.45)); }
.a2a-input:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary, #4a7dff); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #4a7dff) 20%, transparent); }

/* ---- edit forms (serve identity + per-agent advanced) ---- */
.a2a-form-row { display: flex; align-items: center; gap: 10px; }
.a2a-form-row .a2a-input { flex: 1; min-width: 0; }
.a2a-form-label { flex: none; font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-secondary, #61666b); min-width: 76px; }
.a2a-check-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dsw-alias-label-primary, #0f1115); cursor: pointer; }
.a2a-check-row input { flex: none; }
.a2a-adv { display: flex; flex-direction: column; gap: 10px; margin-top: 2px; padding: 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12)); }

/* skills editor */
.a2a-skill-edit-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px; }
.a2a-skill-edit-list { display: flex; flex-direction: column; gap: 10px; }
.a2a-skill-edit-row { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12)); }
.a2a-skill-edit-grid { display: flex; gap: 6px; }
.a2a-skill-edit-grid .a2a-input { flex: 1; min-width: 0; }
.a2a-skill-edit-foot { display: flex; align-items: center; gap: 6px; }
.a2a-skill-edit-foot .a2a-input { flex: 1; min-width: 0; }

/* ---- panels & cards ---- */
.a2a-panel {
  display: flex; flex-direction: column; gap: 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.05));
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12));
  border-radius: 12px; padding: 14px 16px;
}
.a2a-panel-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }

.a2a-card {
  display: flex; flex-direction: column; gap: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.05));
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12));
  border-radius: 12px; padding: 12px 14px;
  transition: border-color .15s, background .15s;
}
.a2a-card:hover { border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.3)); }
.a2a-card-disabled { opacity: .72; }
.a2a-card-header { display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; flex-wrap: wrap; transition: gap .2s ease; }
.a2a-card-chevron { font-size: 11px; color: var(--dsw-alias-label-tertiary, #81858c); width: 14px; display: inline-block; transition: transform .15s; flex: none; }
.a2a-card-chevron[data-open='true'] { transform: rotate(90deg); }
.a2a-card-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-card-sub { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.a2a-card-url { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); word-break: break-all; }
.a2a-card-ops { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: auto; padding-left: 10px; transition: padding-left .2s ease, margin-left .2s ease; }

.a2a-skills { display: flex; flex-direction: column; gap: 6px; background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.04)); border-radius: 8px; padding: 10px 12px; margin-top: 2px; }
.a2a-skill-row { display: flex; flex-direction: column; gap: 2px; }
.a2a-skill-name { display: flex; align-items: baseline; gap: 6px; font-size: 12.5px; font-weight: 600; font-family: var(--ds-font-family-code, "SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"); color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-skill-tags { font-size: 11px; color: var(--dsw-alias-label-tertiary, #81858c); }
.a2a-skill-desc { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }
.a2a-skill-none { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }

/* ---- badges ---- */
.a2a-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11.5px; line-height: 16px; }
.a2a-badge-config { color: var(--dsw-alias-label-secondary, #61666b); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); }
.a2a-badge-runtime { color: var(--dsw-alias-brand-primary, #4a7dff); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4a7dff) 10%, transparent); }
.a2a-badge-disabled { color: var(--dsw-alias-state-warn-primary, #b26a00); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b26a00) 10%, transparent); }

/* ---- add-agent preview ---- */
.a2a-preview { display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12)); border-radius: 8px; padding: 12px 14px; }
.a2a-preview-head { display: flex; align-items: center; gap: 8px; }
.a2a-preview-name { font-size: 15px; font-weight: 700; color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-preview-version { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #81858c); }
.a2a-preview-desc { font-size: 12.5px; color: var(--dsw-alias-label-secondary, #61666b); }
.a2a-preview-meta { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #81858c); }

/* ---- serve tab ---- */
.a2a-serve-head { display: flex; align-items: center; gap: 8px; }
.a2a-serve-status { font-size: 12.5px; }
.a2a-serve-status[data-on='true'] { color: var(--dsw-alias-state-success-primary, #12b76a); }
.a2a-serve-status[data-on='false'] { color: var(--dsw-alias-label-tertiary, #81858c); }
.a2a-serve-ops { margin-left: auto; }
.a2a-serve-meta { display: flex; flex-direction: column; gap: 6px; }
.a2a-serve-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-serve-version { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #81858c); margin-left: 8px; }
.a2a-serve-desc { font-size: 12.5px; color: var(--dsw-alias-label-secondary, #61666b); }
.a2a-serve-endpoint { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
.a2a-skill-list { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-skill-list-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #61666b); }

.a2a-note { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4a7dff) 8%, transparent); border-radius: 6px; padding: 6px 10px; }
.a2a-note-warn { color: var(--dsw-alias-state-warn-primary, #b26a00); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b26a00) 8%, transparent); }

.a2a-auth-row { display: flex; align-items: center; gap: 8px; }
.a2a-auth { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.a2a-auth-label { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }
.a2a-auth-state { font-size: 12px; }
.a2a-auth-state[data-on='true'] { color: var(--dsw-alias-state-success-primary, #12b76a); }
.a2a-auth-state[data-on='false'] { color: var(--dsw-alias-label-tertiary, #81858c); }
.a2a-auth-input-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.a2a-auth-input-row .a2a-input { flex: 1; min-width: 220px; }

/* ---- inbound table ---- */
.a2a-table-wrap { overflow-x: auto; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12)); border-radius: 10px; }
.a2a-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.a2a-table th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18)); color: var(--dsw-alias-label-secondary, #61666b); font-weight: 600; white-space: nowrap; }
.a2a-table td { padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.1)); color: var(--dsw-alias-label-primary, #0f1115); vertical-align: top; font-size: 12.5px; }
.a2a-table tr:last-child td { border-bottom: none; }
.a2a-table tbody tr:hover td { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.06)); }
.a2a-cell-mono { font-family: var(--ds-font-family-code, "SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"); font-size: 12px; }

/* ---- footer ---- */
.a2a-footer { color: var(--dsw-alias-label-tertiary, #81858c); font-size: 12px; }

/* ── responsive: keyed off the panel's own width via @container ──────────
 * The settings drawer width is independent of the viewport, so these use
 * container queries against .a2a-root (container-name: a2a). Transitions on
 * the affected properties keep the reflow smooth as the panel is resized.
 */
/* The settings drawer sits around ~560px, so this (max-width:760px) band is
 * effectively the *default* layout here — keep it to genuinely helpful reflow
 * (tighter gaps, card header/ops that would otherwise overflow). Rules that
 * force inputs/values onto their own line belong in the much-narrower band
 * below, or they needlessly break "input + button" / "value + copy" onto two
 * lines at a width that comfortably fits them on one. */
@container a2a (max-width: 760px) {
  .a2a-section { gap: 16px; }
  /* Header stacks: title row on top, meta + ops flow below, left-aligned —
     avoids the "orphan buttons pinned to the far right" look when wrapping. */
  .a2a-card-header { flex-wrap: wrap; }
  .a2a-card-sub { white-space: normal; }
  .a2a-card-ops { margin-left: 0; width: 100%; justify-content: flex-start; padding-left: 0; }
  .a2a-serve-ops { margin-left: auto; }
}
/* Only when the panel is genuinely narrow (< 440px) do inputs/values take a
 * full line — at the normal ~560px width they stay inline with their button. */
@container a2a (max-width: 440px) {
  .a2a-field-row .a2a-input { min-width: 100%; }
  .a2a-auth-input-row .a2a-input { min-width: 100%; }
  .a2a-meta-row { flex-wrap: wrap; }
  .a2a-meta-row .a2a-mono { flex-basis: 100%; }
  .a2a-meta-row .a2a-copy-btn { margin-left: auto; }
  .a2a-form-row { flex-wrap: wrap; gap: 4px; }
  .a2a-form-row .a2a-input { min-width: 100%; }
  .a2a-skill-edit-grid { flex-direction: column; }
}
/* inbound table → stacked cards below 640px (instead of horizontal squeeze) */
@container a2a (max-width: 640px) {
  .a2a-table-wrap { border: none; border-radius: 0; background: transparent; overflow-x: visible; }
  .a2a-table, .a2a-table thead, .a2a-table tbody, .a2a-table tr, .a2a-table td { display: block; width: auto; }
  .a2a-table thead { display: none; }
  .a2a-table tbody { display: flex; flex-direction: column; gap: 8px; }
  .a2a-table tr { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12)); border-radius: 10px; padding: 8px 12px; margin-bottom: 0; }
  .a2a-table tr:hover td { background: transparent; }
  .a2a-table td { border: none; padding: 3px 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12.5px; }
  .a2a-table td::before { content: attr(data-label); flex: none; color: var(--dsw-alias-label-secondary, #61666b); font-weight: 600; font-size: 12px; }
  .a2a-table td:last-child { justify-content: flex-end; }
}
@container a2a (max-width: 560px) {
  .a2a-tabs { gap: 14px; }
  .a2a-card-header { gap: 8px; }
}

/* Graceful fallback: if @container isn't supported, key off the viewport so
   the narrow layout still appears in a genuinely small window. */
@supports not (container-type: inline-size) {
  @media (max-width: 760px) {
    .a2a-section { gap: 16px; }
    .a2a-card-header { flex-wrap: wrap; }
    .a2a-card-ops { margin-left: 0; width: 100%; justify-content: flex-start; padding-left: 0; }
    .a2a-meta-row { flex-wrap: wrap; }
    .a2a-meta-row .a2a-mono { flex-basis: 100%; }
  }
}
`;

let injected = false;

/**
 * Idempotently inject the dashboard stylesheet into <head>. Returns a
 * disposer that removes the tag; safe to call repeatedly (a second call is a
 * no-op and returns a no-op disposer).
 */
export function injectDashboardStyles(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (injected) return () => {};
  injected = true;
  const existing = document.querySelector(
    `style[data-plugin-css=${JSON.stringify(DASHBOARD_CSS_ID)}]`,
  );
  if (existing) return () => {};
  const tag = document.createElement('style');
  tag.dataset.plugin = '@ryubyte/dsh-a2a';
  tag.dataset.pluginCss = DASHBOARD_CSS_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
  return () => {
    tag.remove();
    injected = false;
  };
}