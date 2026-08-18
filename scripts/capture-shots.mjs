/**
 * Capture README screenshots from a running DSH instance via CDP.
 *
 * Opens the given URL, navigates to 设置 → A2A 连接, waits for the panel,
 * and captures the settings dialog as PNG files into docs/screenshots/.
 *
 * Usage: node scripts/capture-shots.mjs <url> [outStem]
 *   <url>     e.g. http://127.0.0.1:3083/
 *   [outStem] base filename (default "dashboard-outbound"); "outbound" and
 *             "inbound" / "serve" variants are captured per tab.
 *
 * Requires a Chrome instance reachable on the page's websocket debugger URL
 * (we connect through the browser's /json endpoint on the given host).
 * Node >= 22 (global WebSocket).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'docs', 'screenshots');

const url = process.argv[2] ?? 'http://127.0.0.1:3083/';
const stem = process.argv[3] ?? 'dashboard';
const debugPort = Number(process.env.CDP_PORT ?? 9224);

async function main() {
  // 1. Find a page target on the browser's CDP endpoint.
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension') && !t.url.startsWith('devtools://'));
  if (!page) throw new Error(`no page target on :${debugPort}; start headless chrome with --remote-debugging-port=${debugPort}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const id = ++seq;
    pending.set(id, { resolvePromise, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolvePromise, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolvePromise(msg.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1000, deviceScaleFactor: 2, mobile: false });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(`EXC: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    return res.result?.value;
  };

  // 2. Navigate + boot.
  await send('Page.navigate', { url });
  await sleep(8000);
  await evalJs(`new Promise(r => { const t0 = Date.now(); const iv = setInterval(() => { if (document.body.innerText.includes('设置') || Date.now() - t0 > 20000) { clearInterval(iv); r(); } }, 300); })`);

  // 3. Open settings, then the A2A section.
  //    The sidebar may be collapsed (icon-only): expand it first so the
  //    "设置" label is visible, falling back to aria-label matching.
  const opened = await evalJs(`(async () => {
    const findSet = () => [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim() === '设置' || (x.getAttribute('aria-label')||'').includes('设置'));
    let b = findSet();
    if (!b) {
      const expand = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'').includes('打开侧边栏') || (x.getAttribute('aria-label')||'').includes('展开侧边栏') || (x.getAttribute('title')||'').includes('侧边栏'));
      if (expand) expand.click();
      await new Promise(r => setTimeout(r, 1200));
      b = findSet();
    }
    if (!b) return 'no-settings';
    b.click(); return 'ok';
  })()`);
  if (opened !== 'ok') throw new Error(`settings open failed: ${opened}`);
  await sleep(1500);
  const a2a = await evalJs(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="tab"], [role="dialog"] div, [role="dialog"] span')].find(x => (x.innerText||'').trim() === 'A2A 连接');
    if (!b) return 'no-a2a-nav';
    b.click(); return 'ok';
  })()`);
  if (a2a !== 'ok') throw new Error(`a2a nav failed: ${a2a}`);
  await sleep(2500); // allow first snapshot + poll

  // 4. Capture the settings dialog (outbound tab is default).
  const capture = async (name) => {
    // Full-viewport screenshot; the dialog rect is printed for offline
    // cropping (CDP clip coordinates are unreliable across Chrome versions,
    // so we capture the whole viewport and crop with image tooling).
    const box = await evalJs(`(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), w: Math.round(r.width), h: Math.round(r.height), sw: innerWidth, sh: innerHeight };
    })()`);
    if (!box) throw new Error('no dialog box');
    const dpr = await evalJs('devicePixelRatio');
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const buf = Buffer.from(shot.data, 'base64');
    const out = join(OUT_DIR, `${name}.png`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, buf);
    // companion rect file for offline cropping
    await writeFile(`${out}.rect.json`, JSON.stringify({ dpr, css: box, device: { x: box.x * dpr, y: box.y * dpr, w: box.w * dpr, h: box.h * dpr } }));
    console.log(`saved ${out} (${buf.length} bytes) rect=${JSON.stringify(box)} dpr=${dpr}`);
  };

  await capture(`${stem}-outbound`);

  // 5. Switch to the inbound tab and capture.
  await evalJs(`(() => {
    const t = [...document.querySelectorAll('[role="dialog"] [role="tab"]')].find(x => (x.innerText||'').includes('入站连接'));
    if (t) t.click();
  })()`);
  await sleep(1800);
  await capture(`${stem}-inbound`);

  // 6. Switch to the serve tab (if present) and capture.
  await evalJs(`(() => {
    const t = [...document.querySelectorAll('[role="dialog"] [role="tab"]')].find(x => (x.innerText||'').includes('A2A 服务'));
    if (t) { t.click(); return true; }
    return false;
  })()`);
  await sleep(1800);
  const hasServe = await evalJs(`[...document.querySelectorAll('[role="dialog"] [role="tab"]')].some(x => (x.innerText||'').includes('A2A 服务'))`);
  if (hasServe) await capture(`${stem}-serve`);
  else console.log('no serve tab on this instance; skipping serve capture');

  ws.close();
  console.log('DONE');
}

main().catch((err) => { console.error(err); process.exit(1); });