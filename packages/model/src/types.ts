/** The JSON half of an exported tagger (training/qp_train/export.py). */
export interface TaggerManifest {
  name: string
  format: "qp-tagger-f32-v1"
  config: {
    config_name: string
    d: number
    d_b: number
    layers: number
    heads: number
    ffn: number
    feats: boolean
    seed?: number
  }
  maxTokens: number
  maxBytes: number
  labels: string[]
  params: number
  bestEpoch?: number
  valSpanF1?: number
  note?: string
  tensors: { name: string; shape: number[]; offset: number }[]
}

/**
 * Per-token runtime features for a tagger trained with them (S7):
 * [ruleLabelId + 1 (0 = missing), kindAlias, attrAlias, directoryName].
 */
export type TokenFeatures = [number, number, number, number]

export interface TaggerOutput {
  /** Constrained-Viterbi labels, one per input token. Tokens past `maxTokens` are "O". */
  labels: string[]
  /** Posterior probability of each chosen label (forward-backward), 0..1. */
  confidence: number[]
  /** Raw per-token label scores, before log-softmax. */
  logits: Float64Array[]
}
