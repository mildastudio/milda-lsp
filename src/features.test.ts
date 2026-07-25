import { describe, expect, it } from 'vitest'
import { DiagnosticSeverity, SymbolKind } from 'vscode-languageserver'
import { computeDocumentSymbols } from './symbols'
import { computeFoldingRanges } from './folding'
import { computeSemanticDiagnostics, SEMANTIC_SOURCE } from './semantic'

// A small but structurally complete document: a context group, a foundations token,
// and a component with props / events / a part. The archetype is deliberately unknown
// so the semantic pass has something to flag.
const SRC = [
  'context-group Size {', // line 0
  '  S1', // line 1
  '  S2', // line 2
  '}', // line 3
  '', // line 4
  'foundations {', // line 5
  '  token space/2 : dimension = 8px', // line 6
  '}', // line 7
  '', // line 8
  'component Button "A button" {', // line 9
  '  archetype Nonexistent', // line 10
  '  props {', // line 11
  '    size Size = S1', // line 12
  '    loading boolean = false', // line 13
  '  }', // line 14
  '  events { click }', // line 15
  '  part root {', // line 16
  '    layout { stack row }', // line 17
  '  }', // line 18
  '}', // line 19
  '',
].join('\n')

const byName = <T extends { name: string }>(syms: T[], name: string): T | undefined =>
  syms.find((s) => s.name === name)

describe('computeDocumentSymbols', () => {
  const roots = computeDocumentSymbols(SRC)

  it('lists top-level declarations as roots', () => {
    expect(byName(roots, 'Button')?.kind).toBe(SymbolKind.Class)
    expect(byName(roots, 'Size')?.kind).toBe(SymbolKind.Enum)
    expect(byName(roots, 'space/2')?.kind).toBe(SymbolKind.Constant)
  })

  it('nests parts, props and events under their component', () => {
    const button = byName(roots, 'Button')!
    const kids = (button.children ?? []).map((c) => c.name)
    expect(kids).toEqual(expect.arrayContaining(['size', 'loading', 'click', 'root']))
    const size = button.children!.find((c) => c.name === 'size')!
    expect(size.kind).toBe(SymbolKind.Property)
    expect(button.children!.find((c) => c.name === 'click')!.kind).toBe(SymbolKind.Event)
    expect(button.children!.find((c) => c.name === 'root')!.kind).toBe(SymbolKind.Field)
  })

  it('nests context members under their group', () => {
    const size = byName(roots, 'Size')!
    expect((size.children ?? []).map((c) => c.name)).toEqual(['S1', 'S2'])
  })

  it('keeps every selectionRange inside its range', () => {
    const walk = (s: (typeof roots)[number]): void => {
      const { start, end } = s.range
      const sel = s.selectionRange
      expect(sel.start.line).toBeGreaterThanOrEqual(start.line)
      expect(sel.end.line).toBeLessThanOrEqual(end.line)
      ;(s.children ?? []).forEach(walk)
    }
    roots.forEach(walk)
  })
})

describe('computeFoldingRanges', () => {
  it('folds multi-line blocks (component, context group) but not one-liners', () => {
    const ranges = computeFoldingRanges(SRC)
    // The component spans lines 9..19.
    expect(ranges).toEqual(
      expect.arrayContaining([expect.objectContaining({ startLine: 9, endLine: 19 })]),
    )
    // The context group spans lines 0..3.
    expect(ranges).toEqual(
      expect.arrayContaining([expect.objectContaining({ startLine: 0, endLine: 3 })]),
    )
    // Every emitted range is genuinely multi-line.
    for (const r of ranges) expect(r.endLine).toBeGreaterThan(r.startLine)
  })
})

describe('computeSemanticDiagnostics', () => {
  it('flags an unknown archetype on the component name', () => {
    const diags = computeSemanticDiagnostics(SRC)
    const unknown = diags.find((d) => d.code === 'component.unknownArchetype')
    expect(unknown).toBeDefined()
    expect(unknown!.severity).toBe(DiagnosticSeverity.Error)
    expect(unknown!.source).toBe(SEMANTIC_SOURCE)
    // Positioned on the component declaration (line 9), not piled on line 0.
    expect(unknown!.range.start.line).toBe(9)
  })

  it('returns nothing semantic for an empty document', () => {
    expect(computeSemanticDiagnostics('')).toEqual([])
  })
})
