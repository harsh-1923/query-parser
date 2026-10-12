// Writes the llm-written dev set: queries used ONLY to pick checkpoints and stop training (S7).
// Never trained on, never reported as a test number. It should come from a model family that wrote
// none of the other sets: Claude/Haiku wrote v0 (S02), GLM wrote v1, kimi wrote the training
// paraphrases.
//
// Usage:
//   node scripts/gen-dev-queries.mjs --list                       # models on the gateway
//   LITELLM_MODEL=<model> node scripts/gen-dev-queries.mjs        # writes eval/datasets/llm-written/dev/
//   ... --allow-used-family                                       # only if no other family exists
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

const root = new URL("../", import.meta.url)
const envPath = new URL(".env.local", root)
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const base = (process.env.LITELLM_BASE_URL ?? "").replace(/\/+$/, "")
const key = process.env.LITELLM_API_KEY
if (!base || !key) {
  console.error("Set LITELLM_BASE_URL and LITELLM_API_KEY (env or .env.local).")
  process.exit(1)
}
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
const args = new Set(process.argv.slice(2))
const USED = /claude|haiku|sonnet|opus|anthropic|glm|zhipu|kimi|moonshot/i

if (args.has("--list")) {
  const res = await fetch(`${base}/v1/models`, { headers })
  const ids = res.ok ? ((await res.json()).data?.map((m) => m.id) ?? []) : []
  if (!res.ok) console.error(`GET /v1/models → ${res.status}`)
  for (const id of ids.sort())
    console.log(USED.test(id) ? `  ${id}  (family already used)` : `* ${id}`)
  console.log("\n* = usable for the dev set")
  process.exit(0)
}

const model = process.env.LITELLM_MODEL
if (!model) {
  console.error("Set LITELLM_MODEL (run with --list to see what's available).")
  process.exit(1)
}
if (USED.test(model) && !args.has("--allow-used-family")) {
  console.error(
    `${model} is from a family that already wrote a test or training set. Pick another one ` +
      "(--list), or pass --allow-used-family if the gateway has nothing else.",
  )
  process.exit(1)
}

async function chat(content) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        temperature: 1,
        messages: [{ role: "user", content }],
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) return body.choices?.[0]?.message?.content ?? ""
    if (attempt >= 3) throw new Error(`${res.status}: ${JSON.stringify(body)}`)
    await new Promise((r) => setTimeout(r, 2000 * attempt))
  }
}

// Same five products as v0/v1 (that is the domain), with different people and wording, so the dev
// set doesn't copy either test set's style.
const products = {
  chat: {
    product: "a team chat app with channels, DMs, threads, shared files, canvases and call notes",
    people: "people at a logistics startup in Pune and a bank's ops team in Mumbai",
    hints: "who said what, channel names, file types, dates, unread or saved messages",
  },
  email: {
    product: "a work inbox",
    people:
      "recruiters, account managers, accountants and a CEO's assistant in India and Singapore",
    hints: "who sent it or was cc'd, attachments, labels, drafts, dates, invoices, vendors",
  },
  tracker: {
    product: "a project tracker with tickets, bugs, epics, sprints, boards and releases",
    people: "mobile developers, designers, QA testers and an engineering manager in Hyderabad",
    hints: "assignee, reporter, status, priority, sprint, board, release, dates",
  },
  drive: {
    product: "a shared drive with documents, spreadsheets, slides, PDFs, images and folders",
    people: "a finance team, a legal team, a content agency and teachers at an edtech company",
    hints: "owner, who edited or shared it, folder, file type, dates, starred or in trash",
  },
  workspace: {
    product:
      "one work app that has chat, meeting recordings and transcripts, notes, calendar and files",
    people: "a small D2C brand team in Delhi (some Hinglish is fine)",
    hints: "people, teams, meetings, notes, channels, dates, states like pending or done",
  },
}
const N = 60

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim()
// Drop exact repeats of anything already in a test or training source.
const seen = new Set()
for (const dir of ["v0", "v1"])
  for (const p of Object.keys(products)) {
    const f = new URL(`eval/datasets/llm-written/${dir}/${p}.txt`, root)
    if (existsSync(f)) for (const l of readFileSync(f, "utf8").split("\n")) seen.add(norm(l))
  }
const para = new URL("packages/datagen/paraphrases/kimi-k3-v0.jsonl", root)
for (const l of readFileSync(para, "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(l)
  seen.add(norm(r.text))
  if (r.paraphrase) seen.add(norm(r.paraphrase))
}

const prompts = {}
const out = {}
await Promise.all(
  Object.entries(products).map(async ([k, p]) => {
    prompts[k] =
      `Picture ${p.people}, using ${p.product}. List ${N + 15} things they would really type into its search bar over a normal week. ` +
      "Write them the way people actually type: mostly short and lowercase, sometimes a full question, now and then a typo or abbreviation. " +
      `Where it feels natural, include ${p.hints}. Mix plain topic searches with ones that stack several conditions, a few that exclude something, and a few that ask for an order. ` +
      "Invent your own names and topics. One query per line, nothing else: no numbers, bullets, quotes or notes."
    const lines = (await chat(prompts[k]))
      .split("\n")
      .map((l) =>
        l
          .trim()
          .replace(/^[-*•\d.)\s]+/, "")
          .replace(/^["'`]|["'`]$/g, ""),
      )
      .filter((l) => l && l.length < 200)
    const kept = []
    for (const l of lines) {
      if (seen.has(norm(l))) continue
      seen.add(norm(l))
      kept.push(l)
      if (kept.length === N) break
    }
    out[k] = kept
  }),
)

const dir = new URL("eval/datasets/llm-written/dev/", root)
mkdirSync(dir, { recursive: true })
for (const [k, lines] of Object.entries(out))
  writeFileSync(new URL(`${k}.txt`, dir), `${lines.join("\n")}\n`)
writeFileSync(
  new URL("meta.json", dir),
  `${JSON.stringify({ model, date: new Date().toISOString().slice(0, 10), perProduct: N, prompts }, null, 2)}\n`,
)
console.log(model, Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])))
const short = Object.entries(out).filter(([, v]) => v.length < N)
if (short.length)
  console.warn(
    `Short: ${short.map(([k, v]) => `${k} ${v.length}/${N}`).join(", ")}. Run again to redo.`,
  )
console.log("Wrote eval/datasets/llm-written/dev/. Commit and push it; labelling happens next.")
