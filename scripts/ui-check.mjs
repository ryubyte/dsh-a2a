/**
 * Drive headless Chrome via CDP: open the DSH web UI, open Settings, find the
 * A2A section, click through, and report the rendered dashboard.
 * Usage: node scripts/ui-check.mjs <url>
 */
const url = process.argv[2] ?? 'http://127.0.0.1:3191/';

const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension'));
if (!page) { console.error('no page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
await send('Page.enable');

const evalJs = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) return `EXC: ${JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)}`;
  return res.result?.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Navigate and wait for boot
await send('Page.navigate', { url });
await sleep(9000);

console.log('[1] app root:', await evalJs(`!!document.querySelector('#root')?.children?.length`));

// Find and click the settings trigger. DSH settings shell: a button whose
// label/aria says 设置 / Settings (sidebar foot).
const clicked = await evalJs(`(() => {
  const buttons = [...document.querySelectorAll('button')];
  const target = buttons.find(b => {
    const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).trim();
    return t.includes('设置') || t.includes('Settings');
  });
  if (!target) return 'no settings button: ' + buttons.map(b => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean).join(' | ').slice(0, 300);
  target.click();
  return 'clicked';
})()`);
console.log('[2] settings click:', clicked);
await sleep(3000);

// Expand the sidebar first (rail state hides labels/settings)
await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === '打开侧边栏'); if (b) { b.click(); return 'expanded'; } return 'no expand btn'; })()`);
await sleep(1500);
const navs = await evalJs(`[...document.querySelectorAll('button')].map(b => ({
  text: (b.innerText||'').trim().slice(0,20),
  aria: b.getAttribute('aria-label'),
  title: b.getAttribute('title'),
})).filter(x => x.text || x.aria).slice(0, 60)`);
console.log('[3] all buttons after expand:', JSON.stringify(navs, null, 1));
const gear = await evalJs(`(() => {
  const all = [...document.querySelectorAll('*')];
  const hits = all.filter(e => {
    const s = (e.getAttribute?.('aria-label') || '') + ' ' + (e.getAttribute?.('title') || '') + ' ' + (e.getAttribute?.('data-testid') || '');
    return /设置|settings/i.test(s);
  }).slice(0, 10).map(e => ({ tag: e.tagName, aria: e.getAttribute('aria-label'), title: e.getAttribute('title') }));
  return hits;
})()`);
console.log('[3b] settings-ish elements:', JSON.stringify(gear));

// Click the settings button (expanded sidebar shows it), then the A2A section
const settingsClick = await evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '设置' || (x.innerText || '').trim() === 'Settings');
  if (!b) return 'no settings text button';
  b.click();
  return 'clicked settings';
})()`);
console.log('[4] settings click:', settingsClick);
await sleep(4000);

const panel = await evalJs(`document.body.innerText.slice(0, 1200)`);
console.log('[5] after settings open:\n', JSON.stringify(panel));

// Now find the A2A nav entry in the settings shell
const a2aClick = await evalJs(`(() => {
  const els = [...document.querySelectorAll('button, [role=tab], a, div, span')];
  const target = els.find(b => (b.innerText || '').trim() === 'A2A 连接' || (b.innerText || '').trim() === 'A2A');
  if (!target) return 'no A2A nav';
  target.click();
  return 'clicked A2A';
})()`);
console.log('[6] A2A click:', a2aClick);
await sleep(6000);

const finalText = await evalJs(`document.body.innerText.slice(0, 3000)`);
console.log('[7] final body text:\n', JSON.stringify(finalText));

ws.close();
console.log('\nDONE');