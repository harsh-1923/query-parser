// Asks kimi-k3 for the open-class word lists @qp/datagen fills templates with (PLAN §9.0):
// topics, container names, groups/orgs and relational names. Output is committed as source data in
// packages/datagen/lexicons/. Kinds and states come from the S05 vocabulary instead.
// Usage: node scripts/gen-lexicons.mjs
import { writeFileSync } from "node:fs"
import { chat, model } from "../spikes/S04-time/llm.mjs"

const domains = [
  "fintech and payments",
  "developer tools and infrastructure",
  "e-commerce and retail",
  "healthcare SaaS",
  "HR and people operations",
  "marketing and growth",
  "sales and customer success",
  "legal and finance back office",
  "design and product",
  "data and analytics",
]

const ask = async (prompt) => {
  const out = await chat(
    `${prompt}\n\nOutput one item per line, lowercase, no numbering, no commentary.`,
    {
      temperature: 1,
    },
  )
  return out
    .split("\n")
    .map((l) => l.trim().replace(/^[-*•\d.)\s]+/, ""))
    .filter((l) => l && l.length <= 40 && !l.includes(":"))
}

const lists = await Promise.all([
  ...domains.map((d) =>
    ask(
      `List 60 distinct short topics (1–4 words) that people at a ${d} company search their chat, email, docs and tickets for, e.g. "sync engine", "refund retries", "q3 board deck review". Mix jargon, project codenames, acronyms and plain phrases. No people's names, no dates, no file types.`,
    ),
  ),
  ask(
    `List 150 distinct names of chat channels, boards, projects, folders, repos and spaces at a tech company, as people would type them in a search box: some with # (like "#payments-ops", "#eng-alerts"), some plain (like "growth", "checkout v2", "infra-oncall", "legal docs", "berlin office"). No people's names.`,
  ),
  ask(
    `List 80 distinct names of teams, groups and organisations people mention in workplace search, e.g. "the infra team", "frontend team", "acme corp", "razorpay folks", "legal", "the board", "finance", "my team". Include company-like names, vendor names and internal team names.`,
  ),
  ask(
    `List 40 distinct relational ways to refer to a colleague without naming them, e.g. "my manager", "the cfo", "the auditor", "my skip", "the on-call engineer", "the recruiter".`,
  ),
])

const uniq = (xs) => [...new Set(xs.map((x) => x.toLowerCase()))].sort()
const topics = uniq(lists.slice(0, domains.length).flat())
const [containers, groups, relational] = lists.slice(domains.length).map(uniq)
const header = {
  source: model,
  script: "scripts/gen-lexicons.mjs",
  note: "LLM-written; regenerating changes it",
}
for (const [name, items] of Object.entries({ topics, containers, groups, relational }))
  writeFileSync(
    new URL(`../packages/datagen/lexicons/${name}.json`, import.meta.url),
    `${JSON.stringify({ ...header, items }, null, 2)}\n`,
  )
console.log({
  topics: topics.length,
  containers: containers.length,
  groups: groups.length,
  relational: relational.length,
})
