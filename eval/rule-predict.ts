// Writes the rule tagger's BIO predictions for a fixture-format JSONL file, so the rules are scored
// by the same code as the trained models (training/qp_train/score_predictions.py).
// Usage: node eval/rule-predict.ts <in.jsonl> <out.jsonl>
import { readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier))
        return nextResolve(`${specifier}.ts`, context)
      throw err
    }
  },
})

const { ruleTagger } = await import("../packages/core/src/ruleTagger.ts")
const { normalizeTime } = await import("../packages/time/src/index.ts")
const { ATTR_ALIASES, KIND_ALIASES } = await import("../spikes/S05-vocab/aliases-v1.mjs")

const tagger = ruleTagger({
  kinds: Object.values(KIND_ALIASES as Record<string, string[]>).flat(),
  attrs: Object.values(ATTR_ALIASES as Record<string, string[]>).flat(),
  isTime: (text) =>
    normalizeTime(text, { reference: "2026-10-12T10:00:00Z", timeZone: "Asia/Kolkata" }).ok,
})

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error("usage: node eval/rule-predict.ts <in.jsonl> <out.jsonl>")
const lines = readFileSync(input, "utf8").split("\n").filter(Boolean)
const out = lines.map((l) => {
  const ex = JSON.parse(l) as { tokens: string[]; offsets: [number, number][] }
  const tokens = ex.tokens.map((text, i) => ({
    text,
    start: ex.offsets[i]?.[0] ?? 0,
    end: ex.offsets[i]?.[1] ?? 0,
  }))
  return JSON.stringify({ ...ex, tags: tagger.tag(tokens).labels })
})
writeFileSync(output, `${out.join("\n")}\n`)
console.log(`${out.length} predictions → ${output}`)
