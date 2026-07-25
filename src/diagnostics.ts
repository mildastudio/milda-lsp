// ─── Milda LSP — diagnostics ──────────────────────────────────────────────────
// The pure, transport-free core of the language server: source text → LSP
// diagnostics. It reuses @mildastudio/milda's error-recovering parser, so this
// stays a thin mapping layer rather than a second implementation of the grammar.
//
// Two shape mismatches are bridged here:
//   • The parser reports 1-based line/col; LSP wants 0-based line/character.
//   • The parser anchors an issue at a single POINT (a token's start). LSP wants a
//     RANGE, so we widen the anchor to the extent of the token underneath it — the
//     whole word/path/number, or a string literal up to its closing quote — falling
//     back to a single column when the anchor sits on punctuation or past EOL.
//
// Extending the parser's AST to carry real spans is a later slice (M2); until then
// this text-based widening gives squiggles that cover the offending token, which is
// all the point diagnostics allow. Semantic validation (engine/validate) is also
// M2 — its issues are position-free today, so surfacing them here would pile every
// one on line 1.

import { parseMildaDocument, type ParseIssue, type ParseOptions } from '@mildastudio/milda'
import { type Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver'

/** Tag shown next to every diagnostic so users can tell it came from this server. */
export const DIAGNOSTIC_SOURCE = 'milda'

// Word characters per the DSL lexer (packages/milda/dsl/lexer.ts `isWordChar`).
// Used to widen a point anchor to the identifier/path/number sitting under it.
const WORD_CHAR = /[A-Za-z0-9_./%-]/

/** Parse `text` and return one LSP diagnostic per recoverable parser issue. */
export function computeDiagnostics(text: string, opts: ParseOptions = {}): Diagnostic[] {
  const { issues } = parseMildaDocument(text, opts)
  const lines = text.split('\n')
  return issues.filter((issue) => !SUPPRESSED_CODES.has(issue.code)).map((issue) => toDiagnostic(issue, lines))
}

// Internal lowering notes that are ubiquitous and never actionable now that values are
// first-class — dropped from the editor entirely (the parser still records them for
// programmatic consumers):
//   inline-literal — every inline value literal in an alias slot is hoisted to a token.
//   ref-sugar      — every unconditional ref lowers to a default-only alias.
const SUPPRESSED_CODES = new Set(['inline-literal', 'ref-sugar'])

// A benign informational note, kept but softened to a Hint (subtle, not a warning
// squiggle): `axis-fixed` — a bare `fixed` axis with no dimension is treated as `fit`.
const HINT_CODES = new Set(['axis-fixed'])

function severityOf(issue: ParseIssue): DiagnosticSeverity {
  if (issue.severity === 'error') return DiagnosticSeverity.Error
  if (HINT_CODES.has(issue.code)) return DiagnosticSeverity.Hint
  return DiagnosticSeverity.Warning
}

function toDiagnostic(issue: ParseIssue, lines: string[]): Diagnostic {
  return {
    severity: severityOf(issue),
    range: pointToRange(lines, issue.line, issue.col),
    code: issue.code,
    source: DIAGNOSTIC_SOURCE,
    message: issue.message,
  }
}

/**
 * Widen a 1-based (line, col) point anchor into a 0-based LSP range covering the
 * token underneath it. Always at least one column wide so the squiggle is visible.
 */
function pointToRange(lines: string[], line1: number, col1: number): Range {
  const line = Math.max(0, line1 - 1)
  const lineText = lines[line] ?? ''
  const start = Math.min(Math.max(0, col1 - 1), lineText.length)
  const head = lineText[start] ?? ''

  let end = start
  if (head === '"') {
    // String literal: span to the closing quote, or to EOL if unterminated.
    end = start + 1
    while (end < lineText.length && lineText[end] !== '"') {
      if (lineText[end] === '\\') end++ // skip an escaped character
      end++
    }
    if (end < lineText.length) end++ // include the closing quote
  } else if (WORD_CHAR.test(head)) {
    while (end < lineText.length && WORD_CHAR.test(lineText[end])) end++
  } else {
    end = start + 1
  }

  return Range.create(line, start, line, Math.max(end, start + 1))
}
