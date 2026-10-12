// Builds a seeded person-name pool from public, permissively licensed sources and splits it into
// disjoint train/test pools, so evaluation always uses names the model never saw.
//
// Sources:
//   - ByteBaker/indian-names (BSD-3-Clause): modern Indian first and last names
//     https://github.com/ByteBaker/indian-names
//   - @faker-js/faker (MIT) locale data: en_IN plus Latin-script locales for non-Indian names
//
// Deliberately NOT used: philipperemy/name-dataset, which is derived from the 2021 Facebook
// account leak.
//
// Usage: node build-names.mjs [seed] > out/names.json

import { readFileSync, existsSync } from "node:fs"
import { allLocales } from "@faker-js/faker"

const seed = Number(process.argv[2] ?? 42)

// Mulberry32: small seeded PRNG, so the same seed gives the same pool.
function prng(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = prng(seed)
const shuffle = (xs) => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const clean = (s) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
const valid = (s) => /^[a-z][a-z'-]{1,15}$/.test(s)
const flat = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}).flat())

const lines = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").map(clean) : [])

/** origin → { first: Set, last: Set } */
const pools = new Map()
const add = (origin, first, last) => {
  const p = pools.get(origin) ?? { first: new Set(), last: new Set() }
  for (const n of first.map(clean)) if (valid(n)) p.first.add(n)
  for (const n of last.map(clean)) if (valid(n)) p.last.add(n)
  pools.set(origin, p)
}

add("indian", [...lines("first.male.names"), ...lines("first.female.names")], lines("last.names"))
const inP = allLocales.en_IN.person
add("indian", flat(inP.first_name), flat(inP.last_name))

const latin = { en: "english", de: "german", fr: "french", es: "spanish", nl: "dutch", pl: "polish", tr: "turkish", pt_BR: "portuguese" }
for (const [loc, origin] of Object.entries(latin)) {
  const p = allLocales[loc].person
  add(origin, flat(p.first_name), flat(p.last_name))
}

// Remove first names that collide across origins or with common English words that appear in
// queries ("will", "mark", "may", "june", "grace"...): they make labels ambiguous, and S3
// measures those separately on purpose.
const STOP = new Set(
  "will mark may june grace hope joy faith summer art bill pat sunny rose amber dawn april august ray chase bob jack max sky lane page".split(
    " ",
  ),
)

const out = { seed, sources: ["ByteBaker/indian-names@BSD-3", "@faker-js/faker@MIT"], origins: {} }
for (const [origin, { first, last }] of pools) {
  const f = shuffle([...first].filter((n) => !STOP.has(n)).sort())
  const l = shuffle([...last].sort())
  const cut = (xs) => Math.floor(xs.length * 0.8)
  out.origins[origin] = {
    train: { first: f.slice(0, cut(f)), last: l.slice(0, cut(l)) },
    test: { first: f.slice(cut(f)), last: l.slice(cut(l)) },
  }
}

const stats = Object.fromEntries(
  Object.entries(out.origins).map(([o, s]) => [
    o,
    `train ${s.train.first.length}/${s.train.last.length} · test ${s.test.first.length}/${s.test.last.length}`,
  ]),
)
console.error(stats)
process.stdout.write(`${JSON.stringify(out)}\n`)
