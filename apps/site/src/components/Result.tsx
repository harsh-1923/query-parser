import type { ParseResult } from "@qp/core"
import { ChevronDown, Info } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  CLOCK,
  chipValue,
  DAY,
  describeIssue,
  FACET_LABEL,
  fmt,
  people,
  requestFor,
  SELF,
} from "@/lib/parser"
import { cn } from "@/lib/utils"

const CHIP_TONE: Record<string, string> = {
  type: "bg-sky-50 border-sky-200",
  date: "bg-amber-50 border-amber-200",
  in: "bg-orange-50 border-orange-200",
  status: "bg-violet-50 border-violet-200",
  priority: "bg-violet-50 border-violet-200",
  sort: "bg-pink-50 border-pink-200",
}
const PERSON_FACETS = new Set(["from", "to", "assignee", "with", "mentions"])

function Chips({
  bag,
  tz,
  negated,
}: {
  bag: Record<string, unknown>
  tz: string
  negated?: boolean
}) {
  return Object.entries(bag).map(([facet, value]) => (
    <Badge
      key={`${negated ? "not-" : ""}${facet}`}
      variant="outline"
      className={cn(
        "h-auto max-w-full gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-normal whitespace-normal text-foreground",
        PERSON_FACETS.has(facet) ? "border-emerald-200 bg-emerald-50" : CHIP_TONE[facet],
        negated && "border-red-200 bg-red-50",
      )}
    >
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {negated ? "Not " : ""}
        {FACET_LABEL[facet] ?? facet}
      </span>
      <span className="break-words">{chipValue(facet, value, tz)}</span>
    </Badge>
  ))
}

export function Result({ result, tz }: { result: ParseResult; tz: string }) {
  const [open, setOpen] = useState(false)
  const hasFilters = Object.keys(result.filters).length + Object.keys(result.exclude).length > 0
  const ref = result.meta.reference
  return (
    <div className="space-y-3 px-4 pt-3 pb-4">
      <div className="flex flex-wrap gap-1.5">
        {hasFilters ? (
          <>
            <Chips bag={result.filters as Record<string, unknown>} tz={tz} />
            <Chips bag={result.exclude as Record<string, unknown>} tz={tz} negated />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            No filters. Everything is search text.
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-3 text-sm">
        <span className="shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Search text
        </span>
        <span className="min-w-0 break-words">
          {result.text ? <mark className="rounded bg-neutral-100 px-0.5">{result.text}</mark> : "—"}
          {result.excludeText.length > 0 && (
            <>
              {" "}
              <span className="text-muted-foreground">minus</span>{" "}
              <mark className="rounded bg-red-50 px-0.5 line-through">
                {result.excludeText.join(", ")}
              </mark>
            </>
          )}
        </span>
      </div>

      {(result.issues.length > 0 || Object.keys(result.exclude).length > 0) && (
        <ul className="space-y-1.5 text-[13px] text-muted-foreground">
          {result.issues.map((i) => (
            <li key={describeIssue(i)} className="flex gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{describeIssue(i)}</span>
            </li>
          ))}
          {Object.keys(result.exclude).length > 0 && (
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

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Relative to {fmt(ref, tz, DAY)}, {fmt(ref, tz, CLOCK)} · {tz} · signed in as{" "}
        {people.get(SELF)?.name} · {result.meta.tookMs.toFixed(2)} ms
      </p>
    </div>
  )
}
