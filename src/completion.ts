// ─── Milda LSP — completion ───────────────────────────────────────────────────
// Context-aware suggestions. Context comes from two cheap signals: the token right
// before the cursor on the current line, and the innermost declaration span the
// cursor sits inside (from the M2 span table). Vocabulary is the live prelude, so it
// never drifts from the language definition.

import { preludeV0 } from '@mildastudio/milda'
import { type CompletionItem, CompletionItemKind, type Position } from 'vscode-languageserver'
import { enclosingSpan, parse } from './analysis'

const WORD_TAIL = /[A-Za-z0-9_./%$-]+$/

const COMPONENT_KEYWORDS = [
  'archetype',
  'meta',
  'props',
  'events',
  'uses',
  'wire',
  'gate',
  'part',
  'realize',
  'requires',
  'motion',
]
const PART_KEYWORDS = ['layout', 'state', 'when', 'present', 'slot']
const TOP_KEYWORDS = ['milda', 'prelude', 'meta', 'context-group', 'foundations', 'type', 'component']

export function computeCompletions(text: string, position: Position): CompletionItem[] {
  const { spans } = parse(text)
  const line = text.split('\n')[position.line] ?? ''
  const before = line.slice(0, position.character)
  const partial = WORD_TAIL.exec(before)?.[0] ?? ''
  const prevWord = WORD_TAIL.exec(before.slice(0, before.length - partial.length).trimEnd())?.[0] ?? ''

  const facets = preludeV0.facets
  const facetSet = new Set<string>(facets.map((f) => f.name))

  // 1. `archetype ▐` → archetype names.
  if (prevWord === 'archetype') {
    return preludeV0.archetypes.map((a) => item(a.name, CompletionItemKind.Class, a.contract))
  }
  // 2. `state ▐` → UI-state names.
  if (prevWord === 'state') {
    return preludeV0.states.map((s) => item(s.name, CompletionItemKind.EnumMember, `from ${s.from}`))
  }
  // 3. `fill ▐` (any facet) → token references declared in this document.
  if (facetSet.has(prevWord)) {
    return tokenRefItems(spans)
  }

  const enclosing = enclosingSpan(spans, position)
  // 4. Inside a part → part keywords + facet names.
  if (enclosing?.kind === 'part') {
    return [
      ...PART_KEYWORDS.map((k) => item(k, CompletionItemKind.Keyword)),
      ...facets.map((f) => item(f.name, CompletionItemKind.Field, f.covers)),
    ]
  }
  // 5. Inside a component (outside any part) → component-body keywords.
  if (enclosing?.kind === 'component') {
    return COMPONENT_KEYWORDS.map((k) => item(k, CompletionItemKind.Keyword))
  }
  // 6. Top level.
  return TOP_KEYWORDS.map((k) => item(k, CompletionItemKind.Keyword))
}

function tokenRefItems(spans: ReturnType<typeof parse>['spans']): CompletionItem[] {
  return spans
    .filter((s) => s.kind === 'token')
    .map((s) => item(s.name.replace(/\//g, '.'), CompletionItemKind.Value, `token ${s.name}`))
}

function item(label: string, kind: CompletionItemKind, detail?: string): CompletionItem {
  return detail ? { label, kind, detail } : { label, kind }
}
