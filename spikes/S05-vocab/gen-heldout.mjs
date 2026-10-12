// Held-out KIND/ATTR spans: kimi-k3 writes queries with spans marked, then labels each span with a
// key from keys.json (meanings only, no aliases). Written before aliases.mjs was finalized and not
// read until eval. Output: heldout.jsonl. Usage: node gen-heldout.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { chat, model } from "../S04-time/llm.mjs"

const keys = JSON.parse(readFileSync(new URL("keys.json", import.meta.url), "utf8"))
const products = {
  chat: "a team chat app",
  email: "an email client",
  tracker: "an issue tracker",
  drive: "a cloud drive",
  meetings: "a meetings and calls tool",
}

const gen = await Promise.all(
  Object.entries(products).map(async ([key, desc]) => {
    const out = await chat(
      `Write 30 realistic, terse, mostly lowercase search queries people at a tech company would type into the search box of ${desc}. Most queries should name the kind of item wanted (in any wording: synonyms, plurals, abbreviations, file extensions, slang, typos) and many should include a state or property (read/unread, priority, status, starred, drafts, attachments, and so on). Vary wording widely; avoid repeating the same item word.

Mark the item-kind words with {curly braces} and state/property words with [square brackets], e.g. "{pdfs} from priya [unread]" or "[p1] {bugs} in payments". Mark only those words, nothing else.

Output 30 lines, one query per line, no numbering.`,
      { temperature: 1 },
    )
    const spans = []
    for (const q of out.split("\n").map((l) => l.trim()).filter(Boolean)) {
      for (const m of q.matchAll(/\{([^}]+)\}/g)) spans.push({ role: "KIND", text: m[1].trim(), query: q.replace(/[{}[\]]/g, ""), product: key })
      for (const m of q.matchAll(/\[([^\]]+)\]/g)) spans.push({ role: "ATTR", text: m[1].trim(), query: q.replace(/[{}[\]]/g, ""), product: key })
    }
    return spans
  }),
)
const spans = gen.flat()

const keyList = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n")
const labeled = []
for (let i = 0; i < spans.length; i += 30) {
  const batch = spans.slice(i, i + 30)
  const out = await chat(
    `Label each span from a search query with the key it means, using only these keys.

KIND keys (the type of item wanted):
${keyList(keys.kinds)}

ATTR keys (a state or property):
${keyList(keys.attrs)}

Rules: pick the most specific key that fits ("pdfs" → pdf, not file). If no key fits, or the span is a dynamic value (a label name, a size, a place, a version), answer "none". Answer per span as JSON on one line: {"i": <index>, "key": "<key or none>"}.

Spans (index, role, span, full query):
${batch.map((s, j) => `${i + j}\t${s.role}\t${s.text}\t${s.query}`).join("\n")}

Output only the ${batch.length} JSON lines.`,
    { maxTokens: 32000 },
  )
  const got = new Map(out.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => { const o = JSON.parse(l); return [o.i, o.key] }))
  for (const [j, s] of batch.entries()) labeled.push({ ...s, gold: got.get(i + j) ?? null })
}
writeFileSync(new URL(process.argv[2] ?? "heldout.jsonl", import.meta.url), `${labeled.map((s) => JSON.stringify(s)).join("\n")}\n`)
console.error(`${model}: ${labeled.length} spans, ${labeled.filter((s) => s.gold === null).length} unlabeled`)
