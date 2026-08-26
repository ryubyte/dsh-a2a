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
export declare const DASHBOARD_CSS_ID = "@ryubyte/dsh-a2a/dashboard.css";
/**
 * Idempotently inject the dashboard stylesheet into <head>. Returns a
 * disposer that removes the tag; safe to call repeatedly (a second call is a
 * no-op and returns a no-op disposer).
 */
export declare function injectDashboardStyles(): () => void;
//# sourceMappingURL=dashboard.css.d.ts.map