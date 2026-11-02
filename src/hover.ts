// ─── Milda LSP - hover ────────────────────────────────────────────────────────
// Markdown docs for the identifier under the cursor. Resolution order: a declaration
// in this document (either the cursor is on its name, or the word references it),
// then the prelude vocabulary (archetype / facet / state).

import {
  anatomyIndex,
  NODE_KINDS,
  preludeV0,
  type DesignSystemDocument,
  type NodeSpan,
} from '@mildastudio/milda'
import { type Hover, MarkupKind, type Position } from 'vscode-languageserver-types'
import { parse, resolveDeclaration, spanAtName, wordAt } from './analysis'

export function computeHover(text: string, position: Position): Hover | null {
  const { document, spans } = parse(text)
  const w = wordAt(text, position)
  if (!w) return null

  // A node kind where a kind is said - `part Button: container` or `kind container`. Checked
  // first: `container` is not a declaration, but `text` could collide with an author's name.
  const before = (text.split('\n')[position.line] ?? '').slice(0, w.range.start.character)
  if (NODE_KINDS.includes(w.text) && KIND_POSITION.test(before)) {
    return hover(
      `**kind** \`${w.text}\`\n\nWhat the part IS, in neutral terms: the platform element is the target's decision.`,
      w.range,
    )
  }

  const decl = spanAtName(spans, position) ?? resolveDeclaration(spans, w.text)
  if (decl) return hover(describeDecl(decl, document), w.range)

  const arch = preludeV0.archetypes.find((a) => a.name === w.text)
  if (arch) {
    const composes = arch.composes.length ? arch.composes.join(', ') : '-'
    return hover(
      `**archetype** \`${arch.name}\`\n\n${arch.contract}\n\ncomposes: ${composes}`,
      w.range,
    )
  }
  const facet = preludeV0.facets.find((f) => f.name === w.text)
  if (facet) return hover(`**facet** \`${facet.name}\`\n\n${facet.covers}`, w.range)
  const state = preludeV0.states.find((s) => s.name === w.text)
  if (state) return hover(`**state** \`${state.name}\`\n\nfrom \`${state.from}\``, w.range)

  return null
}

// The two places a part's kind is written: the header after the part's path (0055), and the
// `kind` statement in its body.
const KIND_POSITION = /(?:\bpart\s+[^\s:{]+\s*:|(?:^|\s)kind)\s*$/

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
    case 'part': {
      // What the part IS, whichever spelling said it - the reader lowered both to one field -
      // and whether the archetype requires it, which is what the editor will not let go of.
      const owner = document.components.find((c) => c.id === decl.parentId)
      const part = owner?.anatomy?.[decl.name]
      if (!owner || !part?.kind) return head
      const entry = anatomyIndex(owner.archetype).get(decl.name.split('.').pop() ?? decl.name)
      const required = entry && !entry.optional ? ` · required by \`${owner.archetype}\`` : ''
      return `${head}\n\nkind: \`${part.kind}\`${required}`
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
