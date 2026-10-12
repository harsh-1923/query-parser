// @qp/adapter-xyne-spaces: the Xyne Spaces schema and a serializer for GET /api/vespaSearch.
// Param vocabulary from xyne-spaces apps/backend/src/validators/vespaSearchValidator.ts and
// services/vespaSearch/index.ts (see docs/spikes/S05-kind-attr-vocab.md).
import { defineSchema, facet, type ParseResult, type TimeValue } from "@qp/core"

/**
 * Kinds Xyne can filter on directly, plus finer kinds that fall back to a parent type. Genre nouns
 * ("report", "spec", "invoice") are deliberately not aliases: S05 found they are usually topics,
 * and as kinds they would restrict results to files.
 */
const KINDS = {
  message: {
    aliases: [
      "message",
      "msg",
      "chat",
      "thread",
      "reply",
      "dm",
      "direct message",
      "post",
      "conversation",
      "say",
      "said",
      "wrote",
      "ping",
      "pinged",
      "mention",
      "slack",
      "comment",
      "commented",
    ],
  },
  attachment: { aliases: ["attachment", "attached file"], parent: "file" },
  channel: { aliases: ["channel", "group", "room"] },
  ticket: { aliases: ["ticket", "issue", "jira", "card", "work item", "desk"] },
  bug: { aliases: ["bug", "defect", "bugfix"], parent: "ticket" },
  epic: { aliases: ["epic"], parent: "ticket" },
  story: { aliases: ["story", "user story"], parent: "ticket" },
  task: { aliases: ["task", "todo item", "subtask", "action item"], parent: "ticket" },
  file: {
    aliases: [
      "file",
      "upload",
      "shared file",
      "zip",
      "tar",
      "gz",
      "yaml",
      "yml",
      "json",
      "xml",
      "exe",
      "apk",
      "dmg",
    ],
  },
  pdf: { aliases: ["pdf", "pdf file"], parent: "file" },
  document: {
    aliases: [
      "doc",
      "document",
      "docx",
      "gdoc",
      "google doc",
      "word doc",
      "writeup",
      "write-up",
      "memo",
      "txt",

      "md",
      "rtf",
      "odt",
    ],
    parent: "file",
  },
  spreadsheet: {
    aliases: ["sheet", "spreadsheet", "excel", "xls", "xlsx", "csv", "gsheet", "google sheet"],
    parent: "file",
  },
  presentation: {
    aliases: [
      "deck",
      "slide",
      "presentation",
      "ppt",
      "pptx",
      "keynote",
      "pitch deck",
      "slide deck",
    ],
    parent: "file",
  },
  image: {
    aliases: [
      "image",
      "img",
      "screenshot",
      "photo",
      "picture",
      "pic",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "svg",
      "diagram",
      "mockup",

      "webp",
      "heic",
    ],
    parent: "file",
  },
  video: { aliases: ["video", "mp4", "mov", "clip", "loom", "mkv", "webm", "avi"], parent: "file" },
  canvas: {
    aliases: [
      "canvas",
      "note",
      "notes",
      "wiki",
      "page",
      "meeting notes",
      "summary",
      "minutes",
      "mom",
      "recap",
    ],
  },
  transcript: {
    aliases: [
      "transcript",
      "transcription",
      "call transcript",
      "meeting transcript",
      "vtt",
      "srt",
      "captions",
      "subtitles",
    ],
  },
  recording: {
    aliases: [
      "recording",
      "call recording",
      "meeting recording",
      "video recording",
      "mp3",
      "wav",
      "m4a",
      "voice memo",
      "voice note",
      "voicemail",
    ],
  },
  call: {
    aliases: [
      "meeting",
      "call",
      "huddle",
      "standup",

      "1:1",
      "one on one",
      "zoom",
      "meet",
      "catchup",
      "catch-up",
      "all hands",
      "retro",
    ],
  },
  email: { aliases: ["email", "e-mail", "mail", "newsletter", "inbox", "gmail"] },
  person: { aliases: ["person", "people", "user", "member", "profile", "contact"] },
} as const

/** Kind → vespaSearch params. Kinds not listed use their parent's. */
const KIND_PARAMS: Record<string, Record<string, string>> = {
  message: { type: "messages" },
  attachment: { type: "attachments" },
  channel: { type: "channels" },
  ticket: { type: "tickets" },
  file: { type: "files" },
  canvas: { type: "canvas" },
  transcript: { type: "transcript" },
  recording: { type: "files", subApp: "recording" },
  call: { type: "calls" },
  email: { type: "emails" },
  person: { type: "people" },
}

export const STATUSES = ["OPEN", "TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"] as const
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const

export const schema = defineSchema({
  kinds: KINDS as unknown as Record<string, { aliases: string[]; parent?: string }>,
  attrs: {
    open: {
      aliases: [
        "open",
        "active",
        "unresolved",
        "unfinished",
        "not done",
        "not closed",
        "outstanding",
        "pending",
      ],
      set: { facet: "status", value: "OPEN" },
    },
    todo: {
      aliases: ["todo", "to do", "to-do", "not started", "backlog", "in backlog"],
      set: { facet: "status", value: "TODO" },
    },
    started: {
      aliases: [
        "in progress",
        "wip",
        "ongoing",
        "in flight",
        "started",
        "doing",
        "in review",
        "under review",
        "in qa",

        "needs review",
        "awaiting review",
        "in code review",
      ],
      set: { facet: "status", value: "STARTED" },
    },
    paused: {
      aliases: ["paused", "blocked", "on hold", "stuck"],
      set: { facet: "status", value: "PAUSED" },
    },
    done: {
      aliases: [
        "done",
        "completed",
        "complete",
        "closed",
        "resolved",
        "finished",
        "fixed",
        "shipped",

        "merged",
      ],
      set: { facet: "status", value: "COMPLETED" },
    },
    cancelled: {
      aliases: ["cancelled", "canceled", "wont fix", "won't fix", "wontfix", "rejected"],
      set: { facet: "status", value: "CANCELLED" },
    },
    critical: {
      aliases: ["p0", "critical", "urgent", "blocker", "sev0", "sev1", "highest priority"],
      set: { facet: "priority", value: "CRITICAL" },
    },
    high: {
      aliases: ["p1", "high priority", "high pri", "high", "important"],
      set: { facet: "priority", value: "HIGH" },
    },
    medium: {
      aliases: ["p2", "medium priority", "medium", "normal priority"],
      set: { facet: "priority", value: "MEDIUM" },
    },
    low: {
      aliases: ["p3", "p4", "low priority", "low", "minor"],
      set: { facet: "priority", value: "LOW" },
    },
    bots: {
      aliases: ["bot post", "bot message", "from bot", "by bot", "automated"],
      set: { facet: "bots", value: true },
    },
  },
  facets: {
    type: facet.kind(),
    assignee: facet.entity({ role: "RECIPIENT", source: "person", when: { kind: ["ticket"] } }),
    to: facet.entity({ role: "RECIPIENT", source: "person" }),
    from: facet.entity({ role: "ACTOR", source: "person", multi: "or" }),
    with: facet.entity({ role: "PARTICIPANT", source: "person" }),
    mentions: facet.entity({ role: "MENTION", source: "person" }),
    in: facet.entity({ role: "CONTAINER", source: "channel", multi: "or" }),
    date: facet.time(),
    status: facet.enum({ values: [...STATUSES] }),
    priority: facet.enum({ values: [...PRIORITIES] }),
    bots: facet.flag(),
    sort: facet.order(),
  },
  operators: {
    from: "from",
    by: "from",
    reporter: "from",
    to: "to",
    assignee: "assignee",
    in: "in",
    with: "with",
    mentions: "mentions",
    type: "type",
    status: "status",
    priority: "priority",
  },
})

export interface XyneFilters {
  type: string[]
  from: string[]
  to: string[]
  assignee: string[]
  with: string[]
  mentions: string[]
  in: string[]
  date: TimeValue
  status: string[]
  priority: string[]
  bots: boolean
  sort: { dir: "asc" | "desc" }
}

/** "YYYY-MM-DD" of an instant in the query's zone. */
function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

/** The parse result as vespaSearch query params. Kinds Xyne can't filter on exactly keep their words in `q`. */
export function toSearchParams(result: ParseResult): URLSearchParams {
  const f = result.filters as Partial<XyneFilters>
  const p = new URLSearchParams()
  const extraText: string[] = []

  const types = new Set<string>()
  for (const k of f.type ?? []) {
    let key: string | undefined = k
    while (key && !KIND_PARAMS[key])
      key = (KINDS as Record<string, { parent?: string }>)[key]?.parent
    const params = key ? KIND_PARAMS[key] : undefined
    if (!params) continue
    if (params.type) types.add(params.type)
    if (params.subApp) p.set("subApp", params.subApp)
    if (key !== k) {
      const span = result.spans.find(
        (s) => s.role === "KIND" && (s.resolution as { value?: unknown })?.value === k,
      )
      if (span) extraText.push(span.text)
    }
  }
  if (types.size) p.set("type", [...types].join(","))

  const ids = (k: keyof XyneFilters, param: string) => {
    const v = f[k] as string[] | undefined
    if (v?.length) p.set(param, v.join(","))
  }
  ids("from", "from")
  ids("assignee", "assignee")
  ids("with", "withUser")
  ids("mentions", "mentions")
  ids("in", "in")
  if (f.to?.length) p.set("to", f.to.join(","))

  // Xyne: after=D means after the end of D and before=D before its start (YqlBuilder.ts:831-838),
  // with day boundaries in UTC. Our [from, to) becomes after=<day before from>, before=<to>.
  // Ranges finer than a day are widened to whole days.
  if (f.date) {
    const tz = result.meta.timeZone
    const DAY = 86_400_000
    const hourly = f.date.granularity === "hour"
    const shift = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()
    if (f.date.from) p.set("after", localDate(shift(f.date.from, hourly ? -DAY : -1), tz))
    if (f.date.to) p.set("before", localDate(hourly ? shift(f.date.to, DAY - 1) : f.date.to, tz))
  }
  if (f.status?.length) {
    const s = new Set(f.status.flatMap((x) => (x === "OPEN" ? ["TODO", "STARTED", "PAUSED"] : [x])))
    p.set("status", [...s].join(","))
  }
  if (f.priority?.length) p.set("priority", f.priority.join(","))
  if (f.bots) p.set("includeBotMessages", "true")
  if (result.order) p.set("orderBy", result.order.dir === "asc" ? "oldest" : "newest")

  const q = [result.text, ...extraText].filter(Boolean).join(" ").trim()
  if (q) p.set("q", q)
  return p
}
