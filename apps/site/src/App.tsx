import type { Tagger } from "@qp/core"
import { ArrowUpRight } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Directory } from "@/components/Directory"
import { Highlighted, QueryBox } from "@/components/QueryBox"
import { Result } from "@/components/Result"
import { SettingsPanel } from "@/components/SettingsPanel"
import { Card } from "@/components/ui/card"
import { loadModel, MODELS, type TaggerChoice } from "@/lib/models"
import { LEGEND, parse, rules, type Settings, TONE_CLASS, ZONES } from "@/lib/parser"
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

const SYSTEMS = [
  {
    key: "rules",
    label: "Rules",
    blurb: "Hand-written rules",
    scores: { s02: 0.727, glm: 0.726 },
    results: `${REPO}/blob/main/eval/results/report.md`,
  },
  { key: "model", ...MODELS.model },
  { key: "model-feat", ...MODELS["model-feat"] },
] as const satisfies readonly ({ key: TaggerChoice } & (typeof MODELS)["model"])[]

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
    <section className="mx-auto mt-16 max-w-xl">
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
  const [taggers, setTaggers] = useState<Partial<Record<TaggerChoice, Tagger | string>>>({
    rules,
  })
  useEffect(() => {
    let live = true
    for (const key of ["model", "model-feat"] as const)
      loadModel(key).then(
        (t) => live && setTaggers((m) => ({ ...m, [key]: t })),
        (e: unknown) => live && setTaggers((m) => ({ ...m, [key]: String(e) })),
      )
    return () => {
      live = false
    }
  }, [])
  const results = useMemo(
    () =>
      SYSTEMS.map((sys) => {
        const t = taggers[sys.key]
        return {
          ...sys,
          state: t === undefined ? "loading" : typeof t === "string" ? t : null,
          result: t && typeof t !== "string" ? parse(query, settings, t) : null,
        }
      }),
    [query, settings, taggers],
  )
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
    <main className="mx-auto w-full max-w-6xl px-4 pt-10 pb-10 sm:pt-14">
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
            <QueryBox value={query} spans={[]} onChange={setQuery} />
          </div>
        </Card>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {results.map((r) => (
            <Card key={r.key} className="gap-0 overflow-hidden py-0 shadow-xs">
              <div className="border-b px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{r.label}</span>
                  <a
                    className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    href={r.results}
                    title="Span F1 on the S02 and GLM test sets"
                  >
                    F1 {r.scores.s02.toFixed(3)} · {r.scores.glm.toFixed(3)}
                  </a>
                </div>
                <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{r.blurb}</p>
              </div>
              {r.result ? (
                <>
                  <p className="bg-muted/30 px-4 py-3 text-base leading-7 break-words">
                    {query.trim() ? (
                      <Highlighted text={query} spans={r.result.spans} />
                    ) : (
                      <span className="text-sm text-muted-foreground">Type a search query.</span>
                    )}
                  </p>
                  {query.trim() && (
                    <div className="border-t">
                      <Result result={r.result} tz={settings.timeZone} onRewrite={setQuery} />
                    </div>
                  )}
                </>
              ) : (
                <p
                  className={cn(
                    "px-4 py-4 text-sm",
                    r.state === "loading" ? "text-muted-foreground" : "text-red-600",
                  )}
                >
                  {r.state === "loading"
                    ? "Loading the model (about 300 KB)…"
                    : `Couldn't load the model: ${r.state}`}
                </p>
              )}
            </Card>
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {LEGEND.map(([tone, label]) => (
            <li key={tone} className="flex items-center gap-1.5">
              <i className={cn("size-2.5 rounded-full", TONE_CLASS[tone])} />
              {label}
            </li>
          ))}
        </ul>
      </div>

      <Section
        title="Tap One, See the Filters"
        sub="Each of these runs in the box above. Highlights here show the rules"
      >
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
        sub="The rule baseline and two tiny trained models run side by side at the top, all in your browser"
      >
        <div className="space-y-3 text-center text-sm leading-relaxed text-pretty text-muted-foreground">
          <p>
            Hand-written rules tag each part of the query, the product's schema maps them to
            filters, and a fictional directory resolves names. Open Directory to see what it knows.
          </p>
          <p>
            On two sets of test queries written by other LLMs (204 and 300), the rules reach 0.727
            and 0.726 span F1{" "}
            <a
              className="text-foreground underline-offset-4 hover:underline"
              href={`${REPO}/blob/main/eval/results/report.md`}
            >
              (results)
            </a>
            . The models beat the rules on the first set; on the second, the feature model ties them
            and the text-only model is behind{" "}
            <a
              className="text-foreground underline-offset-4 hover:underline"
              href={`${REPO}/blob/main/docs/spikes/S07-lexicon-features.md`}
            >
              (S7)
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

      <footer className="mx-auto mt-16 flex max-w-xl items-center justify-between border-t pt-4 text-xs text-muted-foreground">
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
