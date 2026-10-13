// The trained taggers the demo can swap in for the rules. Weights are fetched on first use.
import { type Label, ruleTagger, type Tagger, type Token } from "@qp/core"
import { featurizer, loadTagger, type TaggerManifest } from "@qp/model"
import { normalizeTime } from "@qp/time"
import lexicon from "@/model/s05-lexicon.json"
import baseBin from "../../../../packages/model/weights/s7-base-43.bin?url"
import baseManifest from "../../../../packages/model/weights/s7-base-43.json"
import featBin from "../../../../packages/model/weights/s7-feat-42.bin?url"
import featManifest from "../../../../packages/model/weights/s7-feat-42.json"
import { directory } from "./parser"

export type TaggerChoice = "rules" | "model" | "model-feat"

export interface ModelInfo {
  label: string
  blurb: string
  scores: { s02: number; glm: number }
  results: string
}

const RESULTS = "https://github.com/harsh-1923/query-parser/blob/main/eval/results/s7-dev"

export const MODELS: Record<Exclude<TaggerChoice, "rules">, ModelInfo> = {
  model: {
    label: "Model",
    blurb: "77k-parameter tagger that reads only the characters you type",
    scores: { s02: 0.744, glm: 0.7 },
    results: `${RESULTS}/baseline-43.eval.json`,
  },
  "model-feat": {
    label: "Model + rules",
    blurb:
      "79k-parameter tagger that also reads the rules' labels, kind and state words, and directory names",
    scores: { s02: 0.772, glm: 0.754 },
    results: `${RESULTS}/feat-42.eval.json`,
  },
}

/** What the S7 feature model reads besides the text: the lists it was trained with. */
function features(labels: readonly string[]) {
  return featurizer({
    rules: ruleTagger({
      kinds: lexicon.kinds,
      attrs: lexicon.attrs,
      isTime: (text) =>
        normalizeTime(text, { reference: "2026-01-01T00:00:00.000Z", timeZone: "UTC" }).ok,
    }),
    kinds: lexicon.kinds,
    attrs: lexicon.attrs,
    names: directory.people.flatMap((p) => [...p.name.split(" "), p.handle]),
    labels,
  })
}

const cache = new Map<TaggerChoice, Promise<Tagger>>()

export function loadModel(choice: Exclude<TaggerChoice, "rules">): Promise<Tagger> {
  let p = cache.get(choice)
  if (!p) {
    const [manifest, url] = choice === "model" ? [baseManifest, baseBin] : [featManifest, featBin]
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`weights: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => asTagger(loadTagger(manifest as TaggerManifest, buf)))
    p.catch(() => cache.delete(choice))
    cache.set(choice, p)
  }
  return p
}

function asTagger(model: ReturnType<typeof loadTagger>): Tagger {
  const fz = model.usesFeatures ? features(model.manifest.labels) : null
  return {
    version: model.manifest.name,
    tag(tokens: Token[]) {
      const out = model.run(
        tokens.map((t) => t.text),
        fz?.(tokens),
      )
      // Typed operators are bound before tagging; the model's labels for them are ignored.
      return {
        labels: out.labels.map((l, i) => (tokens[i]?.operator ? "O" : l) as Label),
        confidence: out.confidence,
      }
    },
  }
}
