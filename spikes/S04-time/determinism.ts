// Same phrases, same reference and zone, different host TZ: grammar output must not change.
// Also times the grammar. Usage: node determinism.ts (prints a hash of all outputs + timing)
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import * as chrono from "chrono-node"
import { normalizeTime } from "./grammar.ts"

const REFERENCE = "2026-10-12T10:00:00.000Z"
const phrases = ["phrases-s2.tsv", "phrases-llm.tsv", "phrases-heldout.tsv"].flatMap((f) =>
  readFileSync(new URL(f, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("# "))
    .map((l) => l.split("\t")[1]!),
)
const g = createHash("sha256")
const c = createHash("sha256")
for (const p of phrases) {
  g.update(JSON.stringify(normalizeTime(p, { reference: REFERENCE, timeZone: "Asia/Kolkata" })))
  c.update(JSON.stringify(chrono.parse(p, new Date(REFERENCE)).map((r) => r.start.date().toISOString())))
}
const t0 = performance.now()
const N = 20
for (let i = 0; i < N; i++) for (const p of phrases) normalizeTime(p, { reference: REFERENCE, timeZone: "Asia/Kolkata" })
const us = ((performance.now() - t0) * 1000) / (N * phrases.length)
console.log(`TZ=${process.env.TZ ?? "(host)"} grammar ${g.digest("hex").slice(0, 12)} chrono ${c.digest("hex").slice(0, 12)} · grammar ${us.toFixed(1)} µs/phrase over ${phrases.length} phrases`)
