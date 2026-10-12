import { readFileSync } from "node:fs"

const labels = (
  JSON.parse(
    readFileSync(new URL("../../../eval/fixtures/labels.json", import.meta.url), "utf8"),
  ) as { labels: string[] }
).labels

export const LABELS_FOR_TEST = new Set(labels)
