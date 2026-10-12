import { readFileSync } from "node:fs"

export interface NamePool {
  first: string[]
  last: string[]
}

export interface Lexicons {
  /** canonical kind id -> singular aliases */
  kinds: Record<string, string[]>
  attrs: Record<string, string[]>
  names: Record<string, { train: NamePool; test: NamePool }>
  topics: string[]
  containers: string[]
  groups: string[]
  relational: string[]
}

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../lexicons/${name}.json`, import.meta.url), "utf8"))

export function loadLexicons(): Lexicons {
  const items = (name: string): string[] => (read(name) as { items: string[] }).items
  return {
    kinds: (read("kinds") as { aliases: Record<string, string[]> }).aliases,
    attrs: (read("attrs") as { aliases: Record<string, string[]> }).aliases,
    names: (read("names") as { origins: Lexicons["names"] }).origins,
    topics: items("topics"),
    containers: items("containers"),
    groups: items("groups"),
    relational: items("relational"),
  }
}
