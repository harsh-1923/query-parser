// Pulls every TIME span out of the S02 annotations into phrases-s2.tsv (one line per occurrence).
// Usage: node extract-s2.mjs
import { readFileSync, writeFileSync } from "node:fs"

const tsv = readFileSync(new URL("../S02-role-coverage/annotations.tsv", import.meta.url), "utf8")
const rows = []
for (const line of tsv.split("\n")) {
  if (!line || line.startsWith("# query\t")) continue
  const [query, spans] = line.split("\t")
  for (const s of (spans ?? "").split("|")) {
    const m = s.match(/^!?TIME:(.+)$/)
    if (m) rows.push(`s2\t${m[1]}\t${query}`)
  }
}
writeFileSync(
  new URL("phrases-s2.tsv", import.meta.url),
  `# TIME spans from spikes/S02-role-coverage/annotations.tsv; see extract-s2.mjs\n# source\tphrase\tquery\n${rows.join("\n")}\n`,
)
console.log(`${rows.length} TIME spans, ${new Set(rows.map((r) => r.split("\t")[1])).size} unique`)
