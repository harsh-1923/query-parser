// Public types for @qp/datagen. PLAN §9.
import type { Label } from "@qp/core"
import type { ParaphraseRecord } from "./paraphrase"

export type Split = "train" | "val" | "test-generated" | "test-seen-templates-unseen-names"

/** One line of a BIO JSONL file (eval/fixtures/README.md). */
export interface Example {
  text: string
  tokens: string[]
  offsets: [number, number][]
  tags: Label[]
  source: string
  seed?: number
}

export interface GenerateOptions {
  seed: number
  train: number
  val: number
  test: number
  /** Size of test-seen-templates-unseen-names (training templates, test-pool names). Default 0. */
  testSeen?: number
  /** Raw paraphrase records (PLAN §9.2 step 4). Aligned ones are added to train only. */
  paraphrases?: ParaphraseRecord[]
  /** Normalized texts that generated examples must not equal (eval sets). */
  blocklist?: ReadonlySet<string>
}

export interface SplitStats {
  examples: number
  perTemplate: Record<string, number>
  perRole: Record<string, number>
  uniqueNames: number
  namePoolSize: number
  drops: Record<string, number>
  /** Fraction of examples containing each role (template-generated examples only). */
  queryRates: Record<string, number>
  /** Fraction of examples from template:none_* generators. */
  negativeRate: number
  /** Distinct bag-of-slots signatures used. */
  bagSignatures: number
}

export interface ParaphraseStats {
  records: number
  kept: number
  echoed: number
  dropped: Record<string, number>
  /** Per-role query rates over train including paraphrases and echoes. */
  trainQueryRatesWithParaphrases: Record<string, number>
}

export interface Stats {
  seed: number
  reference: string
  timeZone: string
  splits: Record<Split, SplitStats>
  templates: {
    total: number
    heldOut: number
    heldOutIds: string[]
    bagSignatureHeldOutRule: string
  }
  paraphrases: ParaphraseStats
  contaminationDropped: number
  timeRejected: number
  namesFiltered: number
}

export interface GenerateResult {
  splits: Record<Split, Example[]>
  stats: Stats
}
