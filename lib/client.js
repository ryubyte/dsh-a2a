window.__ModuleLoader__.load({
	id: "@ryubyte/dsh-a2a",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/dashboard.css.ts
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
		const DASHBOARD_CSS_ID = "@ryubyte/dsh-a2a/dashboard.css";
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
		function injectDashboardStyles() {
			if (typeof document === "undefined") return () => {};
			if (injected) return () => {};
			injected = true;
			if (document.querySelector(`style[data-plugin-css=${JSON.stringify("@ryubyte/dsh-a2a/dashboard.css")}]`)) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = "@ryubyte/dsh-a2a";
			tag.dataset.pluginCss = DASHBOARD_CSS_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
				injected = false;
			};
		}
		//#endregion
		//#region src/client/index.ts
		/** Services this plugin needs from the client runtime. */
		const inject = ["slots"];
		function apply(ctx) {
			ctx.effect(() => {
				const dispose = injectDashboardStyles();
				return () => dispose();
			}, "dsh-a2a: dashboard styles");
			ctx.effect(() => {
				try {
					const off = ctx.slots.register({
						name: "settings.section",
						id: "a2a",
						order: 90,
						label: () => "A2A 连接",
						inject: () => ({})
					}, DashboardSection);
					return () => off();
				} catch (err) {
					console.error("[dsh-a2a] failed to register settings section:", err);
					return () => {};
				}
			}, "dsh-a2a: settings section");
		}
		async function fetchSnapshot() {
			const res = await fetch("/a2a/api", { headers: { accept: "application/json" } });
			if (!res.ok) throw new Error(`GET /a2a/api → HTTP ${res.status}`);
			return await res.json();
		}
		async function postControl(action, target, payload) {
			return await (await fetch("/a2a/api", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					action,
					target,
					...payload
				})
			})).json();
		}
		/**
		* Sensible starter values for the first-time guided setup, so a new user edits
		* a ready-to-go config instead of filling every field from scratch — they can
		* accept it as-is and click "创建并上线", or tweak what they want. baseUrl /
		* endpointPath stay blank (auto-inferred). The seed skill is a placeholder the
		* user renames or removes.
		*/
		function guidedServeDraft() {
			return {
				agentName: "DSH Agent",
				agentDescription: "基于 DeepSeek Harness 的 A2A Agent",
				agentVersion: "0.1.0",
				baseUrl: "",
				endpointPath: "",
				skills: [{
					id: "coding",
					name: "Coding",
					description: "在 DSH 工作区中执行编码与命令行任务",
					tags: "coding, shell"
				}]
			};
		}
		/** Build a serve draft from the live serve status (prefill the edit form). */
		function serveDraftFrom(serve) {
			return {
				agentName: serve.agentName ?? "",
				agentDescription: serve.agentDescription ?? "",
				agentVersion: serve.agentVersion ?? "",
				baseUrl: serve.baseUrl ?? "",
				endpointPath: serve.endpointPath ?? "",
				skills: (serve.skills ?? []).map((s) => ({
					id: s.id,
					name: s.name,
					description: s.description ?? "",
					tags: (s.tags ?? []).join(", ")
				}))
			};
		}
		/** The A2A connection dashboard settings section. */
		function DashboardSection(_props) {
			const [snap, setSnap] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [serve, setServe] = (0, react.useState)(null);
			const [addUrl, setAddUrl] = (0, react.useState)("");
			const [discovering, setDiscovering] = (0, react.useState)(false);
			const [discovered, setDiscovered] = (0, react.useState)(null);
			const [tab, setTab] = (0, react.useState)("client");
			/** connection ids whose skill list is expanded in the outbound tab. */
			const [expanded, setExpanded] = (0, react.useState)(/* @__PURE__ */ new Set());
			/** Optional bearer token for the add-agent form (outbound). */
			const [addToken, setAddToken] = (0, react.useState)("");
			/** Inbound authToken input (serve tab); empty string means "clear". */
			const [authInput, setAuthInput] = (0, react.useState)("");
			/** Serve-identity edit mode + form draft (server tab). All hooks stay at the
			* top level in fixed order; a single shared draft avoids per-card hooks. */
			const [editingServe, setEditingServe] = (0, react.useState)(false);
			const [serveDraft, setServeDraft] = (0, react.useState)(guidedServeDraft());
			/** connectionId of the outbound agent whose advanced-settings form is open
			* (null = none). One shared draft keeps agentCard() a pure, hookless fn. */
			const [editingAgent, setEditingAgent] = (0, react.useState)(null);
			const [agentDraft, setAgentDraft] = (0, react.useState)({
				timeoutMs: "",
				mapSkills: true,
				bearerToken: ""
			});
			const refresh = async () => {
				try {
					setError(null);
					setSnap(await fetchSnapshot());
					const sbody = await (await fetch("/a2a/api", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ action: "server-status" })
					})).json();
					if (sbody.ok && sbody.message) setServe(JSON.parse(sbody.message));
					else setServe(null);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				}
			};
			(0, react.useEffect)(() => {
				refresh();
				const timer = setInterval(() => void refresh(), 3e3);
				return () => clearInterval(timer);
			}, []);
			const act = async (action, target, payload) => {
				setBusy(`${action}:${target}`);
				setNotice(null);
				try {
					const result = await postControl(action, target, payload);
					setNotice(`${result.ok ? "✓" : "✗"} ${result.message}`);
				} catch (err) {
					setNotice(`✗ ${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setBusy(null);
					await refresh();
				}
			};
			const inbound = snap?.inbound ?? [];
			const outbound = snap?.outbound ?? [];
			const doDiscover = async () => {
				const u = addUrl.trim();
				if (!u) return;
				setDiscovering(true);
				setDiscovered(null);
				setNotice(null);
				try {
					const body = await (await fetch("/a2a/api", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							action: "discover-agent",
							agentCardUrl: u,
							bearerToken: addToken.trim() || void 0
						})
					})).json();
					if (!body.ok || !body.message) {
						setNotice(`✗ ${body.message}`);
						return;
					}
					setDiscovered(JSON.parse(body.message));
				} catch (err) {
					setNotice(`✗ ${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setDiscovering(false);
				}
			};
			const doConnect = async () => {
				if (!discovered) return;
				const n = discovered.name.trim() || "remote";
				await act("add-agent", n, {
					agentCardUrl: discovered.agentCardUrl,
					bearerToken: addToken.trim() || void 0
				});
				if (!busy) {
					setAddUrl("");
					setAddToken("");
					setDiscovered(null);
				}
			};
			const startEditServe = () => {
				if (serve) setServeDraft(serveDraftFrom(serve));
				setEditingServe(true);
			};
			const saveServeIdentity = async (also) => {
				const skills = serveDraft.skills.map((s) => ({
					id: s.id.trim(),
					name: s.name.trim(),
					description: s.description.trim(),
					tags: s.tags.split(",").map((t) => t.trim()).filter(Boolean)
				})).filter((s) => s.id && s.name);
				await act("set-server-identity", "", {
					agentName: serveDraft.agentName.trim(),
					agentDescription: serveDraft.agentDescription.trim(),
					agentVersion: serveDraft.agentVersion.trim(),
					baseUrl: serveDraft.baseUrl.trim(),
					endpointPath: serveDraft.endpointPath.trim() || void 0,
					skills
				});
				if (also === "enable") await act("server-enable", "");
				setEditingServe(false);
			};
			const startEditAgent = (a) => {
				const target = a.connectionId ?? a.id;
				setAgentDraft({
					timeoutMs: "",
					mapSkills: true,
					bearerToken: ""
				});
				setEditingAgent(target);
			};
			const saveAgentAdvanced = async (target) => {
				const t = agentDraft.timeoutMs.trim();
				await act("update-agent", target, {
					timeoutMs: t ? Number(t) : void 0,
					mapSkills: agentDraft.mapSkills,
					bearerToken: agentDraft.bearerToken.trim() || void 0
				});
				setEditingAgent(null);
			};
			return (0, react.createElement)("div", { className: "a2a-root" }, (0, react.createElement)("div", { className: "a2a-section" }, (0, react.createElement)("p", { className: "a2a-intro" }, "管理本 DSH 的 A2A 连接：在「连接的 Agent」里连接并调用远程 Agent，在「对外服务」里把本 DSH 作为 Agent 发布、并查看谁在调用它。"), error ? (0, react.createElement)("div", { className: "a2a-notice a2a-error" }, `加载失败：${error}`) : null, notice ? (0, react.createElement)("div", { className: "a2a-notice" }, notice) : null, tabRail([tabBtn("连接的 Agent", outbound.length, tab === "client", () => setTab("client")), tabBtn("对外服务", inbound.length, tab === "server", () => setTab("server"))]), tab === "client" ? (0, react.createElement)("div", { className: "a2a-stack" }, (0, react.createElement)("div", { className: "a2a-crew" }, sec("已连接 Agent", outbound.length), outbound.length === 0 ? emptyRow("暂无已连接的 Agent。使用下方\"添加 Agent\"通过 Agent Card URL 连接远程 A2A Agent。") : (0, react.createElement)("div", { className: "a2a-card-list" }, ...outbound.map((a) => agentCard(a, busy, act, expanded, setExpanded, {
				editingAgent,
				agentDraft,
				setAgentDraft,
				startEditAgent,
				saveAgentAdvanced: (t) => void saveAgentAdvanced(t),
				cancelEditAgent: () => setEditingAgent(null)
			})))), (0, react.createElement)("div", { className: "a2a-panel" }, (0, react.createElement)("div", { className: "a2a-panel-title" }, "添加 Agent"), (0, react.createElement)("div", { className: "a2a-field-row" }, (0, react.createElement)("input", {
				className: "a2a-input",
				placeholder: "Agent Card URL（https://…/.well-known/agent-card.json）",
				value: addUrl,
				onChange: (e) => {
					setAddUrl(e.target.value);
					setDiscovered(null);
				}
			}), actionBtn("导入", false, () => void doDiscover(), discovering || !addUrl.trim())), (0, react.createElement)("div", { className: "a2a-field-row" }, (0, react.createElement)("input", {
				className: "a2a-input",
				type: "password",
				placeholder: "Bearer Token(可选,发送为 Authorization: Bearer …)",
				value: addToken,
				onChange: (e) => setAddToken(e.target.value)
			})), (0, react.createElement)("div", { className: "a2a-hint" }, "若远程 Agent 需要鉴权,填入 token;导入与后续调用都会带上。token 会明文存入 a2a.json。"), discovering ? (0, react.createElement)("div", { className: "a2a-hint" }, "正在读取 Agent Card…") : discovered ? (0, react.createElement)("div", { className: "a2a-preview" }, (0, react.createElement)("div", { className: "a2a-preview-head" }, (0, react.createElement)("span", { className: "a2a-preview-name" }, discovered.name), discovered.version ? (0, react.createElement)("span", { className: "a2a-preview-version a2a-mono" }, `v${discovered.version}`) : null, stateDot("connected")), discovered.description ? (0, react.createElement)("div", { className: "a2a-preview-desc" }, discovered.description) : null, (discovered.skills?.length ?? 0) > 0 ? (0, react.createElement)("div", { className: "a2a-skill-list" }, (0, react.createElement)("div", { className: "a2a-skill-list-title" }, "Skills"), ...(discovered.skills ?? []).map((s) => (0, react.createElement)("div", { key: s.id }, `• ${s.name}${s.description ? ` — ${s.description}` : ""}`))) : null, discovered.endpoint ? (0, react.createElement)("div", { className: "a2a-preview-meta a2a-mono" }, `端点 ${discovered.endpoint}`) : null, (0, react.createElement)("div", { className: "a2a-btn-row" }, actionBtn("连接", true, () => void doConnect(), busy?.startsWith("add-agent:") ?? false), actionBtn("取消", false, () => {
				setDiscovered(null);
				setAddUrl("");
			}, false))) : (0, react.createElement)("div", { className: "a2a-hint" }, "输入远程 Agent 的 Agent Card URL 并点击\"导入\"，将自动读取其名称、描述、技能与能力，确认后建立连接。"))) : null, tab === "server" ? (0, react.createElement)("div", { className: "a2a-stack" }, serve ? editingServe ? serveEditPanel(serveDraft, setServeDraft, (also) => void saveServeIdentity(also), () => setEditingServe(false), busy, false) : needsServeSetup(serve) ? serveEditPanel(serveDraft, setServeDraft, (also) => void saveServeIdentity(also), () => setEditingServe(false), busy, true) : serveViewPanel(serve, busy, act, authInput, setAuthInput, startEditServe) : null, (0, react.createElement)("div", { className: "a2a-crew" }, sec("入站连接（谁在连接本 DSH）", inbound.length), inbound.length === 0 ? emptyRow("暂无入站连接。其他 A2A 客户端调用本 DSH 的 JSON-RPC 端点后会显示在这里。") : (0, react.createElement)("div", { className: "a2a-table-wrap" }, (0, react.createElement)("table", { className: "a2a-table" }, (0, react.createElement)("thead", null, headRow([
				"来源",
				"地址",
				"首次连接",
				"最近活动",
				"任务",
				"流",
				"操作"
			])), (0, react.createElement)("tbody", null, ...inbound.map((p) => inboundRow(p, busy, act))))))) : null, (0, react.createElement)("div", { className: "a2a-footer" }, `快照时间 ${snap ? new Date(snap.at).toLocaleTimeString() : "—"} · 每 3 秒自动刷新`)));
		}
		function agentCard(a, busy, act, expanded, setExpanded, edit) {
			const target = a.connectionId ?? a.id;
			const open = expanded.has(target);
			const skills = a.skills ?? [];
			const editingThis = edit.editingAgent === target;
			const toggle = () => {
				const next = new Set(expanded);
				if (next.has(target)) next.delete(target);
				else next.add(target);
				setExpanded(next);
			};
			return (0, react.createElement)("div", {
				key: a.id,
				className: a.enabled === false ? "a2a-card a2a-card-disabled" : "a2a-card"
			}, (0, react.createElement)("div", {
				className: "a2a-card-header",
				onClick: toggle
			}, (0, react.createElement)("span", {
				className: "a2a-card-chevron",
				"data-open": String(open)
			}, "▶"), stateDot(a.enabled === false ? "disabled" : a.state), (0, react.createElement)("span", { className: "a2a-card-title" }, a.agentName ?? a.name), a.enabled === false ? badge("disabled", "已禁用") : badge(a.configured ? "config" : "runtime", a.configured ? "配置" : "运行时"), (0, react.createElement)("span", { className: "a2a-card-sub" }, `${a.skillCount} 技能 · ${a.toolCount} 工具 · ${new Date(a.lastSeen).toLocaleTimeString()}`), (0, react.createElement)("div", { className: "a2a-card-ops" }, a.enabled === false ? actionBtn("启用", true, () => void act("enable-agent", target), busy === `enable-agent:${target}`) : actionBtn("重连", true, () => void act("reconnect-agent", target), busy === `reconnect-agent:${target}`), a.configured ? actionBtn("设置", false, () => editingThis ? edit.cancelEditAgent() : edit.startEditAgent(a), false) : null, actionBtn("禁用", false, () => void act("disable-agent", target), busy === `disable-agent:${target}`), actionBtn("删除", false, () => void act("remove-agent", target), busy === `remove-agent:${target}`))), (0, react.createElement)("div", { className: "a2a-meta-row" }, (0, react.createElement)("span", { className: "a2a-card-url a2a-mono" }, a.agentCardUrl), (0, react.createElement)(CopyButton, {
				text: a.agentCardUrl,
				label: "Agent Card URL"
			})), open && skills.length > 0 ? (0, react.createElement)("div", { className: "a2a-skills" }, ...skills.map((s) => (0, react.createElement)("div", {
				key: s.id,
				className: "a2a-skill-row"
			}, (0, react.createElement)("div", { className: "a2a-skill-name" }, s.name, s.tags?.length ? (0, react.createElement)("span", { className: "a2a-skill-tags" }, s.tags.join(", ")) : null), s.description ? (0, react.createElement)("div", { className: "a2a-skill-desc" }, s.description) : null))) : open ? (0, react.createElement)("div", { className: "a2a-skill-none" }, "（该 Agent 未声明技能）") : null, editingThis ? agentAdvancedForm(target, edit, busy) : null);
		}
		/**
		* Per-agent advanced-settings form: timeoutMs / mapSkills / bearerToken. Saving
		* persists to a2a.json and reconnects the agent to apply. Pure — draft lives in
		* the parent section.
		*/
		function agentAdvancedForm(target, edit, busy) {
			const d = edit.agentDraft;
			const saving = busy === `update-agent:${target}`;
			return (0, react.createElement)("div", { className: "a2a-adv" }, (0, react.createElement)("div", { className: "a2a-form-label" }, "高级设置"), (0, react.createElement)("div", { className: "a2a-form-row" }, (0, react.createElement)("label", { className: "a2a-form-label" }, "超时 (ms)"), (0, react.createElement)("input", {
				className: "a2a-input",
				type: "number",
				placeholder: "留空用默认",
				value: d.timeoutMs,
				onChange: (e) => edit.setAgentDraft({
					...d,
					timeoutMs: e.target.value
				})
			})), (0, react.createElement)("label", { className: "a2a-check-row" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: d.mapSkills,
				onChange: (e) => edit.setAgentDraft({
					...d,
					mapSkills: e.target.checked
				})
			}), (0, react.createElement)("span", null, "按技能拆分为多个工具（关闭则合并为单个工具）")), (0, react.createElement)("div", { className: "a2a-form-row" }, (0, react.createElement)("label", { className: "a2a-form-label" }, "Token"), (0, react.createElement)("input", {
				className: "a2a-input",
				type: "password",
				placeholder: "留空不修改",
				value: d.bearerToken,
				onChange: (e) => edit.setAgentDraft({
					...d,
					bearerToken: e.target.value
				})
			})), (0, react.createElement)("div", { className: "a2a-hint" }, "保存后会以新配置重连该 Agent，使超时/工具拆分/Token 生效。"), (0, react.createElement)("div", { className: "a2a-btn-row" }, actionBtn("保存并重连", true, () => edit.saveAgentAdvanced(target), saving), actionBtn("取消", false, edit.cancelEditAgent, false)));
		}
		function badge(kind, label) {
			return (0, react.createElement)("span", { className: `a2a-badge a2a-badge-${kind}` }, label);
		}
		/** A tab button matching the settings "插件" page's underline tab style. */
		function tabBtn(label, count, active, onClick) {
			return (0, react.createElement)("button", {
				onClick,
				"aria-selected": active,
				role: "tab",
				"data-active": String(active),
				className: "a2a-tab"
			}, label, count > 0 ? (0, react.createElement)("span", { className: "a2a-tab-count" }, String(count)) : null);
		}
		/** The tab strip container (underline rail, like first-party settings pages). */
		function tabRail(children) {
			return (0, react.createElement)("div", {
				role: "tablist",
				className: "a2a-tabs"
			}, ...children);
		}
		function sec(title, count) {
			return (0, react.createElement)("h3", { className: "a2a-h3" }, title, (0, react.createElement)("span", { className: "a2a-count" }, String(count)));
		}
		function emptyRow(text) {
			return (0, react.createElement)("div", { className: "a2a-empty" }, text);
		}
		function headRow(cols) {
			return (0, react.createElement)("tr", null, ...cols.map((c) => (0, react.createElement)("th", null, c)));
		}
		function stateDot(state) {
			return (0, react.createElement)("span", {
				className: "a2a-dot",
				"data-state": state
			});
		}
		function actionBtn(label, primary, onClick, disabled) {
			return (0, react.createElement)("button", {
				onClick,
				disabled,
				className: primary ? "a2a-btn a2a-btn-primary" : "a2a-btn"
			}, label);
		}
		/**
		* One-click copy button with transient "已复制 ✓" feedback. Uses the async
		* Clipboard API when available (secure contexts), falls back to execCommand
		* otherwise. The copied state lives in this component so the section's hook
		* order stays untouched.
		*/
		function CopyButton(props) {
			const [copied, setCopied] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!copied) return;
				const t = window.setTimeout(() => setCopied(false), 1500);
				return () => window.clearTimeout(t);
			}, [copied]);
			const onCopy = async () => {
				try {
					await navigator.clipboard.writeText(props.text);
					setCopied(true);
					return;
				} catch {}
				try {
					const ta = document.createElement("textarea");
					ta.value = props.text;
					ta.style.position = "fixed";
					ta.style.opacity = "0";
					document.body.appendChild(ta);
					ta.select();
					document.execCommand("copy");
					document.body.removeChild(ta);
					setCopied(true);
				} catch {}
			};
			return (0, react.createElement)("button", {
				type: "button",
				className: "a2a-copy-btn",
				onClick: () => void onCopy(),
				"data-copied": String(copied),
				"aria-label": `${copied ? "已复制" : "复制"}${props.label ? ` ${props.label}` : ""}`
			}, copied ? "已复制 ✓" : "复制");
		}
		/**
		* A semantically-correct note about how inbound tasks are executed. Dispatches
		* on the `executor` field; falls back to the legacy `customExecutor` boolean
		* for snapshots from an older host that didn't send `executor`.
		*/
		function executorNote(serve) {
			const kind = serve.executor ?? (serve.customExecutor ? "custom" : void 0);
			if (kind === "custom") return null;
			if (kind === "dsh-agent") return (0, react.createElement)("div", { className: "a2a-note" }, "ℹ 入站任务由本 DSH 的 agent 会话执行,按 A2A contextId 一个对话一个会话。");
			if (kind === "none") return (0, react.createElement)("div", { className: "a2a-note a2a-note-warn" }, "⚠ 未配置 executor,且未检测到可用的 agent 循环:入站任务会被拒绝。通过配置注入 execute,或加载 agent-loop 插件。");
			return null;
		}
		/**
		* True when the server has never been given an identity — no agentName (or the
		* bare default) and no skills. Drives the guided-setup card for fresh installs.
		*/
		function needsServeSetup(serve) {
			const name = (serve.agentName ?? "").trim();
			const unnamed = name === "" || name === "DSH Agent";
			const noSkills = (serve.skills?.length ?? 0) === 0;
			return unnamed && noSkills;
		}
		/**
		* Read-only serve panel: status + identity + endpoints + executor/auth, with an
		* "编辑" button that flips the section into {@link serveEditPanel}. Pure (no
		* hooks): the edit-mode flag and draft live in the parent section.
		*/
		function serveViewPanel(serve, busy, act, authInput, setAuthInput, onEdit) {
			return (0, react.createElement)("div", { className: "a2a-panel" }, (0, react.createElement)("div", { className: "a2a-serve-head" }, sec("A2A 服务（本 DSH 作为 Agent 对外）", 0), stateDot(serve.enabled ? "connected" : "disconnected"), (0, react.createElement)("span", {
				className: "a2a-serve-status",
				"data-on": String(serve.enabled)
			}, serve.enabled ? "运行中" : "已下线"), (0, react.createElement)("span", { className: "a2a-serve-ops" }, actionBtn("编辑", false, onEdit, false), serve.enabled ? actionBtn("下线", false, () => void act("server-disable", ""), busy === "server-disable:") : actionBtn("上线", true, () => void act("server-enable", ""), busy === "server-enable:"))), (0, react.createElement)("div", { className: "a2a-serve-meta" }, serve.agentName ? (0, react.createElement)("div", { className: "a2a-serve-name" }, serve.agentName, serve.agentVersion ? (0, react.createElement)("span", { className: "a2a-serve-version a2a-mono" }, `v${serve.agentVersion}`) : null) : null, serve.agentDescription ? (0, react.createElement)("div", { className: "a2a-serve-desc" }, serve.agentDescription) : null, serve.endpoint ? (0, react.createElement)("div", { className: "a2a-meta-row" }, (0, react.createElement)("span", { className: "a2a-meta-key" }, "端点"), (0, react.createElement)("span", { className: "a2a-serve-endpoint a2a-mono" }, serve.endpoint), (0, react.createElement)(CopyButton, {
				text: serve.endpoint,
				label: "端点"
			})) : null, serve.agentCardUrl ? (0, react.createElement)("div", { className: "a2a-meta-row" }, (0, react.createElement)("span", { className: "a2a-meta-key" }, "Agent Card"), (0, react.createElement)("span", { className: "a2a-serve-endpoint a2a-mono" }, serve.agentCardUrl), (0, react.createElement)(CopyButton, {
				text: serve.agentCardUrl,
				label: "Agent Card URL"
			})) : null, (serve.skills?.length ?? 0) > 0 ? (0, react.createElement)("div", { className: "a2a-skill-list" }, (0, react.createElement)("div", { className: "a2a-skill-list-title" }, "Skills"), ...(serve.skills ?? []).map((s) => (0, react.createElement)("div", { key: s.id }, `• ${s.name}${s.description ? ` — ${s.description}` : ""}`))) : null), serve.enabled ? executorNote(serve) : null, serve.enabled ? authControl(serve, busy, act, authInput, setAuthInput) : null);
		}
		/**
		* Serve-identity edit form (also the guided-setup card for fresh installs).
		* Pure: the draft + setter live in the parent section. `guided` switches the
		* copy and the primary action (create-and-serve vs save).
		*/
		function serveEditPanel(draft, setDraft, onSave, onCancel, busy, guided) {
			const set = (patch) => setDraft({
				...draft,
				...patch
			});
			const setSkill = (i, patch) => setDraft({
				...draft,
				skills: draft.skills.map((s, j) => j === i ? {
					...s,
					...patch
				} : s)
			});
			const addSkill = () => setDraft({
				...draft,
				skills: [...draft.skills, {
					id: "",
					name: "",
					description: "",
					tags: ""
				}]
			});
			const delSkill = (i) => setDraft({
				...draft,
				skills: draft.skills.filter((_, j) => j !== i)
			});
			const saving = busy === "set-server-identity:" || busy === "server-enable:";
			const field = (label, key, placeholder) => (0, react.createElement)("div", { className: "a2a-form-row" }, (0, react.createElement)("label", { className: "a2a-form-label" }, label), (0, react.createElement)("input", {
				className: "a2a-input",
				placeholder,
				value: draft[key],
				onChange: (e) => set({ [key]: e.target.value })
			}));
			return (0, react.createElement)("div", { className: "a2a-panel" }, (0, react.createElement)("div", { className: "a2a-panel-title" }, guided ? "配置对外服务（首次设置）" : "编辑对外服务"), guided ? (0, react.createElement)("div", { className: "a2a-note" }, "ℹ 填写下面的信息即可把本 DSH 作为 A2A Agent 发布，保存后自动上线。所有配置写入 a2a.json，无需手改文件。") : null, field("名称", "agentName", "如 My DSH Agent"), field("描述", "agentDescription", "一句话说明这个 Agent 能做什么"), field("版本", "agentVersion", "如 0.1.0"), field("Base URL", "baseUrl", "留空自动推断（对外可达地址）"), (0, react.createElement)("div", { className: "a2a-hint" }, "留空则按服务实际监听地址自动推断；仅在有反向代理或公网域名时才需要手动填写。"), field("端点路径", "endpointPath", "留空默认 /a2a"), (0, react.createElement)("div", { className: "a2a-skill-edit-head" }, (0, react.createElement)("span", { className: "a2a-form-label" }, `技能（${draft.skills.length}）`), actionBtn("+ 添加技能", false, addSkill, false)), draft.skills.length === 0 ? (0, react.createElement)("div", { className: "a2a-hint" }, "至少添加一个技能，远程调用方才知道本 Agent 能做什么。") : (0, react.createElement)("div", { className: "a2a-skill-edit-list" }, ...draft.skills.map((s, i) => skillEditRow(s, i, setSkill, delSkill))), (0, react.createElement)("div", { className: "a2a-btn-row" }, guided ? actionBtn("创建并上线", true, () => onSave("enable"), saving) : actionBtn("保存", true, () => onSave(), saving), actionBtn("取消", false, onCancel, false)));
		}
		/** One editable skill row (id/name/description + tags) with a delete button. */
		function skillEditRow(s, i, setSkill, delSkill) {
			const inp = (key, placeholder) => (0, react.createElement)("input", {
				className: "a2a-input",
				placeholder,
				value: s[key],
				onChange: (e) => setSkill(i, { [key]: e.target.value })
			});
			return (0, react.createElement)("div", {
				key: String(i),
				className: "a2a-skill-edit-row"
			}, (0, react.createElement)("div", { className: "a2a-skill-edit-grid" }, inp("id", "id（唯一标识，如 coding）"), inp("name", "名称（如 Coding）")), inp("description", "描述"), (0, react.createElement)("div", { className: "a2a-skill-edit-foot" }, (0, react.createElement)("input", {
				className: "a2a-input",
				placeholder: "标签（逗号分隔，可选）",
				value: s.tags,
				onChange: (e) => setSkill(i, { tags: e.target.value })
			}), actionBtn("删除", false, () => delSkill(i), false)));
		}
		/**
		* Inbound bearer-token control for the serve tab: shows whether the endpoint is
		* token-gated, and lets the operator set or clear the shared token. The token
		* value is never read back from the host — only whether one is configured.
		*/
		function authControl(serve, busy, act, authInput, setAuthInput) {
			return (0, react.createElement)("div", { className: "a2a-auth" }, (0, react.createElement)("div", { className: "a2a-auth-row" }, (0, react.createElement)("span", { className: "a2a-auth-label" }, "入站鉴权"), stateDot(serve.authConfigured ? "connected" : "disabled"), (0, react.createElement)("span", {
				className: "a2a-auth-state",
				"data-on": String(serve.authConfigured)
			}, serve.authConfigured ? "已启用 Bearer 鉴权" : "未鉴权(任何客户端可调用)")), (0, react.createElement)("div", { className: "a2a-auth-input-row" }, (0, react.createElement)("input", {
				className: "a2a-input",
				type: "password",
				placeholder: serve.authConfigured ? "输入新 token 以替换" : "设置 Bearer Token 以开启鉴权",
				value: authInput,
				onChange: (e) => setAuthInput(e.target.value)
			}), actionBtn("保存", true, () => {
				act("set-server-auth", "", { authToken: authInput.trim() });
				setAuthInput("");
			}, busy === "set-server-auth:" || !authInput.trim()), serve.authConfigured ? actionBtn("清除", false, () => {
				act("set-server-auth", "", { authToken: "" });
				setAuthInput("");
			}, busy === "set-server-auth:") : null), (0, react.createElement)("div", { className: "a2a-hint" }, "token 会明文存入 a2a.json,重启后仍生效。设置后,入站 JSON-RPC 请求需带 Authorization: Bearer <token>。"));
		}
		function inboundRow(p, busy, act) {
			return (0, react.createElement)("tr", { key: p.id }, (0, react.createElement)("td", { "data-label": "来源" }, p.label), (0, react.createElement)("td", {
				className: "a2a-cell-mono",
				"data-label": "地址"
			}, p.source ?? "—"), (0, react.createElement)("td", { "data-label": "首次连接" }, new Date(p.firstSeen).toLocaleTimeString()), (0, react.createElement)("td", { "data-label": "最近活动" }, new Date(p.lastSeen).toLocaleTimeString()), (0, react.createElement)("td", { "data-label": "任务" }, String(p.taskCount)), (0, react.createElement)("td", { "data-label": "流" }, p.streaming ? "● 流" : "—"), (0, react.createElement)("td", { "data-label": "操作" }, actionBtn("关闭", false, () => void act("close-peer", p.id), busy === `close-peer:${p.id}`)));
		}
		//#endregion
		exports.DashboardSection = DashboardSection;
		exports.apply = apply;
		exports.inject = inject;

		return module.exports;
	}
});
