// node cdp-throttle.mjs <url> <rate> <iters>  -- headless Chrome via CDP with CPU throttling
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
const [url, rate, iters] = [process.argv[2], Number(process.argv[3]), process.argv[4] || "500"]
const dir = mkdtempSync(tmpdir() + "/s6chrome-")
const port = 9333
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "about:blank"], { stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await sleep(200) } }
const page = targets.find((t) => t.type === "page")
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send("Emulation.setCPUThrottlingRate", { rate })
await send("Page.enable")
await send("Page.navigate", { url: `${url}#auto&iters=${iters}` })
for (;;) {
  await sleep(5000)
  const r = await send("Runtime.evaluate", { expression: "document.title" })
  if (r.result?.result?.value === "DONE") break
}
const r = await send("Runtime.evaluate", { expression: "document.getElementById('out').textContent" })
console.log(`CPU throttling rate: ${rate}x, iters=${iters}`)
console.log(r.result.result.value)
chrome.kill()
process.exit(0)
