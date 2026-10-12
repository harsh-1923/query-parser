// Messy topic generator (PLAN §9.2): 1-6 words, numbers, versions, acronyms, hyphens, filler words.
// Everything it produces is labelled TOPIC as a whole (eval/ANNOTATION.md).
import { chance, int, pick, type Rng, weighted } from "./rng"
import { type Ctx, cycled } from "./slots"

const ACRONYMS = [
  "sso",
  "oauth",
  "gdpr",
  "pci",
  "kyc",
  "api",
  "sla",
  "ci",
  "ux",
  "sdk",
  "etl",
  "ssl",
  "vpn",
  "rbac",
  "ocr",
  "nps",
  "aws",
  "gcp",
  "dns",
  "cdn",
  "hipaa",
  "saml",
  "ui",
  "ml",
]
const HYPHEN_PREFIX = ["pre", "post", "re", "cross", "non", "multi", "co", "end-to", "auto"]
const VERSION_TAIL = ["final", "copy", "revised", "v2 final"]
const IS_ENDS = [
  "late",
  "wrong",
  "unclear",
  "delayed",
  "broken",
  "slow",
  "confusing",
  "missing",
  "outdated",
]
const WHY_ENDS = ["failed", "dropped", "spiked", "changed", "stalled"]

export const LOOKALIKE_EXTRA = [
  "call center staffing",
  "meeting room booking",
  "slack integration",
  "zoom rollout",
  "email deliverability",
  "image compression",
  "video encoding pipeline",
  "thread pool exhaustion",
  "pdf export",
  "calendar permissions",
  "page load time",
  "chat widget copy",
  "mail merge templates",
  "note taking app",
  "ticket routing rules",
  "bill of materials",
  "grace period policy",
  "mark to market",
  "art direction brief",
  "rose gold campaign",
  "frank feedback",
  "page rank",
  "will template",
  "hunter outreach",
  "sunny day scenarios",
  "jack henry integration",
]

const titleCase = (s: string): string =>
  s.replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())

function shortPhrase(ctx: Ctx): string {
  return chance(ctx.rng, 0.5)
    ? cycled(ctx, "tword", ctx.pools.topicWords)
    : cycled(ctx, "tshort", ctx.pools.shortTopics)
}

function version(rng: Rng, w: string): string {
  const n = 1 + int(rng, 9)
  switch (int(rng, 6)) {
    case 0:
      return `${w} v${n}`
    case 1:
      return `${w} v${n} ${pick(rng, VERSION_TAIL)}`
    case 2:
      return `${w} ${n}.${int(rng, 10)}`
    case 3:
      return `phase ${n} ${w}`
    case 4:
      return `top ${n + 1} ${w}`
    default:
      return `${w} ${pick(rng, ["p99", "5xx", "3ds", "v2"])}`
  }
}

export function messyTopic(ctx: Ctx, short = false): string {
  const { rng, pools } = ctx
  const kind = short
    ? weighted(rng, [
        ["base", 55],
        ["word", 25],
        ["version", 8],
        ["acr", 6],
        ["hyph", 6],
      ] as const)
    : weighted(rng, [
        ["base", 34],
        ["word", 7],
        ["look", 7],
        ["hard", 4],
        ["version", 9],
        ["acr", 7],
        ["hyph", 6],
        ["filler", 17],
        ["long", 9],
      ] as const)
  let text: string
  switch (kind) {
    case "word":
      text = cycled(ctx, "tword", pools.topicWords)
      break
    case "look":
      text = cycled(ctx, "topic-look", pools.lookalikeTopics)
      break
    case "hard":
      text = cycled(ctx, "topic-hard", pools.hardTopics)
      break
    case "version":
      text = version(rng, shortPhrase(ctx))
      break
    case "acr": {
      const a = pick(rng, ACRONYMS)
      const acr = chance(rng, 0.3) ? a.toUpperCase() : a
      text = chance(rng, 0.5) ? `${acr} ${shortPhrase(ctx)}` : `${shortPhrase(ctx)} ${acr}`
      break
    }
    case "hyph":
      text = `${pick(rng, HYPHEN_PREFIX)}-${cycled(ctx, "tword", pools.topicWords)}${
        chance(rng, 0.5) ? ` ${shortPhrase(ctx)}` : ""
      }`
      break
    case "filler": {
      const a = shortPhrase(ctx)
      const b = shortPhrase(ctx)
      switch (int(rng, 8)) {
        case 0:
          text = `${a} for ${b}`
          break
        case 1:
          text = `${a} of ${b}`
          break
        case 2:
          text = `${a} and ${b}`
          break
        case 3:
          text = `${a} vs ${b}`
          break
        case 4:
          text = `${a} to ${b}`
          break
        case 5:
          text = `${a} is ${pick(rng, IS_ENDS)}`
          break
        case 6:
          text = `how to ${a}`
          break
        default:
          text = `why ${a} ${pick(rng, WHY_ENDS)}`
      }
      break
    }
    case "long":
      text = `${shortPhrase(ctx)} ${cycled(ctx, "topic", pools.cleanTopics)}`
      break
    default:
      text = cycled(ctx, "topic", pools.cleanTopics)
  }
  const words = text.split(" ")
  if (words.length > 6) text = words.slice(0, 6).join(" ")
  if (chance(rng, 0.05)) text = titleCase(text)
  return text
}
