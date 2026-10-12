// Seeded PRNG and small helpers. Nothing in datagen may use Math.random or Date.now.

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable 32-bit hash of a string (FNV-1a), for deriving per-split seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const int = (rng: Rng, n: number): number => Math.floor(rng() * n)

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick from empty list")
  return items[int(rng, items.length)] as T
}

export const chance = (rng: Rng, p: number): boolean => rng() < p

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rng, i + 1)
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return out
}

export function weighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  let total = 0
  for (const [, w] of items) total += w
  let x = rng() * total
  for (const [item, w] of items) {
    x -= w
    if (x < 0) return item
  }
  return (items[items.length - 1] as readonly [T, number])[0]
}

/**
 * Deterministic round-robin over a list: one seeded shuffle, then every value is visited once
 * before any repeats (PLAN §9.2 step 2). Reshuffles between laps.
 */
export class Cycler<T> {
  private order: T[]
  private index = 0
  private readonly rng: Rng
  private readonly items: readonly T[]
  constructor(rng: Rng, items: readonly T[]) {
    if (items.length === 0) throw new Error("Cycler needs at least one item")
    this.rng = rng
    this.items = items
    this.order = shuffle(rng, items)
  }

  next(): T {
    if (this.index >= this.order.length) {
      this.order = shuffle(this.rng, this.items)
      this.index = 0
    }
    return this.order[this.index++] as T
  }
}
