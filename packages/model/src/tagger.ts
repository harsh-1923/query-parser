// The BIO tagger's forward pass, ported from training/qp_train/model.py (Tagger, eval mode).
// Pinned to PyTorch by eval/fixtures/model-parity/ (AGENTS rule 6). Math is float64 over float32
// weights; per-query, batch 1, no padding.
import { logSoftmax, marginals, type Transitions, transitions, viterbi } from "./decode"
import type { TaggerManifest, TaggerOutput, TokenFeatures } from "./types"

type Mat = { rows: number; cols: number; data: Float32Array }

export interface ModelTagger {
  manifest: TaggerManifest
  /** True when the model expects TokenFeatures (S7); `run` then requires them. */
  usesFeatures: boolean
  run(tokens: readonly string[], feats?: readonly TokenFeatures[]): TaggerOutput
}

/** Builds a tagger from an exported manifest and its .bin (little-endian float32). */
export function loadTagger(manifest: TaggerManifest, weights: ArrayBuffer): ModelTagger {
  if (manifest.format !== "qp-tagger-f32-v1")
    throw new Error(`unsupported weights format ${manifest.format}`)
  const all = new Float32Array(weights)
  if (all.length !== manifest.params)
    throw new Error(`weights have ${all.length} values, manifest says ${manifest.params}`)
  const tensors = new Map(
    manifest.tensors.map((t) => {
      const size = t.shape.reduce((a, b) => a * b, 1)
      return [t.name, { shape: t.shape, data: all.subarray(t.offset, t.offset + size) }]
    }),
  )
  const vec = (name: string): Float32Array => {
    const t = tensors.get(name)
    if (!t) throw new Error(`missing tensor ${name}`)
    return t.data
  }
  const mat = (name: string): Mat => {
    const t = tensors.get(name)
    if (!t) throw new Error(`missing tensor ${name}`)
    return { rows: t.shape[0] ?? 0, cols: t.data.length / (t.shape[0] ?? 1), data: t.data }
  }

  const { d, d_b: db, layers, heads, feats } = manifest.config
  const { maxTokens, maxBytes, labels } = manifest
  const p = "encoder."
  const byteEmbed = mat(`${p}bytes.embed.weight`)
  const conv = vec(`${p}bytes.conv.weight`) // (db, db, 3)
  const convBias = vec(`${p}bytes.conv.bias`)
  const proj = mat(`${p}bytes.proj.weight`)
  const projBias = vec(`${p}bytes.proj.bias`)
  const pos = mat(`${p}pos.weight`)
  const rule = feats ? mat(`${p}rule.weight`) : null
  const lex = feats ? mat(`${p}lex.weight`) : null // (d, 3)
  const blocks = Array.from({ length: layers }, (_, i) => {
    const b = `${p}blocks.${i}.`
    return {
      ln1: [vec(`${b}ln1.weight`), vec(`${b}ln1.bias`)] as const,
      inProj: mat(`${b}attn.in_proj_weight`),
      inBias: vec(`${b}attn.in_proj_bias`),
      outProj: mat(`${b}attn.out_proj.weight`),
      outBias: vec(`${b}attn.out_proj.bias`),
      ln2: [vec(`${b}ln2.weight`), vec(`${b}ln2.bias`)] as const,
      ff1: mat(`${b}ff.0.weight`),
      ff1Bias: vec(`${b}ff.0.bias`),
      ff2: mat(`${b}ff.2.weight`),
      ff2Bias: vec(`${b}ff.2.bias`),
    }
  })
  const lnFinal = [vec(`${p}ln.weight`), vec(`${p}ln.bias`)] as const
  const head = mat("head.weight")
  const headBias = vec("head.bias")
  const trans: Transitions = transitions(labels)
  const encoder = new TextEncoder()

  function byteVector(token: string): Float64Array {
    const raw = encoder.encode(token).subarray(0, maxBytes)
    const n = raw.length
    if (n === 0) return new Float64Array(d)
    // Embedded bytes (byte + 1; 0 is padding), over the full maxBytes window like PyTorch.
    const x = new Float64Array(maxBytes * db)
    for (let k = 0; k < maxBytes; k++) {
      const id = k < n ? (raw[k] ?? 0) + 1 : 0
      for (let c = 0; c < db; c++) x[k * db + c] = byteEmbed.data[id * db + c] ?? 0
    }
    // Conv1d(kernel 3, padding 1) + ReLU, then max-pool over the real bytes only.
    const pooled = new Float64Array(db).fill(-1e4)
    for (let k = 0; k < n; k++) {
      for (let o = 0; o < db; o++) {
        let s = convBias[o] ?? 0
        for (let j = 0; j < 3; j++) {
          const kk = k + j - 1
          if (kk < 0 || kk >= maxBytes) continue
          for (let c = 0; c < db; c++)
            s += (conv[(o * db + c) * 3 + j] ?? 0) * (x[kk * db + c] ?? 0)
        }
        const r = s > 0 ? s : 0
        if (r > (pooled[o] ?? 0)) pooled[o] = r
      }
    }
    return linear(proj, projBias, pooled)
  }

  function run(tokens: readonly string[], featRows?: readonly TokenFeatures[]): TaggerOutput {
    if (feats && !featRows) throw new Error(`${manifest.name} needs per-token features`)
    const t = Math.min(tokens.length, maxTokens)
    let xs: Float64Array[] = []
    for (let i = 0; i < t; i++) {
      const x = byteVector(tokens[i] ?? "")
      for (let c = 0; c < d; c++) x[c] = (x[c] ?? 0) + (pos.data[i * d + c] ?? 0)
      if (rule && lex && featRows) {
        const f = featRows[i] ?? [0, 0, 0, 0]
        for (let c = 0; c < d; c++)
          x[c] =
            (x[c] ?? 0) +
            (rule.data[f[0] * d + c] ?? 0) +
            (lex.data[c * 3] ?? 0) * f[1] +
            (lex.data[c * 3 + 1] ?? 0) * f[2] +
            (lex.data[c * 3 + 2] ?? 0) * f[3]
      }
      xs.push(x)
    }
    for (const b of blocks) {
      const h = xs.map((x) => layerNorm(x, b.ln1[0], b.ln1[1]))
      const a = attention(h, b.inProj, b.inBias, b.outProj, b.outBias, heads)
      xs = xs.map((x, i) => add(x, a[i] as Float64Array))
      xs = xs.map((x) => {
        const f = linear(b.ff1, b.ff1Bias, layerNorm(x, b.ln2[0], b.ln2[1])).map(gelu)
        return add(x, linear(b.ff2, b.ff2Bias, f))
      })
    }
    const logits = xs.map((x) => linear(head, headBias, layerNorm(x, lnFinal[0], lnFinal[1])))
    const emit = logits.map(logSoftmax)
    const ids = viterbi(emit, trans)
    const marg = marginals(emit, trans)
    const out: TaggerOutput = {
      labels: ids.map((j) => labels[j] ?? "O"),
      confidence: ids.map((j, i) => marg[i]?.[j] ?? 0),
      logits,
    }
    for (let i = t; i < tokens.length; i++) {
      out.labels.push("O")
      out.confidence.push(0)
    }
    return out
  }

  return { manifest, usesFeatures: feats, run }
}

function linear(w: Mat, b: Float32Array, x: Float64Array): Float64Array {
  const y = new Float64Array(w.rows)
  for (let r = 0; r < w.rows; r++) {
    let s = b[r] ?? 0
    const off = r * w.cols
    for (let c = 0; c < w.cols; c++) s += (w.data[off + c] ?? 0) * (x[c] ?? 0)
    y[r] = s
  }
  return y
}

function add(a: Float64Array, b: Float64Array): Float64Array {
  return a.map((v, i) => v + (b[i] ?? 0))
}

function layerNorm(x: Float64Array, g: Float32Array, b: Float32Array): Float64Array {
  let mean = 0
  for (const v of x) mean += v
  mean /= x.length
  let varSum = 0
  for (const v of x) varSum += (v - mean) ** 2
  const inv = 1 / Math.sqrt(varSum / x.length + 1e-5)
  return x.map((v, i) => (v - mean) * inv * (g[i] ?? 1) + (b[i] ?? 0))
}

/** nn.MultiheadAttention (batch_first, no mask: one query, no padding). */
function attention(
  h: Float64Array[],
  inProj: Mat,
  inBias: Float32Array,
  outProj: Mat,
  outBias: Float32Array,
  heads: number,
): Float64Array[] {
  const t = h.length
  const d = outProj.rows
  const hd = d / heads
  const scale = 1 / Math.sqrt(hd)
  const qkv = h.map((x) => linear(inProj, inBias, x)) // [q | k | v], each d wide
  const ctx = h.map(() => new Float64Array(d))
  const scores = new Float64Array(t)
  for (let hh = 0; hh < heads; hh++) {
    const o = hh * hd
    for (let i = 0; i < t; i++) {
      const q = qkv[i] as Float64Array
      let max = Number.NEGATIVE_INFINITY
      for (let j = 0; j < t; j++) {
        const k = qkv[j] as Float64Array
        let s = 0
        for (let c = 0; c < hd; c++) s += (q[o + c] ?? 0) * (k[d + o + c] ?? 0)
        s *= scale
        scores[j] = s
        if (s > max) max = s
      }
      let sum = 0
      for (let j = 0; j < t; j++) {
        const e = Math.exp((scores[j] ?? 0) - max)
        scores[j] = e
        sum += e
      }
      const out = ctx[i] as Float64Array
      for (let j = 0; j < t; j++) {
        const w = (scores[j] ?? 0) / sum
        const v = qkv[j] as Float64Array
        for (let c = 0; c < hd; c++) out[o + c] = (out[o + c] ?? 0) + w * (v[2 * d + o + c] ?? 0)
      }
    }
  }
  return ctx.map((c) => linear(outProj, outBias, c))
}

/** Exact GELU, 0.5·x·(1 + erf(x/√2)), as nn.GELU() computes it. */
function gelu(x: number): number {
  return 0.5 * x * (1 + erf(x / Math.SQRT2))
}

/** erf via erfc's Chebyshev fit (Numerical Recipes erfcc), relative error < 1.2e-7. */
function erf(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    )
  return x >= 0 ? 1 - r : r - 1
}
