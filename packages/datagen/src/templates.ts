// The template table (PLAN §9.2 stage 1). One row per query shape.
//
// Pattern syntax, split on spaces:
//   {ROLE|mod|mod}  a slot (see slots.ts). ROLE is a role name, or OP for a typed operator value (label O).
//   <a|b|c>         pick one literal at random (O). Alternatives may contain spaces.
//   $FROM $TO ...   shorthand for a common <...> group (MACROS below).
//   anything else   literal cue/filler word, label O. `key:{OP}` glues a literal to a slot.
//
// `heldOut` templates are never used for train/val. test-generated uses only held-out templates,
// together with the held-out name pool, so it measures generalisation to unseen query shapes.

import { chance, int, pick, type Rng } from "./rng"
import type { Piece, Side } from "./slots"

export interface Template {
  id: string
  pattern?: string
  /** Custom generator for queries with no slots (chit-chat, gibberish). */
  make?: (rng: Rng, side: Side) => Piece[]
  heldOut?: boolean
  /** Counts toward the ~10% of queries with nothing (or only TOPIC) to extract. */
  negative?: boolean
}

export const MACROS: Record<string, string> = {
  $FROM: "<from|by|from|by|sent by|shared by|created by|written by|posted by|uploaded by|owned by>",
  $TO: "<to|sent to|assigned to|addressed to|for>",
  $WITH: "<with|involving|with|between>",
  $MENT: "<mentioning|tagging|that mention|that tag>",
  $ABOUT: "<about|about|on|regarding|re|related to|concerning>",
  $VERB: "<shared|sent|created|uploaded|edited|wrote|posted|commented on>",
}

const CHAT_OPEN = [
  "hello",
  "hi",
  "hey",
  "good morning",
  "good evening",
  "ok",
  "okay",
  "cool",
  "great",
  "nice",
  "sure",
  "yes",
  "no",
  "hmm",
  "well",
  "thanks",
  "thank you",
  "sorry",
  "lol",
  "bye",
  "yo",
  "oh",
  "wow",
  "alright",
  "yep",
  "nope",
  "haha",
  "greetings",
  "right",
  "fine",
]
const CHAT_CORE = [
  "",
  "there",
  "team",
  "everyone",
  "again",
  "so much",
  "a lot",
  "that works",
  "sounds good",
  "got it",
  "never mind",
  "see you later",
  "how are you",
  "what's up",
  "who are you",
  "what can you do",
  "can you help me",
  "is this working",
  "how does this work",
  "tell me a joke",
  "that is all",
  "no worries",
  "i see",
  "makes sense",
  "my friend",
  "buddy",
  "it is me",
  "you there",
  "can we talk",
  "good to know",
]
const CHAT_CLOSE = ["", "", "please", "thanks", "mate", "friend"]
const QUESTION_STEM = [
  "what is",
  "how does",
  "why is",
  "can you explain",
  "who made",
  "where is",
  "how do i learn",
  "is it true that",
  "what happens with",
  "which one is better,",
  "do you know about",
  "how many",
  "when did people discover",
  "what does it mean when",
  "are you sure about",
  "could you describe",
  "what do you think about",
  "why do people like",
  "how come",
  "tell me about",
]
const QUESTION_END = [
  "the meaning of life",
  "this app",
  "the sky blue",
  "the internet",
  "gravity",
  "a database",
  "the weather like",
  "search",
  "the best way",
  "a good idea",
  "the answer",
  "all of this",
  "your name",
  "the point of this",
  "that thing",
  "everything",
  "pizza",
  "the moon",
  "music",
  "a good movie",
  "the ocean",
  "a simple recipe",
  "the capital of france",
  "chess",
  "the universe",
  "coffee",
  "a healthy breakfast",
  "the speed of light",
  "this joke",
  "rainy days",
  "cats",
  "the news",
]
const STATEMENT_SUBJECT = [
  "i",
  "we",
  "you",
  "they",
  "it",
  "this",
  "that",
  "my cat",
  "the weather",
  "everyone",
  "she",
  "he",
]
const STATEMENT_VERB = [
  "think",
  "guess",
  "hope",
  "feel",
  "know",
  "believe",
  "doubt",
  "wonder",
  "say",
  "suppose",
]
const STATEMENT_END = [
  "is fine",
  "looks good",
  "was great",
  "works well",
  "makes sense",
  "is cool",
  "seems right",
  "is amazing",
  "sounds fun",
  "feels weird",
  "is lovely",
  "was funny",
  "is not bad",
  "is quite nice",
  "seems okay",
  "is a bit odd",
  "was a surprise",
  "is very kind",
  "is so true",
  "is hilarious",
  "feels right",
  "is wonderful",
  "is interesting",
  "seems fair",
]

const LETTERS = "abcdefghijklmnopqrstuvwxyz"
const VOWELS = "aeiou"

function gibberish(rng: Rng): Piece[] {
  const words = 1 + int(rng, 3)
  const pieces: Piece[] = []
  for (let w = 0; w < words; w++) {
    const len = 3 + int(rng, 7)
    let text = ""
    for (let i = 0; i < len; i++) {
      // mostly consonants so it never looks like a name or word by accident
      text += chance(rng, 0.12) ? pick(rng, [...VOWELS]) : pick(rng, [...LETTERS])
    }
    pieces.push({ text, role: null })
  }
  return pieces
}

/** Even-indexed list items go to train/val, odd-indexed to test-generated, so the phrasings are disjoint. */
const half = <T>(list: readonly T[], side: Side): T[] =>
  list.filter((_, i) => (i % 2 === 0) === (side === "train"))

function chitchat(rng: Rng, side: Side): Piece[] {
  const text = [
    pick(rng, half(CHAT_OPEN, side)),
    pick(rng, half(CHAT_CORE, side)),
    pick(rng, CHAT_CLOSE),
  ]
    .filter(Boolean)
    .join(" ")
  return [{ text, role: null }]
}

function statement(rng: Rng, side: Side): Piece[] {
  const verb = pick(rng, half(STATEMENT_VERB, side))
  const text = `${pick(rng, half(STATEMENT_SUBJECT, side))} ${verb} ${pick(rng, half(STATEMENT_END, side))}`
  return [{ text, role: null }]
}

function question(rng: Rng, side: Side): Piece[] {
  return [
    {
      text: `${pick(rng, half(QUESTION_STEM, side))} ${pick(rng, half(QUESTION_END, side))}`,
      role: null,
    },
  ]
}

export const TEMPLATES: Template[] = [
  // --- kind + person with cue words
  { id: "kind_actor", pattern: "{KIND} $FROM {ACTOR|person}" },
  { id: "kind_actor_any", pattern: "{KIND} $FROM {ACTOR}" },
  { id: "kind_actor_time", pattern: "{KIND} $FROM {ACTOR} {TIME}" },
  { id: "kind_actor_topic", pattern: "{KIND} $FROM {ACTOR|person} $ABOUT {TOPIC}" },
  {
    id: "kind_full",
    pattern: "{KIND} $FROM {ACTOR} {CONTAINER} {TIME} $ABOUT {TOPIC}",
  },
  { id: "actor_kind_nocue", pattern: "{ACTOR|name} {KIND}" },
  { id: "actor_poss_kind", pattern: "{ACTOR|poss} {KIND}" },
  { id: "actor_poss_kind_time", pattern: "{ACTOR|poss} {KIND} {TIME}", heldOut: true },
  { id: "actor_kind_topic_nocue", pattern: "{ACTOR|person} {KIND} {TOPIC}" },
  { id: "actor_poss_rel", pattern: "{ACTOR|poss|rel} {KIND}" },
  { id: "kind_multi_actor", pattern: "{KIND} $FROM {ACTOR|multi}" },
  { id: "kind_multi_actor_time", pattern: "{KIND} $FROM {ACTOR|multi} {TIME}", heldOut: true },
  { id: "kind_group_actor", pattern: "{KIND} $FROM {ACTOR|grp}" },
  { id: "kind_handle", pattern: "{KIND} $FROM {ACTOR|handle}" },
  { id: "kind_email", pattern: "{KIND} $FROM {ACTOR|email}" },
  { id: "handle_kind_nocue", pattern: "{ACTOR|handle} {KIND}" },
  { id: "kind_i_verb", pattern: "{KIND} {ACTOR|i} $VERB" },
  { id: "kind_i_verb_time", pattern: "{KIND} {ACTOR|i} $VERB {TIME}" },
  { id: "my_kind", pattern: "{ACTOR|my} {KIND}" },
  { id: "my_kind_time", pattern: "{ACTOR|my} {KIND} {TIME}" },
  // --- recipient / participant / mention
  { id: "kind_recipient", pattern: "{KIND} $TO {RECIPIENT}" },
  { id: "kind_recipient_attr", pattern: "{KIND} $TO {RECIPIENT|person} {ATTR}", heldOut: true },
  { id: "kind_recipient_me", pattern: "{KIND} $TO {RECIPIENT|me}" },
  { id: "kind_recipient_rel", pattern: "{KIND} $TO {RECIPIENT|rel}" },
  { id: "kind_participant", pattern: "{KIND} $WITH {PARTICIPANT}" },
  { id: "kind_participant_time", pattern: "{KIND} $WITH {PARTICIPANT|person} {TIME}" },
  { id: "kind_participant_grp", pattern: "{KIND} $WITH {PARTICIPANT|grp}", heldOut: true },
  { id: "kind_mention", pattern: "{KIND} $MENT {MENTION|person}", heldOut: true },
  { id: "kind_mention_me", pattern: "{KIND} $MENT {MENTION|me}" },
  { id: "where_i_mentioned", pattern: "<where|when> {MENTION|i} was <mentioned|tagged>" },
  {
    id: "kind_where_i_mentioned",
    pattern: "{KIND} <where|when> {MENTION|i} was <mentioned|tagged>",
  },
  // --- container
  { id: "kind_container", pattern: "{KIND} {CONTAINER}" },
  { id: "kind_container_time", pattern: "{KIND} {CONTAINER} {TIME}" },
  { id: "container_bare_kind", pattern: "{CONTAINER|bare} {KIND}" },
  { id: "container_bare_time", pattern: "{CONTAINER|bare} {TIME}" },
  { id: "container_bare_topic", pattern: "{CONTAINER|bare} {TOPIC}", heldOut: true },
  { id: "kind_container_multi", pattern: "{KIND} {CONTAINER|multi}", heldOut: true },
  // --- attr / order / time
  { id: "attr_kind", pattern: "{ATTR} {KIND}" },
  { id: "attr_kind_container", pattern: "{ATTR} {KIND} {CONTAINER}" },
  { id: "kind_that_are_attr", pattern: "{KIND} <that are|which are|marked|currently> {ATTR}" },
  { id: "attr_kind_actor", pattern: "{ATTR} {KIND} $FROM {ACTOR}", heldOut: true },
  { id: "order_kind", pattern: "{ORDER} {KIND}" },
  { id: "order_kind_actor", pattern: "{ORDER} {KIND} $FROM {ACTOR}" },
  { id: "kind_order_post", pattern: "{KIND} {ORDER|post}" },
  { id: "order_topic_kind", pattern: "{ORDER} {TOPIC} {KIND}", heldOut: true },
  { id: "time_kind", pattern: "{TIME} {KIND}" },
  { id: "kind_time", pattern: "{KIND} {TIME}" },
  { id: "kind_time_topic", pattern: "{KIND} {TIME} $ABOUT {TOPIC}", heldOut: true },
  { id: "kind_time_from_today", pattern: "{KIND} {TIME|from}" },
  { id: "actor_kind_from_today", pattern: "{ACTOR|name} {KIND} {TIME|from}" },
  // --- topic
  { id: "kind_topic", pattern: "{KIND} $ABOUT {TOPIC}" },
  { id: "topic_kind", pattern: "{TOPIC} {KIND}" },
  { id: "topic_time", pattern: "{TOPIC} {TIME}" },
  { id: "topic_kind_actor", pattern: "{TOPIC} {KIND} $FROM {ACTOR}", heldOut: true },
  {
    id: "mentioning_topic",
    pattern: "{KIND} <mentioning|containing|that mention|that contain> {TOPIC}",
  },
  // --- v1 word-order diversity: kind last, state after kind, topic next to kind, concatenations
  { id: "topic_kind_kind", pattern: "{TOPIC} {KIND} {KIND}" },
  { id: "kind_attr_nocue", pattern: "{KIND} {ATTR}" },
  { id: "topic_kind_attr", pattern: "{TOPIC} {KIND} {ATTR}" },
  { id: "kind_attr_time", pattern: "{KIND} {ATTR} {TIME}" },
  { id: "attr_topic_kind", pattern: "{ATTR} {TOPIC} {KIND}" },
  { id: "time_topic_kind", pattern: "{TIME} {TOPIC} {KIND}", heldOut: true },
  { id: "topic_time_kind", pattern: "{TOPIC} {TIME} {KIND}" },
  { id: "topic_kind_time_end", pattern: "{TOPIC|short} {KIND} {TOPIC|short} {TIME}" },
  { id: "order_version_of", pattern: "{ORDER|ver} of the {TOPIC} {KIND}" },
  { id: "order_poss_kind", pattern: "{ORDER} {ACTOR|poss} {KIND}" },
  { id: "order_topic_kind_actor", pattern: "{ORDER} {TOPIC} {KIND} $FROM {ACTOR}", heldOut: true },
  { id: "container_time_topic", pattern: "{CONTAINER|bare} {TIME} {TOPIC}" },
  { id: "actor_topic_kind_bare", pattern: "{ACTOR|name} {TOPIC} {KIND}" },
  { id: "poss_topic_kind", pattern: "{ACTOR|poss} {TOPIC} {KIND}" },
  { id: "poss_topic_kind_time", pattern: "{ACTOR|poss} {TOPIC} {KIND} {TIME}", heldOut: true },
  {
    id: "topic_kind_container_attr",
    pattern: "{TOPIC} {KIND} {CONTAINER|bare} {ATTR}",
    heldOut: true,
  },
  { id: "neg_attr_kind_end", pattern: "{TOPIC} {KIND} {NEG|attr} {ATTR|neg}" },
  { id: "except_container", pattern: "{KIND} {NEG|from} {CONTAINER|bare}" },
  { id: "neg_kind_plural", pattern: "{TOPIC} {NEG|attr} {KIND}" },
  // --- typed operators (label O)
  { id: "typed_op", pattern: "{KIND} <from|by|to|assignee|reporter|owner>:{OP}" },
  { id: "typed_op_time", pattern: "<from|to|owner>:{OP} {KIND} {TIME}", heldOut: true },
  // --- negation
  { id: "neg_from", pattern: "{KIND} {NEG|from} <from|by> {ACTOR}" },
  { id: "neg_from_multi", pattern: "{NEG|from} <from|by> {ACTOR|multi}" },
  {
    id: "neg_from_multi_kind",
    pattern: "{KIND} {NEG|from} from {ACTOR|multi} {TIME}",
    heldOut: true,
  },
  { id: "neg_kind", pattern: "{NEG} {KIND}" },
  { id: "neg_kind_topic", pattern: "{TOPIC} {NEG|topic} {KIND}" },
  { id: "neg_attr", pattern: "{KIND} {NEG|attr} {ATTR|neg}" },
  { id: "neg_attr_lead", pattern: "{NEG|attr} {ATTR|neg} {TOPIC}" },
  { id: "neg_container", pattern: "{KIND} {NEG|from} {CONTAINER}" },
  { id: "neg_topic", pattern: "{TOPIC} {NEG|topic} {TOPIC}" },
  {
    id: "neg_recipient",
    pattern: "{KIND} {NEG|from} <assigned to|sent to> {RECIPIENT}",
    heldOut: true,
  },
  // --- questions
  { id: "q_what_did_say_topic", pattern: "what did {ACTOR|person} {KIND|v} about {TOPIC}" },
  { id: "q_what_did_say_time", pattern: "what did {ACTOR|person} {KIND|v} {TIME}" },
  {
    id: "q_actor_said_topic",
    pattern: "{ACTOR|person} {KIND|vp} <about|that|re> {TOPIC}",
    heldOut: true,
  },
  { id: "q_where_is", pattern: "where is the {TOPIC} {KIND}" },
  {
    id: "q_did_anything",
    pattern: "did {ACTOR|person} <send|share|post|write|say> anything about {TOPIC}",
  },
  {
    id: "q_who_verb",
    pattern: "who <sent|shared|posted|uploaded|wrote> the {TOPIC} {KIND} {TIME}",
    heldOut: true,
  },
  // --- hard cases (PLAN §9.2 step 7)
  { id: "hard_place_kind", pattern: "{TOPIC|hard} {KIND}" },
  { id: "hard_place_kind_time", pattern: "{TOPIC|hard} {KIND} {TIME}" },
  { id: "hard_place_actor", pattern: "{TOPIC|hard} {KIND} $FROM {ACTOR}" },
  { id: "hard_may_name", pattern: "{KIND} $FROM {ACTOR|may}" },
  { id: "hard_may_poss", pattern: "{ACTOR|may|poss} {KIND}" },
  { id: "hard_may_say", pattern: "what did {ACTOR|may} {KIND|v} about {TOPIC}" },
  {
    id: "hard_may_modal",
    pattern: "{KIND} that may <mention|contain|affect|need|cover> {TOPIC}",
    heldOut: true,
  },
  // --- negatives: nothing to extract, or only TOPIC
  { id: "none_pure_topic", pattern: "{TOPIC}", negative: true },
  { id: "none_chitchat", make: chitchat, negative: true },
  { id: "none_gibberish", make: gibberish, negative: true },
  { id: "none_statement", make: statement, negative: true },
  { id: "none_question", make: question, negative: true },
]
