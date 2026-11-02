// ─── Milda TextMate grammar - built from the shared vocabulary ────────────────
// VS Code (and Open VSX editors) colour a document instantly from a TextMate
// grammar, before the language server has started, and the LSP's semantic tokens
// then layer on top. To stop the two highlighters from drifting on WHICH words are
// keywords / types / colour functions, the grammar's word lists are built from the
// same ./vocab source of truth that feeds the LSP classifier and the JetBrains lexer.
//
// Two artifacts are generated from this one builder (`npm run gen:highlight`):
// packages/milda-vscode/syntaxes/ (the extension) and docs/dsl/editors/jetbrains/
// (a plugin-free TextMate bundle, the only option in JetBrains IDEs without the LSP
// API - Community editions and Android Studio). Both get the same bytes, so the
// same file cannot colour differently in the two places.
//
// This is a faithful translation of ./semantic-tokens.ts's lexical rules into
// Oniguruma regex (the engine VS Code's vscode-textmate uses). Byte-for-byte parity
// is neither required nor claimed - the LSP semantic tokens win wherever the server
// is running; the grammar is the zero-latency fallback. Vocabulary parity IS enforced
// (see ./textmate-grammar.test.ts), since that is what would actually surprise a reader.

import { COLOR_FNS, DECLARATION_KEYWORDS, KEYWORDS, LENGTH_FNS, TYPE_WORDS } from './vocab'

// The word-character class from the classifier (WORD = /[A-Za-z0-9_./%$-]/), used as
// lookaround boundaries so a keyword never matches inside a dotted path (`milda.x`).
const WORD_CLASS = 'A-Za-z0-9_./%$-'
const B0 = `(?<![${WORD_CLASS}])` // no word char immediately before
const B1 = `(?![${WORD_CLASS}])` // no word char immediately after

// Longest-first alternation so a longer literal (`srgb`) is preferred over a prefix
// (`rgb`) even though the boundary lookarounds already make them disjoint.
const alt = (words: readonly string[]): string =>
  [...words].sort((a, b) => b.length - a.length).join('|')

export interface TmRule {
  match: string
  /** The scope for the whole match. Omitted on a rule that only scopes its captures. */
  name?: string
  /** Per-capture scopes, keyed by group number - how a rule paints two things at once. */
  captures?: Record<string, { name: string }>
}

export interface TmGrammar {
  $schema: string
  name: string
  scopeName: string
  fileTypes: string[]
  patterns: { include: string }[]
  repository: Record<string, TmRule>
}

export function buildTmLanguage(): TmGrammar {
  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'Milda',
    scopeName: 'source.milda',
    // VS Code maps languages via the extension manifest and ignores this, but the
    // JetBrains TextMate loader reads it off the grammar - so the bundle needs it.
    fileTypes: ['milda'],
    // Order matters: first match at a position wins. Comments and strings are
    // char-anchored; the word classes rely on the boundary lookarounds. Variables
    // ($-led) come before dotted properties because the classifier checks `$` first.
    patterns: [
      { include: '#comment' },
      { include: '#string' },
      // Both positional rules come before the word classes: they start matching at the
      // function name / at the `:`, so they must be offered first to win there.
      { include: '#valueLiteral' },
      { include: '#declaredType' },
      { include: '#declaredName' },
      { include: '#operator' },
      { include: '#keyword' },
      { include: '#type' },
      { include: '#number' },
      { include: '#variable' },
      { include: '#property' },
    ],
    repository: {
      // Line comment - `#` to end of line.
      comment: { match: '#.*$', name: 'comment.line.number-sign.milda' },
      // Double-quoted string; unterminated runs to end of line (`"?`).
      string: { match: '"(?:\\\\.|[^"\\\\])*"?', name: 'string.quoted.double.milda' },
      // A value literal and its payload in one match: `hex(fff)`, `oklch(0.62 0.19 256)`,
      // `scaled(0.75)`. The payload is scoped as a number whether or not it looks like
      // one - `fff` and `000` are the same kind of thing, and colouring them differently
      // (which is what a word-by-word classifier does) misreads the literal.
      valueLiteral: {
        match: `${B0}(${alt([...COLOR_FNS, ...LENGTH_FNS])})(\\s*\\()([^)\\n]*)(\\))`,
        captures: {
          '1': { name: 'support.type.milda' },
          '3': { name: 'constant.numeric.milda' },
        },
      },
      // The declared type after a `:` - `token brand : color`, `size : Size`,
      // `field : string`. Positional because the type names are not a closed word list:
      // `border`, `opacity` and `shadow` are token types AND facet heads. A keyword is
      // excluded so it still reads as itself.
      declaredType: {
        match: `(:)(\\s*)(?!(?:${alt(KEYWORDS)})${B1})([A-Za-z][${WORD_CLASS}]*)`,
        captures: {
          '1': { name: 'keyword.operator.milda' },
          '3': { name: 'support.type.milda' },
        },
      },
      // A declaring keyword and the name it declares: `token brand`, `component Badge`,
      // `part root.label`. The author's own names get their own scope, so a reader can tell
      // them from the language's words at a glance.
      declaredName: {
        match: `${B0}(${alt(DECLARATION_KEYWORDS)})(\\s+)([A-Za-z_][${WORD_CLASS}]*)`,
        captures: {
          '1': { name: 'keyword.control.milda' },
          '3': { name: 'entity.name.type.milda' },
        },
      },
      // Arrows and predicate comparison / assignment operators.
      operator: { match: '->|→|<=|>=|!=|[=:]', name: 'keyword.operator.milda' },
      keyword: { match: `${B0}(?:${alt(KEYWORDS)})${B1}`, name: 'keyword.control.milda' },
      // Type words and first-class colour-literal functions share the type scope.
      type: {
        match: `${B0}(?:${alt([...TYPE_WORDS, ...COLOR_FNS, ...LENGTH_FNS])})${B1}`,
        name: 'support.type.milda',
      },
      // Numbers, including unit literals (8px, 0.5rem, 150ms, 50%).
      number: { match: `${B0}-?\\d+(?:\\.\\d+)?[a-z%]*${B1}`, name: 'constant.numeric.milda' },
      // Prop references, e.g. $value.
      variable: { match: `${B0}\\$[${WORD_CLASS}]*${B1}`, name: 'variable.parameter.milda' },
      // Dotted paths (token / machine refs), e.g. tok.color.fg.
      property: {
        match: `${B0}(?=[${WORD_CLASS}]*\\.)[${WORD_CLASS}]+${B1}`,
        name: 'variable.other.property.milda',
      },
    },
  }
}
