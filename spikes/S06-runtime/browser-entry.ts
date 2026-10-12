import { directorySource } from "../../packages/core/src/directorySource.ts"
import { runBench } from "./bench-core.ts"

const out = document.getElementById("out")
const lines = []
const log = (s) => { lines.push(s); out.textContent = lines.join("\n") }
const go = () => {
  log(`UA: ${navigator.userAgent}`)
  log(`crossOriginIsolated=${self.crossOriginIsolated} hardwareConcurrency=${navigator.hardwareConcurrency}`)
  const t = performance.now()
  const rows = runBench({ directorySource, now: () => performance.now(), log, iters: Number(new URLSearchParams(location.hash.slice(1)).get('iters') || 2000) })
  log(`done in ${((performance.now() - t) / 1000).toFixed(1)} s`)
  window.__rows = rows
  document.title = "DONE"
}
document.getElementById("go").addEventListener("click", () => setTimeout(go, 50))
if (location.hash.startsWith("#auto")) setTimeout(go, 100)
