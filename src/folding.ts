// ─── Milda LSP - folding ranges ───────────────────────────────────────────────
// Every multi-line declaration span (component, context-group, part, and any token
// or type that wraps) becomes a foldable region. Derived from the same span table as
// symbols, so folds line up exactly with the outline.

import { parseMildaDocument } from '@mildastudio/milda'
import { type FoldingRange } from 'vscode-languageserver-types'

export function computeFoldingRanges(text: string): FoldingRange[] {
  const { spans } = parseMildaDocument(text)
  const ranges: FoldingRange[] = []
  for (const s of spans) {
    const startLine = s.fullRange.start.line - 1
    const endLine = s.fullRange.end.line - 1
    if (endLine > startLine) ranges.push({ startLine, endLine })
  }
  return ranges
}
