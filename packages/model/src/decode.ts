// Constrained BIO decoding, ported from training/qp_train/decoding.py: I-X may only follow B-X or
// I-X, and a sequence cannot start with I-*.

const NEG = -1e9

export interface Transitions {
  trans: Float64Array // c*c, [prev * c + next], 0 if legal else NEG
  start: Float64Array // c
}

export function transitions(labels: readonly string[]): Transitions {
  const c = labels.length
  const trans = new Float64Array(c * c).fill(NEG)
  const start = new Float64Array(c).fill(NEG)
  labels.forEach((next, j) => {
    const inside = next.startsWith("I-")
    if (!inside) start[j] = 0
    labels.forEach((prev, i) => {
      if (!inside || (prev !== "O" && prev.slice(2) === next.slice(2))) trans[i * c + j] = 0
    })
  })
  return { trans, start }
}

export function logSoftmax(row: Float64Array): Float64Array {
  let max = Number.NEGATIVE_INFINITY
  for (const v of row) if (v > max) max = v
  let sum = 0
  for (const v of row) sum += Math.exp(v - max)
  const lse = max + Math.log(sum)
  return row.map((v) => v - lse)
}

function logSumExp(xs: Float64Array): number {
  let max = Number.NEGATIVE_INFINITY
  for (const v of xs) if (v > max) max = v
  if (max === Number.NEGATIVE_INFINITY) return max
  let sum = 0
  for (const v of xs) sum += Math.exp(v - max)
  return max + Math.log(sum)
}

/** Best legal tag sequence for one query. `emit` holds log-probabilities per token. */
export function viterbi(emit: Float64Array[], { trans, start }: Transitions): number[] {
  const t = emit.length
  if (t === 0) return []
  const c = start.length
  let alpha = start.map((s, j) => s + (emit[0]?.[j] ?? 0))
  const back: Int32Array[] = []
  for (let i = 1; i < t; i++) {
    const next = new Float64Array(c)
    const arg = new Int32Array(c)
    for (let j = 0; j < c; j++) {
      let best = Number.NEGATIVE_INFINITY
      let bestK = 0
      for (let k = 0; k < c; k++) {
        const s = (alpha[k] ?? 0) + (trans[k * c + j] ?? 0)
        if (s > best) {
          best = s
          bestK = k
        }
      }
      next[j] = best + (emit[i]?.[j] ?? 0)
      arg[j] = bestK
    }
    alpha = next
    back.push(arg)
  }
  let cur = argmax(alpha)
  const out = new Array<number>(t)
  out[t - 1] = cur
  for (let i = t - 1; i > 0; i--) {
    cur = back[i - 1]?.[cur] ?? 0
    out[i - 1] = cur
  }
  return out
}

/** P(tag_i = j | input) under the constrained transitions (forward-backward). */
export function marginals(emit: Float64Array[], { trans, start }: Transitions): Float64Array[] {
  const t = emit.length
  if (t === 0) return []
  const c = start.length
  const alphas: Float64Array[] = [start.map((s, j) => s + (emit[0]?.[j] ?? 0))]
  const tmp = new Float64Array(c)
  for (let i = 1; i < t; i++) {
    const prev = alphas[i - 1] as Float64Array
    const a = new Float64Array(c)
    for (let j = 0; j < c; j++) {
      for (let k = 0; k < c; k++) tmp[k] = (prev[k] ?? 0) + (trans[k * c + j] ?? 0)
      a[j] = logSumExp(tmp) + (emit[i]?.[j] ?? 0)
    }
    alphas.push(a)
  }
  const betas: Float64Array[] = new Array(t)
  betas[t - 1] = new Float64Array(c)
  for (let i = t - 2; i >= 0; i--) {
    const nb = betas[i + 1] as Float64Array
    const b = new Float64Array(c)
    for (let k = 0; k < c; k++) {
      for (let j = 0; j < c; j++)
        tmp[j] = (trans[k * c + j] ?? 0) + (emit[i + 1]?.[j] ?? 0) + (nb[j] ?? 0)
      b[k] = logSumExp(tmp)
    }
    betas[i] = b
  }
  const logZ = logSumExp(alphas[t - 1] as Float64Array)
  return alphas.map((a, i) => a.map((v, j) => Math.exp(v + (betas[i]?.[j] ?? 0) - logZ)))
}

export function argmax(xs: ArrayLike<number>): number {
  let best = 0
  for (let i = 1; i < xs.length; i++) if ((xs[i] ?? 0) > (xs[best] ?? 0)) best = i
  return best
}
