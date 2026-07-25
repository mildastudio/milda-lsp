// ─── Milda LSP — shared analysis ──────────────────────────────────────────────
// Position-oriented helpers shared by completion, hover, and definition. Everything
// here works off the M2 span table plus the current line text; there is no second
// parse of the grammar. References resolve to declarations by (kind, name) so we
// never re-derive the parser's ids and risk drift.

import { parseMildaDocument, type DesignSystemDocument, type NodeSpan } from '@mildastudio/milda'
import { type Position, type Range } from 'vscode-languageserver'
import { toLspRange } from './range'

export interface Parsed {
  document: DesignSystemDocument
  spans: NodeSpan[]
}

export function parse(text: string): Parsed {
  const { document, spans } = parseMildaDocument(text)
  return { document, spans }
}

// Identifier / dotted-path / prop-ref characters (superset of the lexer's word class,
// plus `$` for prop refs like `$value`). A token ref such as `space.2` is one word.
const WORD = /[A-Za-z0-9_./%$-]/

export interface WordAt {
  text: string
  range: Range
}

/** The identifier under (or immediately around) the cursor, with its range. */
export function wordAt(text: string, position: Position): WordAt | null {
  const line = text.split('\n')[position.line] ?? ''
  let s = position.character
  let e = position.character
  while (s > 0 && WORD.test(line[s - 1] ?? '')) s--
  while (e < line.length && WORD.test(line[e] ?? '')) e++
  if (s === e) return null
  return {
    text: line.slice(s, e),
    range: { start: { line: position.line, character: s }, end: { line: position.line, character: e } },
  }
}

function contains(range: Range, p: Position): boolean {
  const afterStart =
    p.line > range.start.line || (p.line === range.start.line && p.character >= range.start.character)
  const beforeEnd =
    p.line < range.end.line || (p.line === range.end.line && p.character <= range.end.character)
  return afterStart && beforeEnd
}

/** Innermost declaration span whose full range contains the position. */
export function enclosingSpan(spans: NodeSpan[], position: Position): NodeSpan | null {
  let best: NodeSpan | null = null
  let bestSize = Infinity
  for (const s of spans) {
    const r = toLspRange(s.fullRange)
    if (!contains(r, position)) continue
    const size = (r.end.line - r.start.line) * 100000 + (r.end.character - r.start.character)
    if (size < bestSize) {
      bestSize = size
      best = s
    }
  }
  return best
}

/** The declaration whose name identifier the cursor sits on (not a reference). */
export function spanAtName(spans: NodeSpan[], position: Position): NodeSpan | null {
  for (const s of spans) if (contains(toLspRange(s.nameRange), position)) return s
  return null
}

/**
 * Resolve a reference word to the declaration it names. Tokens match either their
 * raw path (`space/2`) or the dotted ref form (`space.2`); everything else matches by
 * exact name. Declaration order in `spans` breaks ties (first wins).
 */
export function resolveDeclaration(spans: NodeSpan[], word: string): NodeSpan | null {
  const dotted = word.replace(/\//g, '.')
  for (const s of spans) {
    if (s.kind === 'token' && (s.name === word || s.name.replace(/\//g, '.') === dotted)) return s
  }
  for (const kind of ['component', 'sharedType', 'contextGroup', 'context'] as const) {
    for (const s of spans) if (s.kind === kind && s.name === word) return s
  }
  return null
}
