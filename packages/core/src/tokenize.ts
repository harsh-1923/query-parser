import type { Token } from "./types"

// Deterministic pre-tokenizer (PLAN §6.2, §5.8). Patterns are tried in order at each position;
// anything that matches none of them (whitespace, punctuation other than ",") is skipped.

const QUOTED_OPERATOR = /([A-Za-z][A-Za-z_]*):"([^"]*)"/y
const OPERATOR = /([A-Za-z][A-Za-z_]*):([^\s"]\S*)/y
const EMAIL = /[\p{L}\p{N}_.+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/uy
const HANDLE = /[#@][\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*/uy
const NUMBER = /\p{N}[\p{L}\p{N}_]*(?:[/:.-]\p{N}[\p{L}\p{N}_]*)*/uy
const WORD = /[\p{L}_][\p{L}\p{N}_]*(?:[.-][\p{L}\p{N}_]+)*(?:['’]\p{L}+)?/uy
const POSSESSIVE = /^['’][sS]$/
const HANDLE_POSSESSIVE = /['’][sS](?![\p{L}\p{N}])/uy
const TRAILING_PUNCT = /[.,;:!?)\]]+$/

function matchAt(re: RegExp, text: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos
  return re.exec(text)
}

export function tokenize(query: string): Token[] {
  const tokens: Token[] = []
  let pos = 0
  while (pos < query.length) {
    const ch = query.charAt(pos)
    if (/\s/u.test(ch)) {
      pos++
      continue
    }
    if (ch === ",") {
      tokens.push({ text: ",", start: pos, end: pos + 1 })
      pos++
      continue
    }

    const quoted = matchAt(QUOTED_OPERATOR, query, pos)
    if (quoted) {
      const end = pos + quoted[0].length
      tokens.push({
        text: quoted[0],
        start: pos,
        end,
        operator: { key: quoted[1] ?? "", value: quoted[2] ?? "" },
      })
      pos = end
      continue
    }

    const op = matchAt(OPERATOR, query, pos)
    if (op && !(op[2] ?? "").startsWith("//")) {
      const value = (op[2] ?? "").replace(TRAILING_PUNCT, "")
      if (value) {
        const key = op[1] ?? ""
        const end = pos + key.length + 1 + value.length
        tokens.push({ text: query.slice(pos, end), start: pos, end, operator: { key, value } })
        pos = end
        continue
      }
    }

    const simple = matchAt(EMAIL, query, pos) ?? matchAt(HANDLE, query, pos)
    if (simple) {
      const text = simple[0].replace(/[.-]+$/, "")
      tokens.push({ text, start: pos, end: pos + text.length })
      pos += text.length
      const poss = matchAt(HANDLE_POSSESSIVE, query, pos)
      if (poss) {
        tokens.push({ text: poss[0], start: pos, end: pos + poss[0].length })
        pos += poss[0].length
      }
      continue
    }

    const num = matchAt(NUMBER, query, pos)
    if (num) {
      tokens.push({ text: num[0], start: pos, end: pos + num[0].length })
      pos += num[0].length
      continue
    }

    const word = matchAt(WORD, query, pos)
    if (word) {
      const full = word[0]
      const apos = full.search(/['’]/)
      if (apos > 0 && POSSESSIVE.test(full.slice(apos))) {
        tokens.push({ text: full.slice(0, apos), start: pos, end: pos + apos })
        tokens.push({ text: full.slice(apos), start: pos + apos, end: pos + full.length })
      } else {
        tokens.push({ text: full, start: pos, end: pos + full.length })
      }
      pos += full.length
      continue
    }

    pos++
  }
  return tokens
}
