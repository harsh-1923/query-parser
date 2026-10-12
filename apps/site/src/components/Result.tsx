import type { ParseResult, TimeValue } from "@qp/core"
import { ChevronDown, Info } from "lucide-react"
import { useState } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  channels,
  describeIssue,
  describeTime,
  nameOf,
  people,
  requestFor,
  SELF,
  type Tone,
} from "@/lib/parser"
import { cn } from "@/lib/utils"

/** Line tint per role: a light wash plus a left rule, like a diff. */
const LINE_TONE: Record<Tone, string> = {
  kind: "bg-sky-50 border-sky-300",
  person: "bg-emerald-50 border-emerald-300",
  place: "bg-orange-50 border-orange-300",
  time: "bg-amber-50 border-amber-300",
  attr: "bg-violet-50 border-violet-300",
  order: "bg-pink-50 border-pink-300",
  neg: "bg-red-50 border-red-300",
  topic: "bg-neutral-100 border-neutral-300",
}

const FACET_TONE: Record<string, Tone> = {
  type: "kind",
  from: "person",
  to: "person",
  assignee: "person",
  with: "person",
  mentions: "person",
  in: "place",
  date: "time",
  status: "attr",
  priority: "attr",
  bots: "attr",
  sort: "order",
}

interface Line {
  text: string
  tone?: Tone | undefined
  comment?: string | undefined
}

const isId = (v: unknown): v is string =>
  typeof v === "string" && (people.has(v) || channels.has(v))
const json = (v: unknown) => JSON.stringify(v)

/** One JSON line per key; objects (dates, exclude) open onto their own lines. */
function linesFor(r: ParseResult, tz: string): Line[] {
  const entries: [string, unknown, Tone | undefined][] = [
    ...Object.entries(r.filters).map(([k, v]): [string, unknown, Tone | undefined] => [
      k,
      v,
      FACET_TONE[k],
    ]),
  ]
  if (Object.keys(r.exclude).length) entries.push(["exclude", r.exclude, "neg"])
  entries.push(["text", r.text, "topic"])
  if (r.excludeText.length) entries.push(["excludeText", r.excludeText, "neg"])

  const out: Line[] = [{ text: "{" }]
  entries.forEach(([key, value, tone], i) => {
    const comma = i < entries.length - 1 ? "," : ""
    const names = (v: unknown) => (Array.isArray(v) ? v : [v]).filter(isId).map(nameOf).join(", ")
    if (key === "date") {
      const t = value as TimeValue
      const order = ["from", "to", "granularity"]
      const inner = Object.entries(t).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      out.push({ text: `  "date": {`, tone, comment: describeTime(t, tz) })
      inner.forEach(([k, v], j) => {
        out.push({ text: `    "${k}": ${json(v)}${j < inner.length - 1 ? "," : ""}`, tone })
      })
      out.push({ text: `  }${comma}`, tone })
    } else if (key === "exclude") {
      const inner = Object.entries(value as Record<string, unknown>)
      out.push({ text: `  "exclude": {`, tone })
      inner.forEach(([k, v], j) => {
        out.push({
          text: `    "${k}": ${json(v)}${j < inner.length - 1 ? "," : ""}`,
          tone,
          comment: names(v),
        })
      })
      out.push({ text: `  }${comma}`, tone })
    } else {
      out.push({ text: `  "${key}": ${json(value)}${comma}`, tone, comment: names(value) })
    }
  })
  out.push({ text: "}" })
  return out
}

function JsonView({ result, tz }: { result: ParseResult; tz: string }) {
  return (
    <pre className="overflow-hidden rounded-lg border bg-white py-2 font-mono text-[11.5px] leading-6 sm:text-[12.5px]">
      {linesFor(result, tz).flatMap((l, i) => {
        const indent = l.text.match(/^ */)?.[0] ?? ""
        const row = (text: string, muted: boolean, key: string) => (
          <div
            key={key}
            className={cn(
              "border-l-2 border-transparent px-3 whitespace-pre-wrap [overflow-wrap:anywhere]",
              l.tone && LINE_TONE[l.tone],
              muted && "text-muted-foreground",
            )}
          >
            {text}
          </div>
        )
        // Comments sit on their own line above the key, so narrow screens wrap them cleanly.
        return l.comment
          ? [row(`${indent}// ${l.comment}`, true, `${i}c`), row(l.text, false, `${i}`)]
          : [row(l.text, false, `${i}`)]
      })}
    </pre>
  )
}

export function Result({ result, tz }: { result: ParseResult; tz: string }) {
  const [open, setOpen] = useState(false)
  const excludes = Object.keys(result.exclude).length > 0
  return (
    <div className="space-y-3 px-4 pt-3 pb-4">
      <JsonView result={result} tz={tz} />

      {(result.issues.length > 0 || excludes) && (
        <ul className="space-y-1.5 text-[13px] text-muted-foreground">
          {result.issues.map((i) => (
            <li key={describeIssue(i)} className="flex gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{describeIssue(i)}</span>
            </li>
          ))}
          {excludes && (
            <li className="flex gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Xyne Spaces' search API can't exclude filters yet, so the request leaves the “not”
                out.
              </span>
            </li>
          )}
        </ul>
      )}

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          Xyne Spaces request
        </CollapsibleTrigger>
        <CollapsibleContent>
          <code className="mt-2 block rounded-md bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed break-all">
            {requestFor(result)}
          </code>
        </CollapsibleContent>
      </Collapsible>

      <p className="text-[11px] text-muted-foreground">Signed in as {people.get(SELF)?.name}</p>
    </div>
  )
}
