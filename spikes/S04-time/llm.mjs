// Minimal LiteLLM chat client for the spike. Reads .env.local like scripts/llm-ping.mjs.
import { existsSync, readFileSync } from "node:fs"

const envPath = new URL("../../.env.local", import.meta.url)
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const base = (process.env.LITELLM_BASE_URL ?? "").replace(/\/+$/, "")
const key = process.env.LITELLM_API_KEY
export const model = process.env.LITELLM_MODEL ?? "kimi-k3"

export async function chat(content, { maxTokens = 16000, temperature } = {}) {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      messages: [{ role: "user", content }],
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`)
  return body.choices[0].message.content ?? ""
}
