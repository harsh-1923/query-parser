// Convenience wiring for the rule baseline: a tagger whose lexicon comes from the schema.
import { normalizeTime } from "@qp/time"
import { ruleTagger } from "./ruleTagger"
import type { Schema, Tagger } from "./types"

// isTime only asks whether a phrase parses, so any fixed reference works.
const PROBE = { reference: "2026-01-01T00:00:00.000Z", timeZone: "UTC" }

export function ruleTaggerFor(schema: Schema): Tagger {
  return ruleTagger({
    kinds: Object.entries(schema.kinds).flatMap(([k, d]) => [k, ...d.aliases]),
    attrs: Object.values(schema.attrs).flatMap((a) => a.aliases),
    isTime: (text) => normalizeTime(text, { ...PROBE, policies: schema.policies.time }).ok,
  })
}
