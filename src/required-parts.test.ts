import { describe, expect, it } from 'vitest'
import { parseMildaDocument } from '@mildastudio/milda'
import { DiagnosticSeverity } from 'vscode-languageserver-types'
import { computeCompletions } from './completion'
import { computeSemanticDiagnostics } from './semantic'
import { computeCodeActions, PART_REQUIRED_CODE, withUri } from './required-parts'

// ─── The parts an archetype requires, in the editor (proposal 0055) ───────────
// A file does not say which parts are locked any more; the archetype requires them. The reader
// adds a required part a file leaves out, so the file still works - and editor tooling makes the
// gap visible: an error on the component, a quick fix that writes the parts in, and completions
// that offer them first.

const BUTTON =
  'component Save {\n  archetype Button\n\n  part Save: container {\n    fill accent\n  }\n}\n'

const required = (text: string) =>
  computeSemanticDiagnostics(text).filter((d) => d.code === PART_REQUIRED_CODE)

// Applies the quick fix's edit the way an editor would.
function applyFix(text: string): string {
  const [diag] = required(text)
  const [fix] = computeCodeActions(text, diag.range, [diag])
  const [edit] = Object.values(fix.edit?.changes ?? {})[0] ?? []
  const lines = text.split('\n')
  const offset = (p: { line: number; character: number }) =>
    lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character
  return text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end))
}

describe('a required part the file leaves out', () => {
  it('is an error on the component', () => {
    const [d] = required(BUTTON)
    expect(d.severity).toBe(DiagnosticSeverity.Error)
    expect(d.message).toBe('a Button requires the part "label" (text)')
    expect(BUTTON.split('\n')[d.range.start.line].slice(d.range.start.character)).toMatch(/^Save/)
  })

  it('is not reported once the file has it, at whatever depth it is written', () => {
    expect(required(BUTTON.replace('  }\n}', '  }\n  part label: text {}\n}'))).toEqual([])
    // The reader finds a part by NAME, so a file may nest it (the Radix DropdownMenu does).
    expect(
      required(
        BUTTON.replace('  }\n}', '  }\n  part inner: container {}\n  part inner.label: text {}\n}'),
      ),
    ).toEqual([])
  })

  it('reports only the topmost missing part', () => {
    const menu =
      'component M {\n  archetype MenuButton\n  part M: container {}\n  part trigger: control {}\n  part trigger.label: text {}\n}\n'
    expect(required(menu).map((d) => d.message)).toEqual([
      'a MenuButton requires the part "surface" (container)',
    ])
  })

  it('leaves optional parts and archetype-less components alone', () => {
    expect(
      required(BUTTON)
        .map((d) => d.message)
        .join(),
    ).not.toContain('icon')
    expect(required('component Card {\n  part Card: container {}\n}\n')).toEqual([])
  })
})

describe('the quick fix', () => {
  it('writes the part in, in the indentation the component uses, and the error goes', () => {
    const fixed = applyFix(BUTTON)
    expect(fixed).toBe(
      'component Save {\n  archetype Button\n\n  part Save: container {\n    fill accent\n  }\n  part label: text {}\n}\n',
    )
    expect(required(fixed)).toEqual([])
    expect(parseMildaDocument(fixed).issues).toEqual([])
  })

  it('brings the required parts under a missing one', () => {
    const menu =
      'component M {\n  archetype MenuButton\n  part M: container {}\n  part trigger: control {}\n  part trigger.label: text {}\n}\n'
    const fixed = applyFix(menu)
    expect(fixed).toContain(
      '  part surface: container {}\n  part surface.item: item {}\n  part surface.item.label: text {}\n}',
    )
    expect(required(fixed)).toEqual([])
  })

  it('opens a line of its own when the closing brace shares one', () => {
    const fixed = applyFix('component S { archetype Button\n  part S: container {} }\n')
    expect(required(fixed)).toEqual([])
    expect(parseMildaDocument(fixed).issues).toEqual([])
  })

  it('is keyed to the document it was asked about', () => {
    const [diag] = required(BUTTON)
    const [fix] = computeCodeActions(BUTTON, diag.range, [diag])
    expect(Object.keys(withUri(fix, 'file:///a.milda').edit?.changes ?? {})).toEqual([
      'file:///a.milda',
    ])
    expect(withUri(fix, 'file:///a.milda').diagnostics).toEqual([diag])
  })

  it('offers nothing where nothing is missing', () => {
    const whole = BUTTON.replace('  }\n}', '  }\n  part label: text {}\n}')
    expect(
      computeCodeActions(whole, {
        start: { line: 0, character: 0 },
        end: { line: 9, character: 0 },
      }),
    ).toEqual([])
  })
})

describe('completion inside a component', () => {
  it('offers the missing required parts first', () => {
    const text = BUTTON.replace('  }\n}', '  }\n  \n}')
    const line = text.split('\n').length - 3
    const items = computeCompletions(text, { line, character: 2 })
    expect(items[0]).toMatchObject({ label: 'part label: text', detail: 'required by Button' })
    expect(items[0].insertText).toBe('part label: text {}')
  })

  it('carries the parts under it, and a snippet body where the client takes one', () => {
    const menu =
      'component M {\n  archetype MenuButton\n  part M: container {}\n  part trigger: control {}\n  part trigger.label: text {}\n  \n}\n'
    const items = computeCompletions(menu, { line: 5, character: 2 }, { snippets: true })
    expect(items[0].label).toBe('part surface: container')
    expect(items[0].insertText).toBe(
      'part surface: container {\n\t$0\n}\npart surface.item: item {}\npart surface.item.label: text {}',
    )
  })
})
