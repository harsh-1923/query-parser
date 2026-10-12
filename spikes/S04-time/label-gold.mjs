// Asks kimi-k3 to label every phrase against POLICIES.md, independently of the grammar.
// Output: gold-llm.jsonl. Disagreements with the grammar are adjudicated by hand in adjudication.tsv.
// Usage: node label-gold.mjs [out.jsonl phrases.tsv…]  (default: gold-llm.jsonl from the S2 + kimi sets)
import { readFileSync, writeFileSync } from "node:fs"
import { chat } from "./llm.mjs"

const read = (f) =>
  readFileSync(new URL(f, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("# "))
    .map((l) => l.split("\t")[1])
const [outFile = "gold-llm.jsonl", ...inputs] = process.argv.slice(2)
const files = inputs.length ? inputs : ["phrases-s2.tsv", "phrases-llm.tsv"]
const phrases = [...new Set(files.flatMap(read))]
const policies = readFileSync(new URL("POLICIES.md", import.meta.url), "utf8")

const batches = []
for (let i = 0; i < phrases.length; i += 20) batches.push(phrases.slice(i, i + 20))

const results = await Promise.all(
  batches.map(async (batch, i) => {
    const prompt = `${policies}

---

Apply the rules above exactly. For each time phrase below, output one JSON object per line:
{"phrase": "<as given>", "from": "YYYY-MM-DDTHH:MM" or null, "to": "YYYY-MM-DDTHH:MM" or null, "g": "<granularity>"}
or, when the phrase has no definite meaning under the rules:
{"phrase": "<as given>", "none": "<short reason>"}
Use local times (Asia/Kolkata), null for an open end. Typos and abbreviations mean what the writer obviously intended. Today is Monday 2026-10-12, now is 15:30. Double-check weekday arithmetic against this calendar:
Sep 2026: Mon 7, 14, 21, 28. Oct 2026: Mon 5, 12, 19. Mar 2026 starts on a Sunday. Jan 1 2026 is a Thursday.

Phrases:
${batch.join("\n")}

Output only the ${batch.length} JSON lines.`
    for (let attempt = 0; ; attempt++) {
      const out = await chat(prompt, { maxTokens: 32000 })
      const rows = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l))
      if (rows.length === batch.length || attempt === 2) {
        console.error(`batch ${i}: ${rows.length}/${batch.length}`)
        return rows
      }
    }
  }),
)
writeFileSync(
  new URL(outFile, import.meta.url),
  `${results.flat().map((r) => JSON.stringify(r)).join("\n")}\n`,
)
