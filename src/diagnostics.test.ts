import { describe, expect, it } from 'vitest'
import { DiagnosticSeverity } from 'vscode-languageserver'
import { computeDiagnostics, DIAGNOSTIC_SOURCE } from './diagnostics'

const errors = (text: string) =>
  computeDiagnostics(text).filter((d) => d.severity === DiagnosticSeverity.Error)

const codes = (text: string) => computeDiagnostics(text).map((d) => d.code)

describe('computeDiagnostics', () => {
  it('returns nothing for an empty document', () => {
    expect(computeDiagnostics('')).toEqual([])
  })

  it('suppresses ubiquitous lowering notes (inline-literal, ref-sugar)', () => {
    // An inline color literal in an alias slot is hoisted (inline-literal) — not shown.
    expect(codes('foundations {\n  token c : color = alias by G { X -> hex(fff) }\n}')).not.toContain(
      'inline-literal',
    )
    // An unconditional ref lowers to a default-only alias (ref-sugar) — not shown.
    expect(codes('foundations {\n  token a : color = hex(fff)\n  token b : color = a\n}')).not.toContain(
      'ref-sugar',
    )
  })

  it('returns nothing for a comment-only document', () => {
    expect(computeDiagnostics('# just a comment\n')).toEqual([])
  })

  it('parses a well-formed context-group without errors', () => {
    expect(errors('context-group Size { S1 S2 S3 }\n')).toEqual([])
  })

  it('flags an unterminated string as a ranged error with correct 0-based mapping', () => {
    //           1-based col 18 ─────────────────┐ (the opening quote)
    const errs = errors('component Button "unterminated\n')
    const lex = errs.find((d) => d.code === 'lex')
    expect(lex).toBeDefined()
    expect(lex!.source).toBe(DIAGNOSTIC_SOURCE)
    // Parser reports (line 1, col 18) → LSP (line 0, char 17), widened over the
    // string to end-of-line since it never closes.
    expect(lex!.range.start).toEqual({ line: 0, character: 17 })
    expect(lex!.range.end.character).toBeGreaterThan(17)
  })

  it('surfaces a bare `fixed` axis as a Hint, not a Warning', () => {
    const diags = computeDiagnostics('component T "t" {\n  part root { layout { size fixed fixed } }\n}')
    const af = diags.find((d) => d.code === 'axis-fixed')
    expect(af).toBeDefined()
    expect(af!.severity).toBe(DiagnosticSeverity.Hint)
  })
})
