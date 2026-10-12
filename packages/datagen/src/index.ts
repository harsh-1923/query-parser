// @qp/datagen: Synthetic, role-annotated training and evaluation data generator (PLAN §9).
export { generate, heldOutTemplateIds, labelPieces, normalizeText, serialize } from "./generate"
export type { Lexicons, NamePool } from "./lexicons"
export { loadLexicons } from "./lexicons"
export { mulberry32 } from "./rng"
export type { Template } from "./templates"
export { TEMPLATES } from "./templates"
export { isTime, REFERENCE, TIME_ZONE } from "./time"
export type {
  Example,
  GenerateOptions,
  GenerateResult,
  Split,
  SplitStats,
  Stats,
} from "./types"
