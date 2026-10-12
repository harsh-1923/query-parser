// "Bag of slots" template family: sample 2-5 slot units and shuffle their order. Cue words travel
// with the slot they govern, so every role lands at the start, middle and end of queries.
// A plan (unit types, order, cue flags) is drawn first; its signature decides whether it is a
// held-out shape (test-generated only) before any names or topics are consumed.
import { chance, hashString, pick, type Rng, shuffle, weighted } from "./rng"
import { type Ctx, fillSlot, type Piece } from "./slots"

type UnitType =
  | "KIND"
  | "TOPIC"
  | "ACTOR"
  | "TIME"
  | "ATTR"
  | "CONTAINER"
  | "NEG"
  | "ORDER"
  | "RECIPIENT"
  | "PARTICIPANT"
  | "MENTION"

interface Unit {
  type: UnitType
  cue: boolean
  /** NEG: what is negated. ORDER: "post" (tail unit). */
  sub?: string
  /** KIND flags: o=order prefix, p=possessive actor, m="my", t=pre-topic, k=second kind, d=det. */
  flags?: string
  /** ACTOR variant */
  variant?: string
}

export interface BagPlan {
  units: Unit[]
  signature: string
}

/** Presence weights per unit type; tuned so the overall per-role rates match PLAN §9.2 step 2. */
export const TYPE_WEIGHTS: [UnitType, number][] = [
  ["KIND", 21],
  ["TOPIC", 38],
  ["ACTOR", 10],
  ["TIME", 13],
  ["ATTR", 9],
  ["CONTAINER", 3.2],
  ["NEG", 2.5],
  ["ORDER", 2.5],
  ["RECIPIENT", 2.5],
  ["PARTICIPANT", 1],
  ["MENTION", 1],
]
const COUNT_WEIGHTS: [number, number][] = [
  [2, 58],
  [3, 27],
  [4, 11],
  [5, 4],
]
const NEG_SUBS: [string, number][] = [
  ["ATTR", 38],
  ["KIND", 14],
  ["ACTOR", 22],
  ["CONTAINER", 10],
  ["TOPIC", 16],
]

const FROM_CUES = [
  "from",
  "by",
  "from",
  "by",
  "sent by",
  "shared by",
  "created by",
  "written by",
  "posted by",
  "uploaded by",
  "owned by",
]
const TO_CUES = ["to", "sent to", "assigned to", "addressed to", "for"]
const WITH_CUES = ["with", "involving", "with", "between"]
const MENT_CUES = ["mentioning", "tagging", "that mention", "that tag"]
const TOPIC_CUES = ["about", "about", "on", "regarding", "re", "related to", "concerning", "for"]
const ATTR_CUES = ["that are", "which are", "marked", "currently", "still", "that are"]

export function drawPlan(rng: Rng, wantHeldOut: boolean): BagPlan | undefined {
  for (let attempt = 0; attempt < 60; attempt++) {
    const plan = tryPlan(rng)
    if (isHeldOutSignature(plan.signature) === wantHeldOut) return plan
  }
  return undefined
}

export const isHeldOutSignature = (sig: string): boolean => hashString(sig) % 5 === 0

function sampleTypes(rng: Rng, n: number): UnitType[] {
  const pool = TYPE_WEIGHTS.slice()
  const out: UnitType[] = []
  while (out.length < n && pool.length) {
    const t = weighted(rng, pool)
    out.push(t)
    pool.splice(
      pool.findIndex(([x]) => x === t),
      1,
    )
  }
  return out
}

function tryPlan(rng: Rng): BagPlan {
  const n = weighted(rng, COUNT_WEIGHTS)
  const types = sampleTypes(rng, n)
  const has = (t: UnitType): boolean => types.includes(t)
  const units: Unit[] = []
  let postOrder = false
  let preOrder = has("ORDER")
  if (preOrder && chance(rng, 0.3)) {
    postOrder = true
    preOrder = false
  }
  const hasKind = has("KIND")
  const hasTopic = has("TOPIC")
  const possDone = hasKind && has("ACTOR") && chance(rng, 0.18)
  const possMy = possDone && chance(rng, 0.25)
  for (const type of types) {
    switch (type) {
      case "KIND": {
        let flags = ""
        if (preOrder) flags += "o"
        if (possDone) flags += possMy ? "m" : "p"
        if (chance(rng, 0.22)) flags += "t"
        if (chance(rng, 0.09)) flags += "k"
        if (!preOrder && chance(rng, 0.08)) flags += "d"
        units.push({ type, cue: false, flags })
        break
      }
      case "TOPIC":
        units.push({ type, cue: chance(rng, 0.4), flags: preOrder && !hasKind ? "o" : "" })
        break
      case "ACTOR":
        if (possDone) break
        units.push({
          type,
          cue: true,
          variant: chance(rng, 0.09) ? "me" : chance(rng, 0.18) ? "bare" : "cue",
        })
        break
      case "ATTR":
        units.push({ type, cue: chance(rng, 0.12) })
        break
      case "CONTAINER":
        units.push({ type, cue: chance(rng, 0.65) })
        break
      case "NEG":
        units.push({ type, cue: true, sub: weighted(rng, NEG_SUBS) })
        break
      case "ORDER":
        if (postOrder || (preOrder && !hasKind && !hasTopic)) {
          units.push({ type, cue: false, sub: "post" })
          postOrder = false
          preOrder = false
        }
        break
      default:
        units.push({ type, cue: true })
    }
  }
  // bare ACTORs are only allowed first, last or touching a KIND unit
  let order = shuffle(
    rng,
    units.filter((u) => u.sub !== "post"),
  )
  const tails = units.filter((u) => u.sub === "post")
  for (let k = 0; k < 8; k++) {
    const bad = order.some((u, i) => {
      if (u.variant !== "bare") return false
      if (i === 0 || i === order.length - 1) return false
      return order[i - 1]?.type !== "KIND" && order[i + 1]?.type !== "KIND"
    })
    if (!bad) break
    order = shuffle(rng, order)
  }
  order = order.map((u) =>
    u.variant === "bare" &&
    order.indexOf(u) !== 0 &&
    order.indexOf(u) !== order.length - 1 &&
    order[order.indexOf(u) - 1]?.type !== "KIND" &&
    order[order.indexOf(u) + 1]?.type !== "KIND"
      ? { ...u, variant: "cue" }
      : u,
  )
  order.push(...tails)
  const signature = order
    .map(
      (u) =>
        `${u.type}${u.sub ? `:${u.sub}` : ""}${u.flags ?? ""}${u.variant === "bare" ? "~" : ""}${u.cue ? "+" : ""}`,
    )
    .join(" ")
  return { units: order, signature }
}

const o = (text: string): Piece => ({ text, role: null })

function orderPieces(ctx: Ctx): Piece[] {
  const [order] = fillSlot(ctx, "ORDER", [])
  if (!order) return []
  const out: Piece[] = [order]
  if (order.text === "latest version") out.push(o(pick(ctx.rng, ["of the", "of the", "of"])))
  return out
}

function negated(ctx: Ctx, sub: string): Piece[] {
  const { rng } = ctx
  switch (sub) {
    case "ATTR":
      return [...fillSlot(ctx, "NEG", ["attr"]), ...fillSlot(ctx, "ATTR", ["neg"])]
    case "KIND":
      return [
        ...fillSlot(ctx, "NEG", [chance(rng, 0.5) ? "topic" : ""]),
        ...fillSlot(ctx, "KIND", []),
      ]
    case "ACTOR":
      return [
        ...fillSlot(ctx, "NEG", ["from"]),
        o(pick(rng, ["from", "by", "from"])),
        ...fillSlot(ctx, "ACTOR", chance(rng, 0.4) ? ["multi"] : ["person"]),
      ]
    case "CONTAINER":
      return [...fillSlot(ctx, "NEG", ["from"]), ...fillSlot(ctx, "CONTAINER", ["bare"])]
    default:
      return [
        ...fillSlot(ctx, "NEG", ["topic"]),
        ...(chance(rng, 0.5) ? [o(pick(rng, ["about", "on"]))] : []),
        ...fillSlot(ctx, "TOPIC", []),
      ]
  }
}

export function fillPlan(ctx: Ctx, plan: BagPlan): Piece[] | undefined {
  const { rng } = ctx
  const out: Piece[] = []
  for (const u of plan.units) {
    const f = u.flags ?? ""
    switch (u.type) {
      case "KIND": {
        if (f.includes("d")) out.push(o(pick(rng, ["the", "the", "that", "those", "all the"])))
        if (f.includes("o")) out.push(...orderPieces(ctx))
        if (f.includes("m")) out.push(...fillSlot(ctx, "ACTOR", ["my"]))
        if (f.includes("p")) out.push(...fillSlot(ctx, "ACTOR", ["poss"]))
        if (f.includes("t")) out.push(...fillSlot(ctx, "TOPIC", ["short"]))
        out.push(...fillSlot(ctx, "KIND", []))
        if (f.includes("k")) out.push(...fillSlot(ctx, "KIND", []))
        break
      }
      case "TOPIC":
        if (f.includes("o")) out.push(...orderPieces(ctx))
        if (u.cue) out.push(o(pick(rng, TOPIC_CUES)))
        out.push(...fillSlot(ctx, "TOPIC", []))
        break
      case "ACTOR":
        if (u.variant === "me") {
          out.push(o(pick(rng, ["from", "by", "sent by", "shared by"])))
          out.push(...fillSlot(ctx, "ACTOR", ["me"]))
        } else {
          if (u.variant !== "bare") out.push(o(pick(rng, FROM_CUES)))
          out.push(...fillSlot(ctx, "ACTOR", chance(rng, 0.2) ? ["multi"] : []))
        }
        break
      case "TIME": {
        const t = fillSlot(ctx, "TIME", [])
        if (t.length === 0) return undefined
        out.push(...t)
        break
      }
      case "ATTR":
        if (u.cue) out.push(o(pick(rng, ATTR_CUES)))
        out.push(...fillSlot(ctx, "ATTR", []))
        break
      case "CONTAINER":
        out.push(...fillSlot(ctx, "CONTAINER", u.cue ? [] : ["bare"]))
        break
      case "NEG":
        out.push(...negated(ctx, u.sub as string))
        break
      case "ORDER":
        out.push(...fillSlot(ctx, "ORDER", ["post"]))
        break
      case "RECIPIENT":
        out.push(o(pick(rng, TO_CUES)))
        out.push(...fillSlot(ctx, "RECIPIENT", chance(rng, 0.15) ? ["me"] : []))
        break
      case "PARTICIPANT":
        out.push(o(pick(rng, WITH_CUES)))
        out.push(...fillSlot(ctx, "PARTICIPANT", chance(rng, 0.7) ? ["person"] : []))
        break
      case "MENTION":
        out.push(o(pick(rng, MENT_CUES)))
        out.push(...fillSlot(ctx, "MENTION", chance(rng, 0.7) ? ["person"] : []))
        break
    }
  }
  return out
}
