// S06 spike: forward pass of the PLAN §6.2 tagger with random weights. Throwaway.
export const ROLES = ["ACTOR", "TIME", "KIND", "ATTR", "TOPIC", "LOC", "SRC", "DEST", "STATE", "NEG", "QUANT"]
export const LABELS = ["O"].concat(ROLES.map((r) => "B-" + r), ROLES.map((r) => "I-" + r))
export const NL = LABELS.length // 23
export const MAX_BYTES = 16
export const MAX_TOKENS = 48

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Format = "f32" | "int8"

export interface Config {
  name: string
  d: number
  layers: number
  heads: number
  ffn: number // hidden width
  db: number // byte embedding width
}

export const CONFIGS: Config[] = [
  { name: "small", d: 48, layers: 2, heads: 2, ffn: 96, db: 16 },
  { name: "medium", d: 64, layers: 2, heads: 4, ffn: 128, db: 16 },
  { name: "large", d: 64, layers: 3, heads: 4, ffn: 256, db: 16 },
  { name: "large-fit", d: 56, layers: 3, heads: 4, ffn: 224, db: 16 },
]

// Linear layer, row-major [out][in]. int8: per-row scale, dequantized inside the matmul.
interface Lin {
  nin: number
  nout: number
  w: Float32Array | null
  q: Int8Array | null
  s: Float32Array | null
  b: Float32Array
}

function makeLin(rng, nin, nout, fmt: Format): Lin {
  const w = new Float32Array(nin * nout)
  const lim = Math.sqrt(3 / nin)
  for (let i = 0; i < w.length; i++) w[i] = (rng() * 2 - 1) * lim
  const b = new Float32Array(nout)
  for (let i = 0; i < nout; i++) b[i] = (rng() * 2 - 1) * 0.02
  if (fmt === "f32") return { nin, nout, w, q: null, s: null, b }
  const q = new Int8Array(nin * nout)
  const s = new Float32Array(nout)
  for (let o = 0; o < nout; o++) {
    let m = 0
    for (let i = 0; i < nin; i++) m = Math.max(m, Math.abs(w[o * nin + i]))
    const sc = m / 127 || 1
    s[o] = sc
    for (let i = 0; i < nin; i++) q[o * nin + i] = Math.round(w[o * nin + i] / sc)
  }
  return { nin, nout, w: null, q, s, b }
}

// y[yo..yo+nout] = W x[xo..xo+nin] + b
function linear(l: Lin, x: Float32Array, xo: number, y: Float32Array, yo: number) {
  const { nin, nout, b } = l
  if (l.w) {
    const w = l.w
    for (let o = 0; o < nout; o++) {
      let acc = 0
      const r = o * nin
      for (let i = 0; i < nin; i++) acc += w[r + i] * x[xo + i]
      y[yo + o] = acc + b[o]
    }
  } else {
    const q = l.q as Int8Array
    const s = l.s as Float32Array
    for (let o = 0; o < nout; o++) {
      let acc = 0
      const r = o * nin
      for (let i = 0; i < nin; i++) acc += q[r + i] * x[xo + i]
      y[yo + o] = acc * s[o] + b[o]
    }
  }
}

function layerNorm(x: Float32Array, o: number, d: number, g: Float32Array, bt: Float32Array, out: Float32Array) {
  let mean = 0
  for (let i = 0; i < d; i++) mean += x[o + i]
  mean /= d
  let v = 0
  for (let i = 0; i < d; i++) {
    const c = x[o + i] - mean
    v += c * c
  }
  const inv = 1 / Math.sqrt(v / d + 1e-5)
  for (let i = 0; i < d; i++) out[o + i] = (x[o + i] - mean) * inv * g[i] + bt[i]
}

function gelu(x: number) {
  return 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)))
}

export function tokenize(q: string): string[] {
  return q.match(/[#@]?[\p{L}\p{N}_]+(?:[-.][\p{L}\p{N}_]+)*|[^\s\p{L}\p{N}_]/gu) ?? []
}

const enc = new TextEncoder()

export interface Model {
  cfg: Config
  fmt: Format
  params: number
  run(tokens: string[]): Int32Array // label ids per token
  logits(tokens: string[]): Float32Array
}

export function buildModel(cfg: Config, fmt: Format, seed = 1234): Model {
  const rng = mulberry32(seed)
  const { d, layers, heads, ffn, db } = cfg
  const dh = d / heads
  let params = 0
  const rand = (n, sc) => {
    const a = new Float32Array(n)
    for (let i = 0; i < n; i++) a[i] = (rng() * 2 - 1) * sc
    params += n
    return a
  }
  const ones = (n) => {
    params += n
    return new Float32Array(n).fill(1)
  }
  const zeros = (n) => {
    params += n
    return new Float32Array(n)
  }
  const lin = (nin, nout) => {
    params += nin * nout + nout
    return makeLin(rng, nin, nout, fmt)
  }

  // Embeddings and conv stay float32 (tiny, and the conv is gathered not matmul'd per row).
  const byteEmb = rand(256 * db, 0.5)
  const conv = lin(3 * db, d) // kernel 3 over db-wide embeddings
  const pos = rand(MAX_TOKENS * d, 0.1)
  const L = []
  for (let l = 0; l < layers; l++) {
    L.push({
      g1: ones(d), b1: zeros(d), qkv: lin(d, 3 * d), o: lin(d, d),
      g2: ones(d), b2: zeros(d), f1: lin(d, ffn), f2: lin(ffn, d),
    })
  }
  const gf = ones(d)
  const bf = zeros(d)
  const head = lin(d, NL)

  // transitions: allowed[prev][cur]; prev = NL means start
  const R = ROLES.length
  const allowed = []
  for (let p = 0; p <= NL; p++) {
    const row = []
    for (let c = 0; c < NL; c++) {
      let ok = true
      if (c > R) {
        // I-X (index R+1..2R) requires prev B-X or I-X
        const role = c - R
        ok = p !== NL && p !== 0 && ((p - 1) % R) + 1 === role
      }
      if (ok) row.push(c)
    }
    allowed.push(Int32Array.from(row))
  }

  // scratch
  const X = new Float32Array(MAX_TOKENS * d)
  const H = new Float32Array(MAX_TOKENS * d)
  const QKV = new Float32Array(MAX_TOKENS * 3 * d)
  const A = new Float32Array(MAX_TOKENS * d)
  const F = new Float32Array(MAX_TOKENS * ffn)
  const P = new Float32Array(MAX_TOKENS * d)
  const LG = new Float32Array(MAX_TOKENS * NL)
  const sc = new Float32Array(MAX_TOKENS)
  const col = new Float32Array(3 * db)
  const cv = new Float32Array(d)
  const embBuf = new Float32Array((MAX_BYTES + 2) * db) // zero padded at both ends
  const ByteBuf = new Uint8Array(MAX_BYTES * 4)
  const dp = new Float32Array(MAX_TOKENS * NL)
  const bp = new Int32Array(MAX_TOKENS * NL)
  const out = new Int32Array(MAX_TOKENS)

  function forward(tokens: string[]): Float32Array {
    const T = Math.min(tokens.length, MAX_TOKENS)
    for (let t = 0; t < T; t++) {
      const { written } = enc.encodeInto(tokens[t], ByteBuf)
      const n = Math.min(written, MAX_BYTES)
      embBuf.fill(0)
      for (let i = 0; i < n; i++) {
        const bo = ByteBuf[i] * db
        const eo = (i + 1) * db
        for (let k = 0; k < db; k++) embBuf[eo + k] = byteEmb[bo + k]
      }
      // conv k=3 + ReLU, max-pool over valid positions
      const pooled = X
      const po = t * d
      for (let k = 0; k < d; k++) pooled[po + k] = -1e30
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3 * db; k++) col[k] = embBuf[i * db + k]
        linear(conv, col, 0, cv, 0)
        for (let k = 0; k < d; k++) {
          const v = cv[k] > 0 ? cv[k] : 0
          if (v > pooled[po + k]) pooled[po + k] = v
        }
      }
      if (n === 0) for (let k = 0; k < d; k++) pooled[po + k] = 0
      for (let k = 0; k < d; k++) X[po + k] += pos[po + k]
    }
    const scale = 1 / Math.sqrt(dh)
    for (let l = 0; l < layers; l++) {
      const ly = L[l]
      for (let t = 0; t < T; t++) layerNorm(X, t * d, d, ly.g1, ly.b1, H)
      for (let t = 0; t < T; t++) linear(ly.qkv, H, t * d, QKV, t * 3 * d)
      for (let h = 0; h < heads; h++) {
        for (let i = 0; i < T; i++) {
          const qo = i * 3 * d + h * dh
          let mx = -1e30
          for (let j = 0; j < T; j++) {
            const ko = j * 3 * d + d + h * dh
            let s = 0
            for (let k = 0; k < dh; k++) s += QKV[qo + k] * QKV[ko + k]
            s *= scale
            sc[j] = s
            if (s > mx) mx = s
          }
          let z = 0
          for (let j = 0; j < T; j++) {
            const e = Math.exp(sc[j] - mx)
            sc[j] = e
            z += e
          }
          const ao = i * d + h * dh
          for (let k = 0; k < dh; k++) A[ao + k] = 0
          for (let j = 0; j < T; j++) {
            const w = sc[j] / z
            const vo = j * 3 * d + 2 * d + h * dh
            for (let k = 0; k < dh; k++) A[ao + k] += w * QKV[vo + k]
          }
        }
      }
      for (let t = 0; t < T; t++) {
        linear(ly.o, A, t * d, P, t * d)
        for (let k = 0; k < d; k++) X[t * d + k] += P[t * d + k]
      }
      for (let t = 0; t < T; t++) layerNorm(X, t * d, d, ly.g2, ly.b2, H)
      for (let t = 0; t < T; t++) {
        linear(ly.f1, H, t * d, F, t * ffn)
        for (let k = 0; k < ffn; k++) F[t * ffn + k] = gelu(F[t * ffn + k])
        linear(ly.f2, F, t * ffn, P, t * d)
        for (let k = 0; k < d; k++) X[t * d + k] += P[t * d + k]
      }
    }
    for (let t = 0; t < T; t++) {
      layerNorm(X, t * d, d, gf, bf, H)
      linear(head, H, t * d, LG, t * NL)
    }
    return LG
  }

  function decode(T: number): Int32Array {
    // log-softmax in place, then constrained Viterbi
    for (let t = 0; t < T; t++) {
      const o = t * NL
      let mx = -1e30
      for (let c = 0; c < NL; c++) if (LG[o + c] > mx) mx = LG[o + c]
      let z = 0
      for (let c = 0; c < NL; c++) z += Math.exp(LG[o + c] - mx)
      const lz = mx + Math.log(z)
      for (let c = 0; c < NL; c++) LG[o + c] -= lz
    }
    for (let t = 0; t < T; t++) {
      for (let c = 0; c < NL; c++) {
        let best = -1e30
        let arg = -1
        if (t === 0) {
          // start state only allows O or B-*
          if (c <= ROLES.length) {
            best = 0
            arg = NL
          }
        } else {
          for (let p = 0; p < NL; p++) {
            const prev = dp[(t - 1) * NL + p]
            if (prev <= -1e29) continue
            const al = allowed[p]
            let ok = false
            for (let i = 0; i < al.length; i++) if (al[i] === c) { ok = true; break }
            if (ok && prev > best) { best = prev; arg = p }
          }
        }
        dp[t * NL + c] = arg < 0 ? -1e30 : best + LG[t * NL + c]
        bp[t * NL + c] = arg
      }
    }
    let bc = 0
    let bv = -1e30
    for (let c = 0; c < NL; c++) if (dp[(T - 1) * NL + c] > bv) { bv = dp[(T - 1) * NL + c]; bc = c }
    for (let t = T - 1; t >= 0; t--) {
      out[t] = bc
      bc = bp[t * NL + bc]
    }
    return out.subarray(0, T)
  }

  return {
    cfg, fmt, params,
    logits: (tokens) => forward(tokens).slice(0, Math.min(tokens.length, MAX_TOKENS) * NL),
    run(tokens) {
      const T = Math.min(tokens.length, MAX_TOKENS)
      if (T === 0) return out.subarray(0, 0)
      forward(tokens)
      return decode(T)
    },
  }
}
