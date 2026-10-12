import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { generate, normalizeText, serialize } from "./generate"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback
}

/** Texts from an eval dataset file: .jsonl uses "text", .tsv the first column, others one per line. */
function textsOf(file: string): string[] {
  const raw = readFileSync(file, "utf8")
  const lines = raw.split("\n").filter((l) => l.trim())
  if (file.endsWith(".jsonl")) return lines.map((l) => (JSON.parse(l) as { text: string }).text)
  if (file.endsWith(".tsv"))
    return lines.filter((l) => !l.startsWith("# query\t")).map((l) => l.split("\t")[0] as string)
  if (file.endsWith(".log") || file.endsWith(".md")) return []
  return lines
}

function walk(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

function buildBlocklist(): { set: Set<string>; files: number } {
  const files = [
    join(repoRoot, "spikes/S02-role-coverage/annotations.tsv"),
    ...walk(join(repoRoot, "eval/datasets/llm-written")),
    ...walk(join(repoRoot, "eval/datasets/handwritten")),
  ]
  const set = new Set<string>()
  for (const f of files) for (const t of textsOf(f)) set.add(normalizeText(t))
  return { set, files: files.length }
}

const seed = Number(arg("seed", "42"))
const out = resolve(arg("out", join(repoRoot, "eval/datasets/generated/v0")))
const blocklist = buildBlocklist()
const result = generate({
  seed,
  train: Number(arg("train", "50000")),
  val: Number(arg("val", "2000")),
  test: Number(arg("test", "3000")),
  blocklist: blocklist.set,
})

mkdirSync(out, { recursive: true })
for (const [split, examples] of Object.entries(result.splits)) {
  writeFileSync(join(out, `${split}.jsonl`), serialize(examples))
}
writeFileSync(join(out, "stats.json"), `${JSON.stringify(result.stats, null, 2)}\n`)
console.log(`blocklist: ${blocklist.set.size} texts from ${blocklist.files} files`)
for (const [split, s] of Object.entries(result.stats.splits)) {
  console.log(`${split}: ${s.examples} examples, drops ${JSON.stringify(s.drops)}`)
}
console.log(`wrote ${out}`)
