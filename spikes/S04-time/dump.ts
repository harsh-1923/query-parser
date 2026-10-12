import { readFileSync } from "node:fs"
import { normalizeTime } from "./grammar.ts"
const f = process.argv[2]!
for (const l of readFileSync(f, "utf8").split("\n")) {
  if (!l || l.startsWith("# ")) continue
  const p = l.split("\t")[1]!
  const r = normalizeTime(p, { reference: "2026-10-12T10:00:00.000Z", timeZone: "Asia/Kolkata" })
  console.log(`${p.padEnd(30)} ${r.ok ? `${r.local.from ?? "–"} → ${r.local.to ?? "–"} ${r.granularity}` : "—"}`)
}
