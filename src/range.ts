// ─── Milda LSP - position conversion ──────────────────────────────────────────
// Milda source positions (lexer, ParseIssue, NodeSpan) are 1-based in both line and
// column; LSP is 0-based in both. This is the single place that bridge lives.

import { type Range } from 'vscode-languageserver-types'
import { type SourceRange } from '@mildastudio/milda'

export function toLspRange(r: SourceRange): Range {
  return {
    start: { line: Math.max(0, r.start.line - 1), character: Math.max(0, r.start.col - 1) },
    end: { line: Math.max(0, r.end.line - 1), character: Math.max(0, r.end.col - 1) },
  }
}
