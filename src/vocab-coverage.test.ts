import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COLOR_FNS, DECLARATION_KEYWORDS, KEYWORDS, LENGTH_FNS, TYPE_WORDS } from './vocab'

// ─── Every word the reader knows has a decision here ─────────────────────────
// The highlight vocabulary is hand-kept, deliberately: a word that is also a likely name is left
// plain (see the note on KEYWORDS). What was missing is the other half - nothing noticed when the
// parser learned a word and this file never heard of it, so the editors (and, through
// gen:highlight, the JetBrains lexer) silently showed new syntax as plain text. Now a new parser
// keyword fails here until it is either highlighted or listed below with why it is not.
//
// The words are read off the parser the same way the docs reference test reads them. The
// standalone milda-lsp mirror has no parser source beside it, so the test is skipped there.

const here = dirname(fileURLToPath(import.meta.url))
const parser = join(here, '..', '..', 'milda', 'dsl', 'parse.ts')

const NAME_LIKE =
  'a plausible name for a part, prop, token or page, so colouring it as syntax misleads'
const VALUE_WORD =
  'a value or option word inside a statement, coloured by position rather than as a keyword'

const NOT_HIGHLIGHTED: Record<string, string> = {
  action: NAME_LIKE,
  alt: NAME_LIKE,
  asset: NAME_LIKE,
  backdrop: NAME_LIKE,
  cell: NAME_LIKE,
  content: NAME_LIKE,
  control: NAME_LIKE,
  error: NAME_LIKE,
  footer: NAME_LIKE,
  group: NAME_LIKE,
  height: NAME_LIKE,
  link: NAME_LIKE,
  max: NAME_LIKE,
  media: NAME_LIKE,
  min: NAME_LIKE,
  name: NAME_LIKE,
  page: NAME_LIKE,
  role: NAME_LIKE,
  site: NAME_LIKE,
  source: NAME_LIKE,
  tokens: NAME_LIKE,
  value: NAME_LIKE,
  warning: NAME_LIKE,
  width: NAME_LIKE,
  browse: VALUE_WORD,
  contains: VALUE_WORD,
  delay: VALUE_WORD,
  dismiss: VALUE_WORD,
  duration: VALUE_WORD,
  easing: VALUE_WORD,
  global: VALUE_WORD,
  in: VALUE_WORD,
  sample: VALUE_WORD,
  set: VALUE_WORD,
  static: VALUE_WORD,
  under: VALUE_WORD,
  url: VALUE_WORD,
  custom: NAME_LIKE,
  folder: NAME_LIKE,
  for: NAME_LIKE,
  glyph: NAME_LIKE,
  kind: NAME_LIKE,
  only: NAME_LIKE,
  origin: NAME_LIKE,
}

describe('the highlight vocabulary and the parser', () => {
  it.skipIf(!existsSync(parser))('has a decision for every word the parser matches', () => {
    const src = readFileSync(parser, 'utf8')
    const words = new Set(
      [
        ...src.matchAll(/\b(?:atWord|expectRuleWord)\('([A-Za-z][A-Za-z0-9-]*)'\)/g),
        ...src.matchAll(/\.value === '([a-z][a-z0-9-]*)'/g),
      ].map((m) => m[1] as string),
    )
    expect(words.size).toBeGreaterThan(50) // a reader that finds nothing would pass everything
    const highlighted = new Set([
      ...KEYWORDS,
      ...TYPE_WORDS,
      ...DECLARATION_KEYWORDS,
      ...COLOR_FNS,
      ...LENGTH_FNS,
    ])
    const undecided = [...words].filter((w) => !highlighted.has(w) && !(w in NOT_HIGHLIGHTED))
    expect(undecided.sort()).toEqual([])
    // An entry for a word the parser dropped, or one that is now highlighted, is stale.
    const stale = Object.keys(NOT_HIGHLIGHTED).filter((w) => !words.has(w) || highlighted.has(w))
    expect(stale).toEqual([])
  })
})
