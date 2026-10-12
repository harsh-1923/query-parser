// Writes llm-written v1: search queries from a different model family than v0 (Claude Haiku), using
// the same personas and prompt shape (eval/datasets/llm-written/v0/PROMPTS.md). Never used for
// training. Usage: LITELLM_MODEL=glm-latest node scripts/gen-test-queries.mjs
import { writeFileSync } from "node:fs"
import { chat, model } from "../spikes/S04-time/llm.mjs"

const products = {
  chat: {
    product: "a team chat app with channels, DMs, threads, files, canvases and call transcripts",
    people: "employees at an Indian fintech",
    hints:
      "colleagues' names, channel names like #payments-ops, file types, times, states like unread or pinned",
  },
  email: {
    product: "work email",
    people: "sales, finance, HR, managers and founders in India, the US and Europe",
    hints: "senders and recipients, attachments, labels, drafts, times, vendors",
  },
  tracker: {
    product: "an issue tracker / project tool with tickets, bugs, epics, sprints and boards",
    people: "engineers, QA, PMs and support in Bangalore and Berlin",
    hints: "assignees, reporters, statuses, priorities, boards, sprints, releases, times",
  },
  drive: {
    product: "a shared cloud drive with docs, sheets, decks, pdfs, images and folders",
    people: "designers, analysts, lawyers, marketers and engineers in India",
    hints: "owners, who shared or edited, folders, file types, times, starred or trashed",
  },
  workspace: {
    product: "an all-in-one work app with chat, meeting transcripts, notes, calendar and files",
    people: "people at an Indian startup (a little Hinglish is fine)",
    hints: "people, teams, meetings, notes, channels, times, states",
  },
}

const out = {}
await Promise.all(
  Object.entries(products).map(async ([key, p]) => {
    const text = await chat(
      `Imagine 8 different people (${p.people}) using ${p.product}. Write 60 search queries they would actually type into the search box, the way people really type. Vary heavily: mostly terse and lowercase; some questions; a few typos. Mention things like ${p.hints}, in whatever way feels natural. Some pure topic queries; some combine several constraints; some negations; some sorting. Use your own names, topics and wording. Output exactly 60 lines, one query per line, no numbering, no commentary.`,
      { temperature: 1, maxTokens: 16000 },
    )
    out[key] = text
      .split("\n")
      .map((l) => l.trim().replace(/^[-*•\d.)\s]+/, ""))
      .filter(Boolean)
  }),
)
for (const [key, lines] of Object.entries(out))
  writeFileSync(
    new URL(`../eval/datasets/llm-written/v1/${key}.txt`, import.meta.url),
    `${lines.join("\n")}\n`,
  )
console.log(model, Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])))
