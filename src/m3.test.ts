import { describe, expect, it } from 'vitest'
import { CompletionItemKind, MarkupKind } from 'vscode-languageserver-types'
import { computeCompletions } from './completion'
import { computeHover } from './hover'
import { computeDefinition } from './definition'

// Component named MyButton (≠ the `Button` archetype) so a hover on `Button` resolves
// to the archetype, not a same-named component.
const SRC = [
  'foundations {', //                    line 0
  '  token space/2 : dimension = 8px', // line 1
  '}', //                                line 2
  '', //                                 line 3
  'component MyButton "A button" {', //   line 4
  '  archetype Button', //               line 5
  '  part root {', //                     line 6
  '    layout { stack row }', //          line 7
  '    fill space.2', //                  line 8
  '  }', //                               line 9
  '}', //                                line 10
  '',
].join('\n')

const labels = (items: { label: string }[]) => items.map((i) => i.label)

describe('computeCompletions', () => {
  it('suggests archetype names after `archetype`', () => {
    const items = computeCompletions(SRC, { line: 5, character: 12 })
    expect(labels(items)).toEqual(expect.arrayContaining(['Button', 'Link', 'Form']))
    expect(items[0].kind).toBe(CompletionItemKind.Class)
  })

  it('suggests declared token refs after a facet name', () => {
    const items = computeCompletions(SRC, { line: 8, character: 9 })
    // Tokens are offered in dotted ref form.
    expect(labels(items)).toContain('space.2')
    expect(items.every((i) => i.kind === CompletionItemKind.Value)).toBe(true)
  })

  it('suggests facet names + part keywords inside a part', () => {
    const items = computeCompletions(SRC, { line: 7, character: 4 })
    expect(labels(items)).toEqual(expect.arrayContaining(['fill', 'ink', 'layout', 'state']))
  })

  it('suggests top-level keywords at the document root', () => {
    const items = computeCompletions(SRC, { line: 3, character: 0 })
    expect(labels(items)).toEqual(
      expect.arrayContaining(['component', 'foundations', 'context-group']),
    )
  })
})

describe('computeHover', () => {
  it('describes a token reference', () => {
    const h = computeHover(SRC, { line: 8, character: 11 }) // on `space.2`
    expect(h).not.toBeNull()
    const value = (h!.contents as { kind: string; value: string }).value
    expect(value).toContain('token')
    expect(value).toContain('space/2')
    expect(value).toContain('type:') // shows the token's resolved type + value kind
  })

  it('describes a facet from the prelude', () => {
    const h = computeHover(SRC, { line: 8, character: 5 }) // on `fill`
    expect((h!.contents as { value: string }).value).toContain('facet')
  })

  it('describes an archetype from the prelude', () => {
    const h = computeHover(SRC, { line: 5, character: 14 }) // on `Button`
    const value = (h!.contents as { value: string }).value
    expect(value).toContain('archetype')
    expect(value).toContain('Button')
  })

  it('describes a component when the cursor is on its name', () => {
    const h = computeHover(SRC, { line: 4, character: 12 }) // on `MyButton`
    const value = (h!.contents as { value: string }).value
    expect(value).toContain('component')
    expect(value).toContain('MyButton')
  })

  it('returns null over whitespace', () => {
    expect(computeHover(SRC, { line: 3, character: 0 })).toBeNull()
  })
})

describe('computeDefinition', () => {
  const uri = 'file:///s.milda'

  it('jumps from a token ref to its declaration name', () => {
    const loc = computeDefinition(SRC, uri, { line: 8, character: 11 }) // on `space.2`
    expect(loc).not.toBeNull()
    expect(loc!.uri).toBe(uri)
    expect(loc!.range.start.line).toBe(1) // the `token space/2` declaration
  })

  it('returns null for an unresolved word', () => {
    expect(computeDefinition(SRC, uri, { line: 7, character: 6 })).toBeNull() // `layout` keyword
  })
})
