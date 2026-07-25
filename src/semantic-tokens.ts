// ─── Milda LSP — semantic tokens (syntax highlighting) ────────────────────────
// JetBrains (2024.2+) and other LSP clients colour a document from the server's
// `textDocument/semanticTokens/full` response, so highlighting travels with the
// language server instead of a per-editor grammar. This is a lightweight lexical
// classifier (keywords, types, strings, numbers, comments, dotted refs, prop refs);
// it mirrors the DSL lexer's rules but also keeps comments, which `lex()` discards.
//
// Output is the LSP delta encoding: 5 ints per token — deltaLine, deltaStartChar,
// length, tokenTypeIndex, tokenModifiers — ordered by position. Every token is
// single-line (strings can't span lines; comments run to end-of-line), so no token
// ever needs splitting across rows.

import { COLOR_FNS as COLOR_FN_LIST, KEYWORDS as KEYWORD_LIST, TYPE_WORDS as TYPE_WORD_LIST } from './vocab'

export const SEMANTIC_TOKEN_TYPES = [
  'keyword',
  'type',
  'string',
  'number',
  'comment',
  'property',
  'variable',
  'operator',
] as const

export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number]

const TYPE_INDEX: Record<SemanticTokenType, number> = Object.fromEntries(
  SEMANTIC_TOKEN_TYPES.map((t, i) => [t, i]),
) as Record<SemanticTokenType, number>

// Word sets come from the shared vocabulary (./vocab) — the same lists code-generated
// into the plugin's Kotlin lexer, so the two highlighters never drift.
const KEYWORDS = new Set<string>(KEYWORD_LIST)
const TYPE_WORDS = new Set<string>(TYPE_WORD_LIST)
const COLOR_FNS = new Set<string>(COLOR_FN_LIST)
const NUMBER_RE = /^-?\d+(\.\d+)?[a-z%]*$/
const WORD = /[A-Za-z0-9_./%$-]/

interface HToken {
  line: number
  startChar: number
  length: number
  type: SemanticTokenType
}

export function computeSemanticTokens(text: string): { data: number[] } {
  const tokens = scan(text)
  const data: number[] = []
  let prevLine = 0
  let prevChar = 0
  for (const t of tokens) {
    const deltaLine = t.line - prevLine
    const deltaChar = deltaLine === 0 ? t.startChar - prevChar : t.startChar
    data.push(deltaLine, deltaChar, t.length, TYPE_INDEX[t.type], 0)
    prevLine = t.line
    prevChar = t.startChar
  }
  return { data }
}

export interface DecodedSemanticToken {
  line: number
  char: number
  length: number
  type: SemanticTokenType
}

// Reverse the LSP delta encoding back into absolute tokens — used by the golden
// generator and the parity tests so the Kotlin lexer can be compared against these.
export function decodeSemanticTokens(data: number[]): DecodedSemanticToken[] {
  const out: DecodedSemanticToken[] = []
  let line = 0
  let char = 0
  for (let k = 0; k < data.length; k += 5) {
    const deltaLine = data[k]
    const deltaChar = data[k + 1]
    line += deltaLine
    char = deltaLine === 0 ? char + deltaChar : deltaChar
    out.push({ line, char, length: data[k + 2], type: SEMANTIC_TOKEN_TYPES[data[k + 3]] })
  }
  return out
}

function scan(text: string): HToken[] {
  const tokens: HToken[] = []
  const lines = text.split('\n')
  for (let line = 0; line < lines.length; line++) {
    const s = lines[line]
    let i = 0
    while (i < s.length) {
      const c = s[i]
      if (c === ' ' || c === '\t' || c === '\r') {
        i++
        continue
      }
      // Line comment — the rest of the row.
      if (c === '#') {
        tokens.push({ line, startChar: i, length: s.length - i, type: 'comment' })
        break
      }
      // String literal (single line; unterminated runs to end-of-line).
      if (c === '"') {
        const start = i
        i++
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\') i++
          i++
        }
        if (i < s.length) i++ // closing quote
        tokens.push({ line, startChar: start, length: i - start, type: 'string' })
        continue
      }
      // Arrow.
      if (c === '-' && s[i + 1] === '>') {
        tokens.push({ line, startChar: i, length: 2, type: 'operator' })
        i += 2
        continue
      }
      if (c === '→') {
        tokens.push({ line, startChar: i, length: 1, type: 'operator' })
        i++
        continue
      }
      // Comparison operators (predicate leaves).
      if ((c === '<' || c === '>' || c === '!') && s[i + 1] === '=') {
        tokens.push({ line, startChar: i, length: 2, type: 'operator' })
        i += 2
        continue
      }
      if (c === '=' || c === ':') {
        tokens.push({ line, startChar: i, length: 1, type: 'operator' })
        i++
        continue
      }
      // Word (ident / path / number), stopping before an arrow.
      if (WORD.test(c)) {
        const start = i
        while (i < s.length && WORD.test(s[i]) && !(s[i] === '-' && s[i + 1] === '>')) i++
        const type = classify(s.slice(start, i))
        if (type) tokens.push({ line, startChar: start, length: i - start, type })
        continue
      }
      // Braces / parens / brackets / commas etc. are left uncoloured.
      i++
    }
  }
  return tokens
}

function classify(word: string): SemanticTokenType | null {
  if (NUMBER_RE.test(word)) return 'number'
  if (KEYWORDS.has(word)) return 'keyword'
  if (TYPE_WORDS.has(word) || COLOR_FNS.has(word)) return 'type'
  if (word.startsWith('$')) return 'variable' // prop ref, e.g. $value
  if (word.includes('.')) return 'property' // dotted path: token / machine ref
  return null // plain identifiers keep the default colour
}
