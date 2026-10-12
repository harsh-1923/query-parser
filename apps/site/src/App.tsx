import { ArrowUpRight } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { Directory } from "@/components/Directory"
import { Highlighted, QueryBox } from "@/components/QueryBox"
import { Result } from "@/components/Result"
import { SettingsPanel } from "@/components/SettingsPanel"
import { Card } from "@/components/ui/card"
import { LEGEND, parse, type Settings, TONE_CLASS, ZONES } from "@/lib/parser"
import { cn } from "@/lib/utils"

declare const __COMMIT__: string

const EXAMPLES: [string, string][] = [
  ["The headline", "pdfs from utkarsh last week about sync engine"],
  ["Ticket triage", "open p1 bugs assigned to me"],
  ["Two people, one channel", "messages from ankit or neha in #payments-ops"],
  ["Negation", "decks not from rahul verma"],
  ["An ambiguous name", "files from rahul"],
  ["A spelling the directory lacks", "sheets from utkarash yesterday"],
  ["Sorting", "latest transcripts with priya iyer"],
  ["Typed operators", "type:bug from:sneha flaky checkout"],
  ["Clock time", "#eng-alerts since yesterday 2am"],
  ["A name with no cue word", "meera canvas api rate limits"],
  ["Nothing to extract", "how do refunds work"],
]

const REPO = "https://github.com/harsh-1923/query-parser"

function Section({
  title,
  sub,
  children,
}: {
  title: string
  sub: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-16">
      <h2 className="text-center text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mx-auto mt-1 mb-5 max-w-sm text-center text-sm text-balance text-muted-foreground">
        {sub}
      </p>
      {children}
    </section>
  )
}

export function App() {
  const [query, setQuery] = useState(EXAMPLES[0]?.[1] ?? "")
  const [settings, setSettings] = useState<Settings>({
    reference: null,
    timeZone: ZONES[0] ?? "UTC",
    dayFirst: true,
    weekStartsOn: 1,
    fiscalYearStartMonth: 4,
  })
  const cardRef = useRef<HTMLDivElement>(null)
  const result = useMemo(() => parse(query, settings), [query, settings])
  const tiles = useMemo(
    () => EXAMPLES.map(([label, q]) => ({ label, q, spans: parse(q, settings).spans })),
    [settings],
  )

  const pick = (q: string) => {
    setQuery(q)
    // Don't focus the box: on phones that would open the keyboard over the result.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-10 pb-10 sm:pt-14">
      <header className="flex items-center justify-center gap-2 text-lg font-medium tracking-tight">
        <img src="/icon.svg" alt="" className="size-7" />
        query-parser
      </header>
      <h1 className="mt-8 text-center text-[26px] leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
        Plain English to Search Filters
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Deterministic, offline, running locally in your browser
      </p>

      <div ref={cardRef} className="scroll-mt-4 pt-8">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Try it out
          </span>
          <div className="flex gap-2">
            <Directory />
            <SettingsPanel settings={settings} onChange={setSettings} />
          </div>
        </div>
        <Card className="gap-0 overflow-hidden py-0 shadow-xs">
          <div className="bg-muted/50 focus-within:bg-muted/30">
            <QueryBox value={query} spans={result.spans} onChange={setQuery} />
          </div>
          <div className="border-t">
            {query.trim() ? (
              <Result result={result} tz={settings.timeZone} onRewrite={setQuery} />
            ) : (
              <p className="px-4 py-4 text-sm text-muted-foreground">Type a search query.</p>
            )}
          </div>
        </Card>
        <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {LEGEND.map(([tone, label]) => (
            <li key={tone} className="flex items-center gap-1.5">
              <i className={cn("size-2.5 rounded-full", TONE_CLASS[tone])} />
              {label}
            </li>
          ))}
        </ul>
      </div>

      <Section title="Tap One, See the Filters" sub="Each of these runs in the box above">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {tiles.map(({ label, q, spans }) => (
            <button
              key={q}
              type="button"
              onClick={() => pick(q)}
              className={cn(
                "rounded-xl border bg-card p-3 text-left transition-colors hover:border-neutral-300 active:bg-muted/50",
                q === query && "border-neutral-400",
              )}
            >
              <span className="block text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                {label}
              </span>
              <span className="mt-1 block text-sm leading-6 break-words">
                <Highlighted text={q} spans={spans} />
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Use It in Your Code"
        sub="Describe your product's filters once. Names resolve through your own directory, and anything unclear comes back as an issue, never a guess"
      >
        <pre className="overflow-x-auto rounded-xl border bg-muted/50 p-4 font-mono text-[12px] leading-relaxed">
          <code>{`import { createParser, directorySource, ruleTaggerFor } from "@qp/core"
import { schema, toSearchParams } from "@qp/adapter-xyne-spaces"

const parser = createParser({
  schema,
  tagger: ruleTaggerFor(schema),  // the model replaces this in M4
  sources: { person: directorySource(users, { fields, self }) },
})

const r = parser.parseSync("pdfs from utkarsh last week", {
  reference: new Date(),
  timeZone: "Asia/Kolkata",
})
toSearchParams(r)  // type=files&from=u_001&after=…&before=…&q=pdfs`}</code>
        </pre>
      </Section>

      <Section
        title="A Small Experiment. Still Growing"
        sub="What runs here is the rule baseline. A tiny trained model replaces the rules later"
      >
        <div className="space-y-3 text-center text-sm leading-relaxed text-pretty text-muted-foreground">
          <p>
            Hand-written rules tag each part of the query, the product's schema maps them to
            filters, and a fictional directory resolves names. Open Directory to see what it knows.
          </p>
          <p>
            On 205 test queries the rules reach 69.5 span F1{" "}
            <a
              className="text-foreground underline-offset-4 hover:underline"
              href={`${REPO}/blob/main/eval/results/rule-baseline-s02.txt`}
            >
              (results)
            </a>
            . The time normalizer gets every test time phrase right and 84.9% of a held-out set,
            with zero wrong answers{" "}
            <a
              className="text-foreground underline-offset-4 hover:underline"
              href={`${REPO}/blob/main/docs/spikes/S04-time-normalization.md`}
            >
              (S4)
            </a>
            . Expect mistakes, especially names without "from" or "by".
          </p>
        </div>
      </Section>

      <footer className="mt-16 flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
        <a className="inline-flex items-center gap-1 hover:text-foreground" href={REPO}>
          query-parser <ArrowUpRight className="size-3" />
        </a>
        {__COMMIT__ === "local" ? (
          <span>local build</span>
        ) : (
          <a className="font-mono hover:text-foreground" href={`${REPO}/commit/${__COMMIT__}`}>
            {__COMMIT__.slice(0, 7)}
          </a>
        )}
      </footer>
    </main>
  )
}
