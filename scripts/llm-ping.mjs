// Checks that the LLM gateway is reachable and the model answers.
// Reads LITELLM_BASE_URL, LITELLM_API_KEY, LITELLM_MODEL from the environment or .env.local.
// Usage: node scripts/llm-ping.mjs

import { existsSync, readFileSync } from "node:fs"

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const base = (process.env.LITELLM_BASE_URL ?? "").replace(/\/+$/, "")
const key = process.env.LITELLM_API_KEY
const model = process.env.LITELLM_MODEL ?? "kimi-k3"
if (!base || !key) {
  console.error("Set LITELLM_BASE_URL and LITELLM_API_KEY (env or .env.local).")
  process.exit(1)
}
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }

const models = await fetch(`${base}/v1/models`, { headers })
console.log(`GET /v1/models → ${models.status}`)
if (models.ok) {
  const ids = (await models.json()).data?.map((m) => m.id) ?? []
  console.log(
    `models matching "${model.split("-")[0]}":`,
    ids.filter((id) => id.includes(model.split("-")[0])),
  )
}

const t0 = performance.now()
const res = await fetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model,
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: "Write 3 short search queries someone might type into Slack. One per line.",
      },
    ],
  }),
})
console.log(
  `POST /v1/chat/completions (${model}) → ${res.status} in ${Math.round(performance.now() - t0)} ms`,
)
const body = await res.json()
console.log(body.choices?.[0]?.message?.content ?? JSON.stringify(body, null, 2))
if (body.usage) console.log("usage:", body.usage)
