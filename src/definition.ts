// ─── Milda LSP — go-to-definition ─────────────────────────────────────────────
// Jump from a reference (a token ref in a facet value, a component/type name) to the
// declaration it names. Resolution is by (kind, name) via the M2 span table; the
// target is the declaration's name range so the cursor lands on the identifier.

import { type Location, type Position } from 'vscode-languageserver'
import { parse, resolveDeclaration, wordAt } from './analysis'
import { toLspRange } from './range'

export function computeDefinition(text: string, uri: string, position: Position): Location | null {
  const { spans } = parse(text)
  const w = wordAt(text, position)
  if (!w) return null
  const decl = resolveDeclaration(spans, w.text)
  if (!decl) return null
  return { uri, range: toLspRange(decl.nameRange) }
}
