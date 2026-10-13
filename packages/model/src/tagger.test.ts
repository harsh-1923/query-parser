import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { loadTagger } from "./tagger"
import type { TaggerManifest, TokenFeatures } from "./types"

// eval/fixtures/model-parity/<name>.json is written by training/qp_train/export.py from PyTorch.
const root = new URL("../../../", import.meta.url)
const fixtures = new URL("eval/fixtures/model-parity/", root)
const weights = new URL("packages/model/weights/", root)

interface Case {
  tokens: string[]
  feats?: TokenFeatures[]
  logits: number[][]
  tags: string[]
  confidence: number[]
}

for (const file of readdirSync(fixtures).filter((f) => f.endsWith(".json"))) {
  const name = file.replace(/\.json$/, "")
  describe(`parity with PyTorch: ${name}`, () => {
    const manifest = JSON.parse(
      readFileSync(new URL(`${name}.json`, weights), "utf8"),
    ) as TaggerManifest
    const bin = readFileSync(new URL(`${name}.bin`, weights))
    const tagger = loadTagger(
      manifest,
      bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    )
    const { cases } = JSON.parse(readFileSync(new URL(file, fixtures), "utf8")) as {
      cases: Case[]
    }

    it("reproduces logits, tags and confidences", () => {
      let maxDiff = 0
      for (const c of cases) {
        const out = tagger.run(c.tokens, c.feats)
        expect(out.labels, c.tokens.join(" ")).toEqual(c.tags)
        for (const [i, row] of c.logits.entries())
          for (const [j, v] of row.entries())
            maxDiff = Math.max(maxDiff, Math.abs((out.logits[i]?.[j] ?? 0) - v))
        for (const [i, p] of out.confidence.entries())
          expect(p).toBeCloseTo(c.confidence[i] ?? 0, 3)
      }
      expect(maxDiff).toBeLessThan(1e-3)
    })

    it("returns nothing for a query with no tokens", () => {
      const feats = tagger.usesFeatures ? [] : undefined
      expect(tagger.run([], feats)).toEqual({ labels: [], confidence: [], logits: [] })
    })
  })
}
