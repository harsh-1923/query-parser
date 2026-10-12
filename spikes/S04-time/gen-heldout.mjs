// Held-out set: kimi-k3 writes whole search queries and marks the time span in [brackets].
// The grammar is frozen before this runs; results are reported without fixes.
// Output: phrases-heldout.tsv (product<TAB>phrase<TAB>query). Usage: node gen-heldout.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { chat, model } from "./llm.mjs"

const products = {
  chat: "a team chat app (messages, threads, channels, huddles)",
  email: "an email client (mail, attachments, invites)",
  tracker: "an issue tracker (tickets, bugs, epics, sprints)",
  drive: "a cloud drive (docs, sheets, pdfs, folders)",
  calendar: "a meetings and calendar tool (meetings, recordings, transcripts)",
}
const seen = new Set(
  ["phrases-s2.tsv", "phrases-llm.tsv"].flatMap((f) =>
    readFileSync(new URL(f, import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("# "))
      .map((l) => l.split("\t")[1].toLowerCase()),
  ),
)

const rows = []
await Promise.all(
  Object.entries(products).map(async ([key, desc]) => {
    const prompt = `Write 30 realistic search queries that people at a mid-size Indian tech company would type into the search box of ${desc}. Every query must contain a time constraint of some kind. Vary the time expressions widely: relative and absolute dates, weekdays, months, quarters, years, ranges, "before/after/since/until", times of day, numeric dates in Indian day/month order, sloppy typing and abbreviations. Keep them terse and lowercase like real search queries; include names, topics and so on as people do.

Mark the exact time expression in each query with square brackets, e.g. "invoice from priya [last tuesday]". Bracket only the time words (include words like "before", "since", "between ... and ..." when they are part of the time constraint).

Output 30 lines, one query per line, no numbering, no commentary.`
    const out = await chat(prompt, { temperature: 1 })
    for (const q of out.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const m = q.match(/\[([^\]]+)\]/)
      if (!m) continue
      rows.push([key, m[1].trim(), q.replace(/[[\]]/g, "")])
    }
  }),
)
const fresh = []
for (const r of rows) {
  const p = r[1].toLowerCase()
  if (seen.has(p)) continue
  seen.add(p)
  fresh.push(r.join("\t"))
}
writeFileSync(
  new URL("phrases-heldout.tsv", import.meta.url),
  `# held-out, written by ${model}, ${new Date().toISOString().slice(0, 10)}; see gen-heldout.mjs\n# product\tphrase\tquery\n${fresh.join("\n")}\n`,
)
console.error(`${rows.length} queries, ${fresh.length} unseen time phrases`)
