// Public types for @qp/datagen. PLAN §9.
import type { Label } from "@qp/core"

export type Split = "train" | "val" | "test-generated"

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
}

export interface Stats {
  seed: number
  reference: string
  timeZone: string
  splits: Record<Split, SplitStats>
  templates: { total: number; heldOut: number; heldOutIds: string[] }
  contaminationDropped: number
  timeRejected: number
  namesFiltered: number
}

export interface GenerateResult {
  splits: Record<Split, Example[]>
  stats: Stats
}
