import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { fromWallTime, type Settings, wallTime, ZONES } from "@/lib/parser"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

export function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (s: Settings) => void
}) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal className="size-4" />
          Settings
        </Button>
      </SheetTrigger>
      <SheetContent
        className="w-full gap-0 sm:max-w-sm"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="border-b px-5 pt-5 pb-4">
          <SheetTitle>Reference and policies</SheetTitle>
          <SheetDescription>
            Times resolve against "now" in a time zone. Products choose these policies.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-5 py-5">
          <Field label="Now">
            <Input
              type="datetime-local"
              className="text-base md:text-base"
              value={wallTime(settings.reference ?? new Date(), settings.timeZone)}
              onChange={(e) =>
                set({
                  reference: e.target.value
                    ? fromWallTime(e.target.value, settings.timeZone)
                    : null,
                })
              }
            />
          </Field>
          <Field label="Time zone">
            <Select value={settings.timeZone} onValueChange={(timeZone) => set({ timeZone })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONES.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Numeric dates">
            <Select
              value={settings.dayFirst ? "1" : "0"}
              onValueChange={(v) => set({ dayFirst: v === "1" })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">3/10 = 3 October</SelectItem>
                <SelectItem value="0">3/10 = 10 March</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Week starts on">
            <Select
              value={String(settings.weekStartsOn)}
              onValueChange={(v) => set({ weekStartsOn: Number(v) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Monday</SelectItem>
                <SelectItem value="0">Sunday</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start px-0 text-muted-foreground"
            onClick={() => set({ reference: null })}
          >
            Use the current time
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
