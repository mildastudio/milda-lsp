// ─── Milda LSP - document symbols ─────────────────────────────────────────────
// Turns the parser's span side-table (NodeSpan) into a hierarchical outline: the
// component/token/context-group/type declarations at the top level, with parts,
// props, events (and context members) nested underneath via `parentId`. Powers the
// editor's Structure/Outline view and breadcrumbs.

import { parseMildaDocument, type SpanKind } from '@mildastudio/milda'
import { type DocumentSymbol, type Range, SymbolKind } from 'vscode-languageserver-types'
import { toLspRange } from './range'

const KIND: Record<SpanKind, SymbolKind> = {
  component: SymbolKind.Class,
  token: SymbolKind.Constant,
  contextGroup: SymbolKind.Enum,
  context: SymbolKind.EnumMember,
  sharedType: SymbolKind.Interface,
  globalProp: SymbolKind.Property,
  rule: SymbolKind.Event,
  part: SymbolKind.Field,
  prop: SymbolKind.Property,
  event: SymbolKind.Event,
}

export function computeDocumentSymbols(text: string): DocumentSymbol[] {
  const { spans } = parseMildaDocument(text)

  // Pass 1: one symbol per span, indexed by id (spans may be recorded child-before
  // parent, so we can't nest until every node exists).
  const nodes = new Map<string, DocumentSymbol>()
  for (const s of spans) {
    const full = toLspRange(s.fullRange)
    nodes.set(s.id, {
      name: s.name,
      kind: KIND[s.kind],
      range: full,
      selectionRange: clampSelection(toLspRange(s.nameRange), full),
      children: [],
    })
  }

  // Pass 2: nest by parentId; a span whose parent is unknown becomes a root.
  const roots: DocumentSymbol[] = []
  for (const s of spans) {
    const node = nodes.get(s.id)
    if (!node) continue
    const parent = s.parentId ? nodes.get(s.parentId) : undefined
    if (parent) parent.children!.push(node)
    else roots.push(node)
  }
  return roots
}

// LSP requires selectionRange ⊆ range. The name is normally inside the declaration,
// but if the widening ever produced something out of bounds, fall back to the head
// of the full range rather than emit an invalid symbol some clients reject.
function clampSelection(sel: Range, full: Range): Range {
  const lte = (a: Range['start'], b: Range['start']) =>
    a.line < b.line || (a.line === b.line && a.character <= b.character)
  if (lte(full.start, sel.start) && lte(sel.end, full.end)) return sel
  return { start: full.start, end: full.start }
}
