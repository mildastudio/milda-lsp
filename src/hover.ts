// ─── Milda LSP — hover ────────────────────────────────────────────────────────
// Markdown docs for the identifier under the cursor. Resolution order: a declaration
// in this document (either the cursor is on its name, or the word references it),
// then the prelude vocabulary (archetype / facet / state).

import { preludeV0, type DesignSystemDocument, type NodeSpan } from '@mildastudio/milda'
import { type Hover, MarkupKind, type Position } from 'vscode-languageserver'
import { parse, resolveDeclaration, spanAtName, wordAt } from './analysis'

export function computeHover(text: string, position: Position): Hover | null {
  const { document, spans } = parse(text)
  const w = wordAt(text, position)
  if (!w) return null

  const decl = spanAtName(spans, position) ?? resolveDeclaration(spans, w.text)
  if (decl) return hover(describeDecl(decl, document), w.range)

  const arch = preludeV0.archetypes.find((a) => a.name === w.text)
  if (arch) {
    const composes = arch.composes.length ? arch.composes.join(', ') : '—'
    return hover(`**archetype** \`${arch.name}\`\n\n${arch.contract}\n\ncomposes: ${composes}`, w.range)
  }
  const facet = preludeV0.facets.find((f) => f.name === w.text)
  if (facet) return hover(`**facet** \`${facet.name}\`\n\n${facet.covers}`, w.range)
  const state = preludeV0.states.find((s) => s.name === w.text)
  if (state) return hover(`**state** \`${state.name}\`\n\nfrom \`${state.from}\``, w.range)

  return null
}

function describeDecl(decl: NodeSpan, document: DesignSystemDocument): string {
  const head = `**${decl.kind}** \`${decl.name}\``
  switch (decl.kind) {
    case 'token': {
      const tok = document.foundations.layers.flatMap((l) => l.tokens).find((t) => t.id === decl.id)
      return tok ? `${head}\n\ntype: \`${tok.type}\` · value: \`${tok.value.kind}\`` : head
    }
    case 'component': {
      const comp = document.components.find((c) => c.id === decl.id)
      const extra = comp?.description ? `\n\n${comp.description}` : ''
      const arch = comp?.archetype ? `\n\narchetype: \`${comp.archetype}\`` : ''
      return `${head}${arch}${extra}`
    }
    case 'contextGroup': {
      const group = document.foundations.contextGroups.find((g) => g.id === decl.id)
      const members = group?.contexts.map((c) => c.name).join(', ')
      return members ? `${head}\n\n${group!.contexts.length} contexts: ${members}` : head
    }
    default:
      return head
  }
}

function hover(markdown: string, range: Hover['range']): Hover {
  return { contents: { kind: MarkupKind.Markdown, value: markdown }, range }
}
