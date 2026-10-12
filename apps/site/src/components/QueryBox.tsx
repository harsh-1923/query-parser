import type { TaggedSpan } from "@qp/core"
import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { TONE, TONE_CLASS } from "@/lib/parser"
import { cn } from "@/lib/utils"

/** Highlights spans inline. Used both behind the textarea and in example tiles. */
export function Highlighted({ text, spans }: { text: string; spans: TaggedSpan[] }) {
  const parts: React.ReactNode[] = []
  let at = 0
  for (const s of spans) {
    if (s.start < at) continue
    if (s.start > at) parts.push(text.slice(at, s.start))
    parts.push(
      <mark
        key={`${s.start}-${s.end}`}
        className={cn(
          "rounded-[4px] text-inherit [box-decoration-break:clone]",
          TONE_CLASS[TONE[s.role]],
          s.negated && "line-through decoration-neutral-500",
        )}
      >
        {text.slice(s.start, s.end)}
      </mark>,
    )
    at = s.end
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

/**
 * A wrapping, auto-growing textarea with the highlights drawn in a mirror behind it. Text is 16px
 * so iOS doesn't zoom on focus.
 */
export function QueryBox({
  value,
  spans,
  onChange,
}: {
  value: string
  spans: TaggedSpan[]
  onChange: (v: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [])
  useLayoutEffect(fit)
  // Re-measure once the web font has loaded and whenever the width changes.
  useEffect(() => {
    document.fonts?.ready.then(fit)
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [fit])
  const shared = "px-4 py-3 text-base leading-7 whitespace-pre-wrap break-words"
  return (
    <div className="relative">
      <div
        aria-hidden
        className={cn(shared, "pointer-events-none absolute inset-0 text-transparent")}
      >
        <Highlighted text={value} spans={spans} />{" "}
      </div>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="search"
        aria-label="Search query"
        placeholder="pdfs from utkarsh last week"
        onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className={cn(
          shared,
          "relative block w-full resize-none overflow-hidden bg-transparent caret-foreground outline-none placeholder:text-muted-foreground",
        )}
      />
    </div>
  )
}
