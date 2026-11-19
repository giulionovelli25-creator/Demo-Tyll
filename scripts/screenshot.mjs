// Takes full-page screenshots of the running demo with the Chrome installed on this Mac (Playwright is not installed).
// Usage: node scripts/screenshot.mjs <path> <out.png> [--width 1440|375] [--role u-fnb] [--lang ar] [--base http://localhost:3210]
// Sets the role through the public demo's role switch, accepts or skips the cookie banner (stored as "no" so it does not
// cover the page), and waits for the page to settle. Phone widths get a phone user agent and touch.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const [page, out] = args;
if (!page || !out) { console.error("Usage: node scripts/screenshot.mjs <path> <out.png> [--width 1440] [--role u-fnb] [--lang ar]"); process.exit(2); }
const width = Number(opt("width", "1440"));
const role = opt("role", "u-fnb");
const lang = opt("lang", "en");
const base = opt("base", "http://localhost:3210");
const wait = Number(opt("wait", "3500"));
const phone = width < 768;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tyll-shot-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const t = list.find((x) => x.type === "page"); if (t) return t.webSocketDebuggerUrl; } catch { /* starting */ }
    await sleep(250);
  }
  throw new Error("Chrome did not start.");
}

try {
  const ws = new WebSocket(await target());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height: phone ? 812 : 900, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
  if (phone) {
    await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  // Open the site once to get a demo session, then switch to the role and set the browser-side choices.
  await send("Page.navigate", { url: `${base}/` });
  await sleep(2500);
  const switched = await evaluate(`fetch('/api/auth/demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:${JSON.stringify(role)}})}).then(r=>r.status)`);
  await evaluate(`(()=>{try{localStorage.setItem('tyll-visit-consent-v1',JSON.stringify({choice:'no',at:new Date().toISOString()}));localStorage.setItem('tyll-guided-path','off');localStorage.setItem('tyll-lang-v1',JSON.stringify({state:{lang:${JSON.stringify(lang)}},version:0}));}catch(e){}return 1})()`);
  await send("Page.navigate", { url: `${base}${page}` });
  await sleep(wait);
  const h = await evaluate("Math.min(document.documentElement.scrollHeight, 12000)");
  await send("Emulation.setDeviceMetricsOverride", { width, height: Math.max(phone ? 812 : 900, h || 0), deviceScaleFactor: phone ? 2 : 1, mobile: phone });
  await sleep(600);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  const errors = await evaluate("document.body.innerText.match(/could not load|something went wrong/i)?.[0] ?? ''");
  console.log(JSON.stringify({ out, width, role, lang, roleSwitch: switched, url: await evaluate("location.pathname+location.search"), pageHeight: h, errorText: errors }));
  ws.close();
} finally {
  chrome.kill();
  await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once("exit", r)));
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a temp folder; the system clears it */ }
}
