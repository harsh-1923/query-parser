import type { Label, Role, Tagger, TagResult, Token } from "./types"

// Rule-based baseline tagger (PLAN §6.6, §10.2). Deterministic, no dependencies beyond the types.
//
// Passes, in order (a token claimed by an earlier pass is never relabeled):
//   1. typed operators         -> O (core binds them directly)
//   2. TIME                    -> longest run the caller's isTime() accepts
//   3. ATTR / KIND             -> longest lexicon match (ATTR wins ties)
//   4. ORDER, NEG              -> small word tables
//   5. cue scan                -> cue word + entity / container / topic span after it
//   6. leftovers               -> contiguous content words become TOPIC
//
// Span boundary decisions:
//   - CONTAINER spans cover the name only: "in the [design] channel", "on the [payments] board".
//     The container noun and the determiner stay O (PLAN §3 example).
//   - "the" is included in a person/group span only when the span ends in a group noun
//     ("with [the infra team]").
//   - "for X" is RECIPIENT only when X is a self word or @handle; otherwise it is a TOPIC cue.
//   - "on X" is CONTAINER only when a container noun follows ("on the payments board"); otherwise
//     TOPIC.
//   - "last"/"first"/"recent" are ORDER only directly before a KIND ("last pdf"); before a time
//     unit they are part of TIME, which is claimed first.
//   - Commas are tokens; they separate names in lists ("from ankit, neha") and stay O.

export interface RuleLexicon {
  /** Lowercase alias phrases for item kinds, possibly multi-word. */
  kinds: string[]
  /** Lowercase alias phrases for attributes, possibly multi-word. */
  attrs: string[]
  /** True when the joined text is a complete time expression. Callers wire this to @qp/time. */
  isTime: (text: string) => boolean
}

type EntityRole = "ACTOR" | "RECIPIENT" | "PARTICIPANT" | "MENTION"
type CueRole = EntityRole | "CONTAINER" | "TOPIC"

const MAX_TIME_TOKENS = 7
const MAX_PHRASE_TOKENS = 5
const MAX_NAME_TOKENS = 3

// ---------------------------------------------------------------------------------------------
// Word tables

const CUE_TABLE: Record<CueRole, string[]> = {
  ACTOR: [
    "from",
    "by",
    "author",
    "owner",
    "creator",
    "reporter",
    "sender",
    "created by",
    "written by",
    "sent by",
    "authored by",
    "posted by",
    "shared by",
    "edited by",
    "modified by",
    "updated by",
    "uploaded by",
    "assigned by",
    "reported by",
    "owned by",
    "made by",
  ],
  RECIPIENT: [
    "to",
    "for",
    "sent",
    "sent to",
    "assigned",
    "assigned to",
    "addressed to",
    "shared with",
    "forwarded",
    "emailed",
    "messaged",
    "assignee",
    "recipient",
    "cc",
    "cc'd",
    "ccd",
    "cced",
    "bcc",
    "cc'd to",
    "cc to",
    "copied",
    "copied to",
  ],
  PARTICIPANT: ["with", "between", "among", "involving", "including", "attended by", "joined by"],
  MENTION: ["mentioning", "mentions", "mentioned", "tagged", "tagging", "tags"],
  CONTAINER: ["in", "inside", "on"],
  TOPIC: ["about", "regarding", "re", "abt", "concerning", "related to"],
}

const CUES = new Map<string, CueRole>()
for (const [role, phrases] of Object.entries(CUE_TABLE)) {
  for (const phrase of phrases) CUES.set(phrase, role as CueRole)
}

const SELF = new Set(["i", "me", "my", "mine", "myself"])
/** "my manager", "my team": a relational name, not the user themselves. */
const RELATIONAL = new Set([
  "manager",
  "boss",
  "lead",
  "skip",
  "mentor",
  "team",
  "teammate",
  "teammates",
  "colleague",
  "colleagues",
  "reports",
  "directs",
  "assistant",
  "cofounder",
  "cofounders",
  "peers",
  "squad",
  "pod",
  "department",
  "org",
])
/** "may i see …", "can we find …": a polite frame, not a time or an author. */
const MODALS = new Set(["may", "can", "could", "should", "would", "will", "shall"])
/** Words that look like names after a cue but never are ("assigned to nobody"). */
const NOBODY = new Set([
  "nobody",
  "noone",
  "anyone",
  "anybody",
  "someone",
  "somebody",
  "everyone",
  "everybody",
])
const IMPERATIVE = new Set([
  "show",
  "find",
  "get",
  "give",
  "tell",
  "bring",
  "fetch",
  "list",
  "search",
])
const MENTION_VERBS = new Set(["mentioned", "tagged", "cc'd", "ccd"])
const MENTION_AUX = new Set([
  "was",
  "were",
  "got",
  "been",
  "get",
  "am",
  "is",
  "being",
  "ever",
  "also",
])

const NEG = new Set(["not", "except", "excluding", "exclude", "without", "no"])
const ORDER_WORDS = new Set(["latest", "newest", "oldest", "earliest"])
const ORDER_BEFORE_KIND = new Set(["last", "first", "recent"])
const ORDER_PHRASES = ["most recent", "newest first", "oldest first", "latest first"]
const SORT_WORDS = new Set(["sort", "sorted", "ordered", "order"])
const SORT_KEYS = new Set(["date", "recency", "time", "name", "size", "relevance"])

const DETERMINERS = new Set([
  "the",
  "a",
  "an",
  "any",
  "all",
  "some",
  "this",
  "that",
  "our",
  "their",
])
const STRONG_TOPIC_CUES = new Set(["about", "regarding", "re", "abt", "concerning"])
const CONNECTORS = new Set(["of", "the", "a", "an", "and", "or"])
const CONTAINER_NOUNS = new Set([
  "channel",
  "board",
  "project",
  "folder",
  "repo",
  "repository",
  "space",
  "team",
  "workspace",
  "group",
  "list",
  "directory",
])
const GROUP_NOUNS = new Set(["team", "group", "squad", "department", "org", "folks", "channel"])

/** Verbs that, right after a name, mean the name is the actor: "neha said", "ananya edited". */
const ACTOR_VERBS = new Set([
  "say",
  "says",
  "said",
  "send",
  "sends",
  "sent",
  "share",
  "shares",
  "shared",
  "post",
  "posts",
  "posted",
  "create",
  "creates",
  "created",
  "edit",
  "edits",
  "edited",
  "modified",
  "updated",
  "uploaded",
  "write",
  "writes",
  "wrote",
  "written",
  "authored",
  "made",
  "added",
  "changed",
  "deleted",
  "commented",
  "replied",
  "forwarded",
  "emailed",
  "messaged",
  "assigned",
  "mentioned",
  "tagged",
])

const STOPWORDS = new Set([
  ...DETERMINERS,
  ...SELF,
  ...NOBODY,
  ...ACTOR_VERBS,
  ...NEG,
  "of",
  "at",
  "for",
  "to",
  "in",
  "on",
  "by",
  "with",
  "from",
  "about",
  "and",
  "or",
  "but",
  "if",
  "so",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "do",
  "does",
  "did",
  "done",
  "have",
  "has",
  "had",
  "having",
  "get",
  "got",
  "show",
  "find",
  "list",
  "give",
  "search",
  "look",
  "looking",
  "need",
  "want",
  "fetch",
  "display",
  "see",
  "please",
  "pls",
  "can",
  "could",
  "would",
  "should",
  "will",
  "we",
  "us",
  "you",
  "your",
  "they",
  "them",
  "it",
  "its",
  "these",
  "those",
  "who",
  "whom",
  "whose",
  "what",
  "which",
  "when",
  "where",
  "why",
  "how",
  "other",
  "another",
  "more",
  "many",
  "much",
  "only",
  "also",
  "just",
  "then",
  "than",
  "there",
  "here",
  "up",
  "down",
  "out",
  "over",
  "into",
  "onto",
  "upon",
  "under",
  "after",
  "before",
  "until",
  "since",
  "during",
  "between",
  "among",
  "within",
  "while",
  "still",
  "ever",
  "yet",
  "things",
  "thing",
  "stuff",
  "anything",
  "something",
  "everything",
  "one",
  "ones",
  "results",
  "result",
  "items",
  "item",
  "related",
  "regarding",
  "re",
  "abt",
  "concerning",
  "mentioning",
  "mentions",
  "tagging",
  "tags",
  "cc",
  "including",
  "involving",
])

const POSSESSIVE = /^['’][sS]$/
const PLAIN_WORD = /^\p{L}[\p{L}\p{N}_.'’-]*$/u

// ---------------------------------------------------------------------------------------------
// Lexicon matching

function normalizePhrase(phrase: string): string {
  return phrase.toLowerCase().trim().split(/\s+/).join(" ")
}

/** Candidate singular forms of a word, exact form first. */
function foldPlural(word: string): string[] {
  const forms = [word]
  if (word.length > 4 && word.endsWith("ies")) forms.push(`${word.slice(0, -3)}y`)
  if (word.length > 3 && word.endsWith("es")) forms.push(word.slice(0, -2))
  if (word.length > 2 && word.endsWith("s") && !word.endsWith("ss")) forms.push(word.slice(0, -1))
  return forms
}

function isHandle(text: string): boolean {
  return text.startsWith("@") || (!text.startsWith("#") && text.includes("@"))
}

// ---------------------------------------------------------------------------------------------

export function ruleTagger(lexicon: RuleLexicon): Tagger {
  const kindPhrases = new Set(lexicon.kinds.map(normalizePhrase))
  const attrPhrases = new Set(lexicon.attrs.map(normalizePhrase))

  return {
    version: "rules-0.1",
    tag(tokens: Token[]): TagResult {
      const labels = tagTokens(tokens, lexicon, kindPhrases, attrPhrases)
      return { labels, confidence: labels.map(() => 1) }
    },
  }
}

function tagTokens(
  tokens: Token[],
  lexicon: RuleLexicon,
  kindPhrases: Set<string>,
  attrPhrases: Set<string>,
): Label[] {
  const n = tokens.length
  const lower = tokens.map((t) => t.text.toLowerCase())
  const labels: Label[] = tokens.map(() => "O")
  /** True once a token has been labeled or deliberately consumed as O (cue words, separators). */
  const taken: boolean[] = tokens.map((t) => t.operator !== undefined)

  const word = (i: number): string => lower[i] ?? ""
  const free = (i: number): boolean => i >= 0 && i < n && !taken[i]

  function claim(start: number, end: number, role: Role): void {
    for (let k = start; k < end; k++) {
      labels[k] = `${k === start ? "B" : "I"}-${role}`
      taken[k] = true
    }
  }

  function isPlainName(i: number): boolean {
    if (!free(i)) return false
    const w = word(i)
    if (STOPWORDS.has(w) || SELF.has(w) || NOBODY.has(w)) return false
    if (!PLAIN_WORD.test(tokens[i]?.text ?? "")) return false
    return matchCue(i) === undefined
  }

  /** End index of up to `max` consecutive plain name words from `start` (== start when none). */
  function nameRun(start: number, max: number, stopAt?: Set<string>): number {
    let e = start
    while (e < n && e - start < max && isPlainName(e) && !stopAt?.has(word(e))) e++
    return e
  }

  function matchCue(i: number): { role: CueRole; len: number; text: string } | undefined {
    for (const len of [2, 1]) {
      if (i + len > n) continue
      let ok = true
      for (let k = i; k < i + len; k++) if (taken[k]) ok = false
      if (!ok) continue
      const text = lower.slice(i, i + len).join(" ")
      const role = CUES.get(text)
      if (role) return { role, len, text }
    }
    return undefined
  }

  // 1b. Frames that would otherwise be misread: "may i …", "no one" -----------------------

  if (MODALS.has(word(0)) && (word(1) === "i" || word(1) === "we" || word(1) === "you")) {
    taken[0] = true
    taken[1] = true
  }
  for (let i = 0; i + 1 < n; i++) {
    if (word(i) === "no" && word(i + 1) === "one") {
      taken[i] = true
      taken[i + 1] = true
    }
  }

  // 2. TIME ---------------------------------------------------------------------------------

  function joined(start: number, end: number): string {
    let out = ""
    for (let k = start; k < end; k++) {
      const gap = k === start ? 0 : (tokens[k]?.start ?? 0) - (tokens[k - 1]?.end ?? 0)
      out += (gap > 0 ? " " : "") + (tokens[k]?.text ?? "")
    }
    return out
  }

  for (let i = 0; i < n; ) {
    let hit = 0
    if (free(i) && word(i) !== ",") {
      for (let len = Math.min(MAX_TIME_TOKENS, n - i); len >= 1 && !hit; len--) {
        let ok = word(i + len - 1) !== ","
        for (let k = i; k < i + len; k++) if (taken[k]) ok = false
        if (!ok) continue
        // A lone bare number ("3") is a count, not a time.
        if (len === 1 && /^\d+$/.test(word(i))) continue
        if (lexicon.isTime(joined(i, i + len))) hit = len
      }
    }
    if (hit) {
      claim(i, i + hit, "TIME")
      i += hit
    } else i++
  }

  // 3. ATTR / KIND --------------------------------------------------------------------------

  function phraseLen(i: number, phrases: Set<string>): number {
    for (let len = Math.min(MAX_PHRASE_TOKENS, n - i); len >= 1; len--) {
      const words = lower.slice(i, i + len)
      let ok = true
      for (let k = i; k < i + len; k++) if (taken[k] || word(k) === ",") ok = false
      if (!ok) continue
      const last = words[len - 1] ?? ""
      const head = words.slice(0, -1)
      for (const form of foldPlural(last)) {
        if (phrases.has([...head, form].join(" "))) return len
      }
    }
    return 0
  }

  for (let i = 0; i < n; ) {
    if (!free(i)) {
      i++
      continue
    }
    // "about sync engine": the word right after an explicit topic cue opens the topic, even if
    // it is also a kind or attribute alias.
    let prev = i - 1
    while (prev >= 0 && (word(prev) === "the" || word(prev) === "a" || word(prev) === "an")) prev--
    if (prev >= 0 && STRONG_TOPIC_CUES.has(word(prev))) {
      i++
      continue
    }
    const a = phraseLen(i, attrPhrases)
    const k = phraseLen(i, kindPhrases)
    const len = Math.max(a, k)
    if (len === 0) {
      i++
      continue
    }
    claim(i, i + len, a >= k ? "ATTR" : "KIND")
    i += len
  }

  // 4. ORDER, NEG ---------------------------------------------------------------------------

  for (let i = 0; i < n; i++) {
    if (!free(i)) continue
    const w = word(i)
    const pair = `${w} ${word(i + 1)}`
    if (ORDER_PHRASES.includes(pair) && free(i + 1)) {
      claim(i, i + 2, "ORDER")
    } else if (
      SORT_WORDS.has(w) &&
      word(i + 1) === "by" &&
      SORT_KEYS.has(word(i + 2)) &&
      free(i + 1) &&
      free(i + 2)
    ) {
      claim(i, i + 3, "ORDER")
    } else if (ORDER_WORDS.has(w)) {
      claim(i, i + 1, "ORDER")
    } else if (
      ORDER_BEFORE_KIND.has(w) &&
      labels[i + 1]?.endsWith("-KIND") &&
      labels[i + 1]?.startsWith("B")
    ) {
      claim(i, i + 1, "ORDER")
    } else if (NEG.has(w)) {
      claim(i, i + 1, "NEG")
    }
  }

  // 5. Cue scan -----------------------------------------------------------------------------

  function skipDeterminers(i: number): number {
    let k = i
    while (free(k) && DETERMINERS.has(word(k))) k++
    return k
  }

  function selfRole(i: number): EntityRole | undefined {
    const w = word(i)
    if (w === "i") {
      for (let d = 1; d <= 3; d++) {
        const next = word(i + d)
        if (MENTION_VERBS.has(next)) return "MENTION"
        if (!MENTION_AUX.has(next)) break
      }
      return "ACTOR"
    }
    if (w === "me") return IMPERATIVE.has(word(i - 1)) ? undefined : "RECIPIENT"
    return "ACTOR"
  }

  function startsEntity(i: number): boolean {
    const k = skipDeterminers(i)
    return free(k) && (SELF.has(word(k)) || isHandle(word(k)) || isPlainName(k))
  }

  /** Parses one entity span at `start`; returns its end index, or -1 when there is none. */
  function parseEntity(start: number, role: EntityRole): number {
    let s = start
    let detIdx = -1
    if (free(s) && DETERMINERS.has(word(s))) {
      detIdx = s
      s++
    }
    if (!free(s)) return -1
    const w = word(s)
    if (w === "my" && free(s + 1) && RELATIONAL.has(word(s + 1))) {
      claim(s, s + 2, role)
      return s + 2
    }
    if (SELF.has(w)) {
      claim(s, s + 1, role)
      return s + 1
    }
    if (isHandle(w)) {
      claim(s, s + 1, role)
      return s + 1
    }
    const e = nameRun(s, MAX_NAME_TOKENS)
    if (e === s) return -1
    const withDet = detIdx >= 0 && word(detIdx) === "the" && GROUP_NOUNS.has(word(e - 1))
    claim(withDet ? detIdx : s, e, role)
    return e
  }

  function consumeEntities(start: number, role: EntityRole): number {
    let cur = start
    for (;;) {
      const e = parseEntity(cur, role)
      if (e < 0) return cur
      cur = e
      const sep = word(cur)
      if (free(cur) && (sep === "and" || sep === "or" || sep === ",") && startsEntity(cur + 1)) {
        taken[cur] = true
        cur++
        continue
      }
      return cur
    }
  }

  function consumeTopic(start: number): number {
    let s = start
    while (free(s) && (DETERMINERS.has(word(s)) || SELF.has(word(s)))) s++
    let last = s
    for (let e = s; e < n && free(e); e++) {
      const w = word(e)
      if (w === "," || POSSESSIVE.test(w) || matchCue(e)) break
      if (CONNECTORS.has(w)) continue
      if (STOPWORDS.has(w)) break
      last = e + 1
    }
    if (last > s) claim(s, last, "TOPIC")
    return Math.max(last, start)
  }

  /** `in X` / `on the X channel`. Returns the end index, or undefined when `on` has no noun. */
  function consumeContainer(start: number, isOn: boolean): number | undefined {
    const s = skipDeterminers(start)
    if (free(s) && word(s).startsWith("#")) {
      claim(s, s + 1, "CONTAINER")
      return s + 1
    }
    const e = nameRun(s, MAX_NAME_TOKENS, CONTAINER_NOUNS)
    if (free(e) && CONTAINER_NOUNS.has(word(e))) {
      if (e > s) claim(s, e, "CONTAINER")
      taken[e] = true
      return e + 1
    }
    if (isOn) return undefined
    if (e > s) claim(s, e, "CONTAINER")
    return Math.max(e, start)
  }

  function consumeAfterCue(cue: { role: CueRole; text: string }, start: number): number {
    if (cue.role === "TOPIC") return consumeTopic(start)
    if (cue.role === "CONTAINER") {
      return consumeContainer(start, cue.text === "on") ?? consumeTopic(start)
    }
    if (cue.text === "for") {
      const k = skipDeterminers(start)
      if (!(free(k) && (SELF.has(word(k)) || isHandle(word(k))))) return consumeTopic(start)
    }
    return consumeEntities(start, cue.role)
  }

  for (let i = 0; i < n; ) {
    if (!free(i)) {
      i++
      continue
    }
    const text = word(i)
    const cue = matchCue(i)
    if (cue) {
      for (let k = i; k < i + cue.len; k++) taken[k] = true
      i = Math.max(consumeAfterCue(cue, i + cue.len), i + cue.len)
      continue
    }
    if (text.startsWith("#")) {
      claim(i, i + 1, "CONTAINER")
      i++
      continue
    }
    if (isHandle(text)) {
      claim(i, i + 1, "ACTOR")
      i++
      continue
    }
    if (text === "my" && free(i + 1) && RELATIONAL.has(word(i + 1))) {
      claim(i, i + 2, "ACTOR")
      i += 2
      continue
    }
    if (SELF.has(text)) {
      const role = selfRole(i)
      if (role) claim(i, i + 1, role)
      else taken[i] = true
      i++
      continue
    }
    if (isPlainName(i)) {
      const e = nameRun(i, MAX_NAME_TOKENS + 1)
      if (ACTOR_VERBS.has(word(e))) {
        claim(Math.max(i, e - 2), e, "ACTOR")
      } else if (POSSESSIVE.test(word(e))) {
        claim(e - 1, e, "ACTOR")
      }
      i = e
      continue
    }
    i++
  }

  // 5b. A container noun right after a container name is filler ("#infra channel") ---------

  for (let i = 1; i < n; i++) {
    const prev = labels[i - 1] ?? "O"
    const single = labels[i] === "B-KIND" && labels[i + 1] !== "I-KIND"
    if (prev.endsWith("-CONTAINER") && single && CONTAINER_NOUNS.has(word(i))) labels[i] = "O"
  }

  // 6. Leftover content words become TOPIC --------------------------------------------------

  for (let i = 0; i < n; ) {
    if (!free(i) || STOPWORDS.has(word(i)) || word(i) === "," || POSSESSIVE.test(word(i))) {
      i++
      continue
    }
    let e = i
    while (
      e < n &&
      free(e) &&
      !STOPWORDS.has(word(e)) &&
      word(e) !== "," &&
      !POSSESSIVE.test(word(e))
    ) {
      e++
    }
    claim(i, e, "TOPIC")
    i = e
  }

  return labels
}
