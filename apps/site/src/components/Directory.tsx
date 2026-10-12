import { BookOpen, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { directory, SELF, schema } from "@/lib/parser"

const match = (q: string, ...fields: (string | undefined)[]) =>
  !q || fields.some((f) => f?.toLowerCase().includes(q))

function Row({ title, sub, tags }: { title: string; sub?: string | undefined; tags?: string[] }) {
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
        {sub && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{sub}</span>}
      </div>
      {tags && tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="rounded-md px-1.5 py-0 text-[11px] font-normal"
            >
              {t}
            </Badge>
          ))}
        </div>
      )}
    </li>
  )
}

export function Directory() {
  const [q, setQ] = useState("")
  const needle = q.trim().toLowerCase()
  const lists = useMemo(() => {
    const peopleRows = directory.people
      .filter((p) => match(needle, p.name, p.handle, p.team))
      .map((p) => (
        <Row
          key={p.id}
          title={`${p.name}${p.id === SELF ? " (you)" : ""}`}
          sub={`@${p.handle}`}
          tags={[p.team]}
        />
      ))
    const channelRows = directory.channels
      .filter((c) => match(needle, c.name, c.topic))
      .map((c) => <Row key={c.id} title={c.name} sub={c.topic} />)
    const kindRows = Object.entries(schema.kinds)
      .filter(([k, d]) => match(needle, k, ...d.aliases))
      .map(([k, d]) => (
        <Row key={k} title={k} sub={d.parent ? `→ ${d.parent}` : undefined} tags={d.aliases} />
      ))
    const stateRows = Object.entries(schema.attrs)
      .filter(([k, d]) => match(needle, k, ...d.aliases))
      .map(([k, d]) => (
        <Row
          key={k}
          title={k}
          sub={`${d.set.facet}=${String(d.set.value).toLowerCase()}`}
          tags={d.aliases}
        />
      ))
    return { peopleRows, channelRows, kindRows, stateRows }
  }, [needle])

  const tabs: [string, string, React.ReactNode[]][] = [
    ["people", "People", lists.peopleRows],
    ["channels", "Channels", lists.channelRows],
    ["kinds", "Kinds", lists.kindRows],
    ["states", "States", lists.stateRows],
  ]

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <BookOpen className="size-4" />
          Directory
        </Button>
      </SheetTrigger>
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="border-b px-5 pt-5 pb-4">
          <SheetTitle>What the demo knows</SheetTitle>
          <SheetDescription>
            A fictional company directory and the Xyne Spaces vocabulary. Names, handles and words
            here are what the parser can resolve; anything else stays search text.
          </SheetDescription>
          <div className="relative mt-2">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter"
              className="pl-9 text-base md:text-base"
            />
          </div>
        </SheetHeader>
        <Tabs defaultValue="people" className="min-h-0 flex-1 gap-0">
          <TabsList className="mx-5 mt-3 grid w-auto grid-cols-4">
            {tabs.map(([v, label, rows]) => (
              <TabsTrigger key={v} value={v} className="text-xs">
                {label}
                <span className="ml-1 text-muted-foreground">{rows.length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map(([v, , rows]) => (
            <TabsContent key={v} value={v} className="min-h-0 overflow-y-auto px-5 pb-6">
              {rows.length ? (
                <ul className="divide-y">{rows}</ul>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">Nothing matches.</p>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
