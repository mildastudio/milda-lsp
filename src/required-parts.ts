// ─── Milda LSP - the parts an archetype requires ──────────────────────────────
// A file no longer says which parts are locked (proposal 0055): the archetype requires them, the
// reader restores one a file leaves out, and the editor will not let it go. What is left for
// editor tooling is to make the requirement VISIBLE where the author writes. `validate` reports
// the gap (`part.required`, through ./semantic); this module offers to close it, as a quick fix
// on the component and as completions at the head of a statement inside it. Both read
// `missingRequiredParts`, the same answer the reader seeds from, so the fix adds exactly what the
// reader would otherwise have added on its own.

import { missingRequiredParts, type MissingPart, type NodeSpan } from '@mildastudio/milda'
import {
  CodeActionKind,
  CompletionItemKind,
  InsertTextFormat,
  type CodeAction,
  type CompletionItem,
  type Diagnostic,
  type Position,
  type Range,
  type TextEdit,
} from 'vscode-languageserver-types'
import { parse } from './analysis'
import { toLspRange } from './range'

/** The diagnostic code `validate` gives a required part the file leaves out. */
export const PART_REQUIRED_CODE = 'part.required'

/** Quick fixes for the components `range` touches: add the parts their archetype requires. */
export function computeCodeActions(
  text: string,
  range: Range,
  diagnostics: readonly Diagnostic[] = [],
): CodeAction[] {
  const { document, spans } = parse(text)
  const out: CodeAction[] = []
  for (const span of spans) {
    if (span.kind !== 'component' || !overlaps(toLspRange(span.fullRange), range)) continue
    const component = document.components.find((c) => c.id === span.id)
    if (!component) continue
    const missing = missingRequiredParts(component.archetype, component.anatomy)
    if (!missing.length) continue
    const top = missing.filter((m) => !m.implied)
    const fixes = diagnostics.filter(
      (d) => d.code === PART_REQUIRED_CODE && overlaps(d.range, toLspRange(span.nameRange)),
    )
    out.push({
      title:
        top.length === 1
          ? `Add the required part "${top[0].path}"`
          : `Add the ${top.length} parts a ${component.archetype} requires`,
      kind: CodeActionKind.QuickFix,
      isPreferred: true,
      ...(fixes.length ? { diagnostics: fixes } : {}),
      edit: { changes: { [URI_PLACEHOLDER]: [insertParts(text, span, missing)] } },
    })
  }
  return out
}

// The document a code action edits is the one it was asked about, and only the caller knows its
// URI. Pure functions here stay transport-free, so the edit is keyed by this and re-keyed by the
// caller (`withUri`).
const URI_PLACEHOLDER = 'milda:current'

/** Re-key a code action's edit to the document it was computed for. */
export function withUri(action: CodeAction, uri: string): CodeAction {
  const edits = action.edit?.changes?.[URI_PLACEHOLDER]
  return edits ? { ...action, edit: { changes: { [uri]: edits } } } : action
}

/** At the head of a statement inside a component: each required part it does not have yet. */
export function requiredPartCompletions(
  text: string,
  position: Position,
  snippets: boolean,
): CompletionItem[] {
  const { document, spans } = parse(text)
  const span = enclosingComponent(spans, position)
  const component = span ? document.components.find((c) => c.id === span.id) : undefined
  if (!component) return []
  const missing = missingRequiredParts(component.archetype, component.anatomy)
  return missing
    .filter((m) => !m.implied)
    .map((m, i) => {
      // A part brings the required parts under it: a MenuButton's `surface` is not much use
      // without its `item`, and the reader would add that item anyway.
      const below = missing.filter((n) => n.implied && n.path.startsWith(`${m.path}.`))
      const head = `part ${m.path}: ${m.kind} {`
      const rest = below.map((n) => `\npart ${n.path}: ${n.kind} {}`).join('')
      return {
        label: `part ${m.path}: ${m.kind}`,
        kind: CompletionItemKind.Module,
        detail: `required by ${component.archetype}`,
        // Ahead of the keywords: a part the component is missing is the likeliest next line.
        sortText: `!${String(i).padStart(3, '0')}`,
        preselect: i === 0,
        ...(snippets
          ? { insertTextFormat: InsertTextFormat.Snippet, insertText: `${head}\n\t$0\n}${rest}` }
          : { insertText: `${head}}${rest}` }),
      }
    })
}

// The missing parts as `part` lines, written before the component's closing brace in the
// indentation its own parts use.
function insertParts(text: string, span: NodeSpan, missing: readonly MissingPart[]): TextEdit {
  const lines = text.split('\n')
  const full = toLspRange(span.fullRange)
  const indent = partIndent(lines, full) ?? '  '
  const body = missing.map((m) => `${indent}part ${m.path}: ${m.kind} {}`)
  const closeLine = lines[full.end.line] ?? ''
  const brace = closeLine.lastIndexOf('}', Math.max(0, full.end.character - 1))
  if (brace >= 0 && closeLine.slice(0, brace).trim() === '') {
    const at = { line: full.end.line, character: 0 }
    return { range: { start: at, end: at }, newText: `${body.join('\n')}\n` }
  }
  // `component B { part root {} }` - the brace shares a line, so the parts open one of their own.
  const at = { line: full.end.line, character: Math.max(0, brace) }
  return { range: { start: at, end: at }, newText: `\n${body.join('\n')}\n` }
}

function partIndent(lines: readonly string[], range: Range): string | undefined {
  for (let l = range.start.line; l <= range.end.line; l++) {
    const m = /^(\s+)part\s/.exec(lines[l] ?? '')
    if (m) return m[1]
  }
  return undefined
}

function enclosingComponent(spans: readonly NodeSpan[], position: Position): NodeSpan | null {
  const at = { start: position, end: position }
  return spans.find((s) => s.kind === 'component' && overlaps(toLspRange(s.fullRange), at)) ?? null
}

function overlaps(a: Range, b: Range): boolean {
  const before = (p: Position, q: Position) =>
    p.line < q.line || (p.line === q.line && p.character < q.character)
  return !before(a.end, b.start) && !before(b.end, a.start)
}
