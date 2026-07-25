// ─── Milda TextMate grammar — built from the shared vocabulary ────────────────
// VS Code (and Open VSX editors) colour a document instantly from a TextMate
// grammar, before the language server has started, and the LSP's semantic tokens
// then layer on top. To stop the two highlighters from drifting on WHICH words are
// keywords / types / colour functions, the grammar's word lists are built from the
// same ./vocab source of truth that feeds the LSP classifier and the JetBrains lexer.
//
// This is a faithful translation of ./semantic-tokens.ts's lexical rules into
// Oniguruma regex (the engine VS Code's vscode-textmate uses). Byte-for-byte parity
// is neither required nor claimed — the LSP semantic tokens win wherever the server
// is running; the grammar is the zero-latency fallback. Vocabulary parity IS enforced
// (see ./vscode-grammar.test.ts), since that is what would actually surprise a reader.

import { COLOR_FNS, KEYWORDS, TYPE_WORDS } from './vocab'

// The word-character class from the classifier (WORD = /[A-Za-z0-9_./%$-]/), used as
// lookaround boundaries so a keyword never matches inside a dotted path (`milda.x`).
const WORD_CLASS = 'A-Za-z0-9_./%$-'
const B0 = `(?<![${WORD_CLASS}])` // no word char immediately before
const B1 = `(?![${WORD_CLASS}])` // no word char immediately after

// Longest-first alternation so a longer literal (`srgb`) is preferred over a prefix
// (`rgb`) even though the boundary lookarounds already make them disjoint.
const alt = (words: readonly string[]): string =>
  [...words].sort((a, b) => b.length - a.length).join('|')

export interface TmGrammar {
  $schema: string
  name: string
  scopeName: string
  patterns: { include: string }[]
  repository: Record<string, { match: string; name: string }>
}

export function buildTmLanguage(): TmGrammar {
  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'Milda',
    scopeName: 'source.milda',
    // Order matters: first match at a position wins. Comments and strings are
    // char-anchored; the word classes rely on the boundary lookarounds. Variables
    // ($-led) come before dotted properties because the classifier checks `$` first.
    patterns: [
      { include: '#comment' },
      { include: '#string' },
      { include: '#operator' },
      { include: '#keyword' },
      { include: '#type' },
      { include: '#number' },
      { include: '#variable' },
      { include: '#property' },
    ],
    repository: {
      // Line comment — `#` to end of line.
      comment: { match: '#.*$', name: 'comment.line.number-sign.milda' },
      // Double-quoted string; unterminated runs to end of line (`"?`).
      string: { match: '"(?:\\\\.|[^"\\\\])*"?', name: 'string.quoted.double.milda' },
      // Arrows and predicate comparison / assignment operators.
      operator: { match: '->|→|<=|>=|!=|[=:]', name: 'keyword.operator.milda' },
      keyword: { match: `${B0}(?:${alt(KEYWORDS)})${B1}`, name: 'keyword.control.milda' },
      // Type words and first-class colour-literal functions share the type scope.
      type: { match: `${B0}(?:${alt([...TYPE_WORDS, ...COLOR_FNS])})${B1}`, name: 'support.type.milda' },
      // Numbers, including unit literals (8px, 0.5rem, 150ms, 50%).
      number: { match: `${B0}-?\\d+(?:\\.\\d+)?[a-z%]*${B1}`, name: 'constant.numeric.milda' },
      // Prop references, e.g. $value.
      variable: { match: `${B0}\\$[${WORD_CLASS}]*${B1}`, name: 'variable.parameter.milda' },
      // Dotted paths (token / machine refs), e.g. tok.color.fg.
      property: { match: `${B0}(?=[${WORD_CLASS}]*\\.)[${WORD_CLASS}]+${B1}`, name: 'variable.other.property.milda' },
    },
  }
}
