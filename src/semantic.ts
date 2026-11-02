// ─── Milda LSP - semantic diagnostics ─────────────────────────────────────────
// The engine's `validate` pass catches meaning-level problems: unknown archetypes,
// alias-by an undeclared context group, facet/layout references to missing tokens,
// dangling param→prop bindings, unknown states.
//
// A design system spans several files, so we validate the CURRENT file merged with
// its siblings (see project.ts), then report only the issues whose entity is declared
// in the current file (via the issue's `id` → the current file's span table). That
// way a token defined in `foundations.milda` no longer looks "missing" when you edit
// `actions.milda`, and each real problem is reported on the file that owns it.

import {
  parseMildaDocument,
  preludeV0,
  validate,
  type DesignSystemDocument,
  type Layer,
  type NodeSpan,
  type Project,
} from '@mildastudio/milda'
import { type Diagnostic, DiagnosticSeverity } from 'vscode-languageserver-types'
import { toLspRange } from './range'

export const SEMANTIC_SOURCE = 'milda-semantic'

export function computeSemanticDiagnostics(
  text: string,
  siblingTexts: string[] = [],
): Diagnostic[] {
  const current = parseMildaDocument(text)
  const merged = mergeDocuments([
    current.document,
    ...siblingTexts.map((t) => parseMildaDocument(t).document),
  ])

  // `validate` reads only `foundations` and `components`, both present on the merged
  // document; the cast supplies the `Project` shape without a real asset registry.
  let issues
  try {
    issues = validate(merged as unknown as Project, preludeV0)
  } catch {
    return [] // never let a validator hiccup suppress the syntactic diagnostics
  }

  // Only surface issues about entities declared in THIS file; a sibling's issues
  // belong to the sibling's editor view.
  const spanById = new Map<string, NodeSpan>(current.spans.map((s) => [s.id, s]))
  const out: Diagnostic[] = []
  for (const issue of issues) {
    const span = issue.id ? spanById.get(issue.id) : undefined
    if (!span) continue
    out.push({
      severity: issue.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      range: toLspRange(span.nameRange),
      code: issue.code,
      source: SEMANTIC_SOURCE,
      message: issue.message,
    })
  }
  return out
}

// Combine several parsed documents into one design system: concatenate context
// groups / shared types / components, and merge token layers by id.
function mergeDocuments(docs: DesignSystemDocument[]): DesignSystemDocument {
  const layers = new Map<string, Layer>()
  for (const d of docs) {
    for (const l of d.foundations.layers) {
      const existing = layers.get(l.id)
      if (existing) existing.tokens.push(...l.tokens)
      else layers.set(l.id, { ...l, tokens: [...l.tokens] })
    }
  }
  return {
    ...docs[0],
    foundations: {
      contextGroups: docs.flatMap((d) => d.foundations.contextGroups),
      layers: [...layers.values()],
      sharedTypes: docs.flatMap((d) => d.foundations.sharedTypes),
      metadata: docs.flatMap((d) => d.foundations.metadata),
    },
    components: docs.flatMap((d) => d.components),
  }
}
