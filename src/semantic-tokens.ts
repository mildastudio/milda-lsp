// ─── Milda LSP - semantic tokens (syntax highlighting) ────────────────────────
// JetBrains (2024.2+) and other LSP clients colour a document from the server's
// `textDocument/semanticTokens/full` response, so highlighting travels with the
// language server instead of a per-editor grammar. This is a lightweight lexical
// classifier (keywords, types, strings, numbers, comments, dotted refs, prop refs);
// it mirrors the DSL lexer's rules but also keeps comments, which `lex()` discards.
//
// Output is the LSP delta encoding: 5 ints per token - deltaLine, deltaStartChar,
// length, tokenTypeIndex, tokenModifiers - ordered by position. Every token is
// single-line (strings can't span lines; comments run to end-of-line), so no token
// ever needs splitting across rows.

import {
  COLOR_FNS as COLOR_FN_LIST,
  DECLARATION_KEYWORDS as DECLARATION_KEYWORD_LIST,
  KEYWORDS as KEYWORD_LIST,
  LENGTH_FNS as LENGTH_FN_LIST,
  TYPE_WORDS as TYPE_WORD_LIST,
} from './vocab'

export const SEMANTIC_TOKEN_TYPES = [
  'keyword',
  'type',
  'string',
  'number',
  'comment',
  'property',
  'variable',
  'operator',
  // A name this file DECLARES (a token, a component, a part, …). `class` is the standard
  // LSP type nearest to "an entity declared here"; what matters is that it is not the same
  // colour as the language's own words, so a reader can tell the two apart.
  'class',
] as const

export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number]

const TYPE_INDEX: Record<SemanticTokenType, number> = Object.fromEntries(
  SEMANTIC_TOKEN_TYPES.map((t, i) => [t, i]),
) as Record<SemanticTokenType, number>

// Word sets come from the shared vocabulary (./vocab) - the same lists code-generated
// into the plugin's Kotlin lexer, so the two highlighters never drift.
const KEYWORDS = new Set<string>(KEYWORD_LIST)
const TYPE_WORDS = new Set<string>(TYPE_WORD_LIST)
const COLOR_FNS = new Set<string>(COLOR_FN_LIST)
const LENGTH_FNS = new Set<string>(LENGTH_FN_LIST)
const NUMBER_RE = /^-?\d+(\.\d+)?[a-z%]*$/
const WORD = /[A-Za-z0-9_./%$-]/
const LITERAL_FNS = new Set<string>([...COLOR_FN_LIST, ...LENGTH_FN_LIST])
const DECLARATION_KEYWORDS = new Set<string>(DECLARATION_KEYWORD_LIST)

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

// Reverse the LSP delta encoding back into absolute tokens - used by the golden
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
    // The two pieces of position the classifier needs (both reset at end-of-line, so a
    // stray `(` or `:` can never repaint the rest of the file):
    //   argDepth  - inside the parentheses of a value literal (`hex(…)`, `oklch(…)`,
    //               `scaled(…)`), where every word is part of the VALUE. Without this,
    //               `hex(000)` came out a number and `hex(fff)` came out plain, so one
    //               colour literal read as two different things.
    //   afterColon - the word right after a `:` is the declared TYPE (`token x : color`,
    //               `size : Size`, `field : string`). Type names can't be a word list:
    //               `border`, `opacity` and `shadow` are token types AND facet heads, so
    //               only the position tells them apart.
    let argDepth = 0
    let pendingFn = false // a literal function name was just read; `(` opens its args
    let afterColon = false
    let afterDecl = false // a declaring keyword was just read; the next word is its NAME
    while (i < s.length) {
      const c = s[i]
      // Whitespace first, and without touching the state: a literal may be written
      // `hex (fff)` and a type `x : color`, so a gap must not end either.
      if (c === ' ' || c === '\t' || c === '\r') {
        i++
        continue
      }
      // Every other token consumes the state, so it is read and cleared in ONE place - a
      // branch that forgot to clear it would silently paint the rest of the line.
      const inArgs = argDepth > 0
      const wasPendingFn = pendingFn
      const wasAfterColon = afterColon
      const wasAfterDecl = afterDecl
      pendingFn = false
      afterColon = false
      afterDecl = false
      if (c === '(') {
        if (wasPendingFn) argDepth = 1
        else if (argDepth > 0) argDepth++
        i++
        continue
      }
      if (c === ')') {
        if (argDepth > 0) argDepth--
        i++
        continue
      }
      // Line comment - the rest of the row.
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
        afterColon = c === ':'
        i++
        continue
      }
      // Word (ident / path / number), stopping before an arrow.
      if (WORD.test(c)) {
        const start = i
        while (i < s.length && WORD.test(s[i]) && !(s[i] === '-' && s[i + 1] === '>')) i++
        const word = s.slice(start, i)
        const type = classify(word, inArgs, wasAfterColon, wasAfterDecl)
        if (type) tokens.push({ line, startChar: start, length: i - start, type })
        pendingFn = LITERAL_FNS.has(word)
        afterDecl = DECLARATION_KEYWORDS.has(word)
        continue
      }
      // Braces / brackets / commas etc. are left uncoloured.
      i++
    }
  }
  return tokens
}

/**
 * One word to one colour. `inArgs` says the word sits inside a value literal's parentheses,
 * `afterColon` that it follows a `:`, and `afterDecl` that it follows a declaring keyword -
 * the three facts a word list alone cannot supply (see the state in `scan`).
 */
function classify(
  word: string,
  inArgs: boolean,
  afterColon: boolean,
  afterDecl: boolean,
): SemanticTokenType | null {
  // Inside `hex(…)` / `oklch(…)` / `scaled(…)` every word is the literal's value, digits
  // or not: `fff` is as numeric as `000`, and reading one as a number and the other as an
  // identifier said something about the colour that isn't true.
  if (inArgs) return 'number'
  if (NUMBER_RE.test(word)) return 'number'
  if (KEYWORDS.has(word)) return 'keyword'
  if (TYPE_WORDS.has(word) || COLOR_FNS.has(word) || LENGTH_FNS.has(word)) return 'type'
  // A declared type: `token brand : color`, `size : Size`, `field : string`. Checked after
  // the word sets so a keyword after a `:` still reads as itself.
  if (afterColon) return 'type'
  // A name this file declares: `token brand`, `component Badge`, `part root.label`. Before
  // the dotted-path rule, because a part's name IS a dotted path and it is a declaration
  // here, not a reference.
  if (afterDecl) return 'class'
  if (word.startsWith('$')) return 'variable' // prop ref, e.g. $value
  if (word.includes('.')) return 'property' // dotted path: token / machine ref
  return null // plain identifiers keep the default colour
}
