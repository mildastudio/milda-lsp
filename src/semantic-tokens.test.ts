import { describe, expect, it } from 'vitest'
import { computeSemanticTokens, SEMANTIC_TOKEN_TYPES } from './semantic-tokens'

interface DecodedToken {
  line: number
  char: number
  length: number
  type: string
}

// Reverse the LSP delta encoding back into absolute tokens for assertions.
function decode(data: number[]): DecodedToken[] {
  const out: DecodedToken[] = []
  let line = 0
  let char = 0
  for (let k = 0; k < data.length; k += 5) {
    const [dLine, dChar, length, typeIdx] = data.slice(k, k + 5)
    line += dLine
    char = dLine === 0 ? char + dChar : dChar
    out.push({ line, char, length, type: SEMANTIC_TOKEN_TYPES[typeIdx] })
  }
  return out
}

const SRC = [
  '# a comment', //                 line 0
  'component Button "hi" {', //      line 1
  '  archetype Button', //          line 2
  '  props { size number = 3 }', // line 3
  '}', //                           line 4
].join('\n')

describe('computeSemanticTokens', () => {
  const toks = decode(computeSemanticTokens(SRC).data)
  const at = (line: number, char: number) => toks.find((t) => t.line === line && t.char === char)

  it('classifies a line comment', () => {
    expect(at(0, 0)).toMatchObject({ type: 'comment', length: 11 })
  })

  it('classifies structural keywords', () => {
    expect(at(1, 0)).toMatchObject({ type: 'keyword', length: 9 }) // component
    expect(at(2, 2)).toMatchObject({ type: 'keyword' }) // archetype
    expect(at(3, 2)).toMatchObject({ type: 'keyword' }) // props
  })

  it('classifies strings, type words, numbers and operators', () => {
    expect(toks.find((t) => t.line === 1 && t.type === 'string')).toBeDefined() // "hi"
    expect(toks.find((t) => t.line === 3 && t.type === 'type')).toBeDefined() // number (the type word)
    expect(toks.find((t) => t.line === 3 && t.type === 'number')).toBeDefined() // 3
    expect(toks.find((t) => t.line === 3 && t.type === 'operator')).toBeDefined() // =
  })

  it('leaves plain identifiers uncoloured', () => {
    // `Button` (an identifier here) produces no token.
    expect(toks.find((t) => t.line === 1 && t.char === 10)).toBeUndefined()
  })

  it('emits a well-formed 5-ints-per-token stream', () => {
    expect(computeSemanticTokens(SRC).data.length % 5).toBe(0)
    expect(computeSemanticTokens('').data).toEqual([])
  })

  it('highlights color-function names (oklch/hex/…) as a type', () => {
    //                                       oklch starts at char 18 ─┐
    const toks = decode(computeSemanticTokens('token c : color = oklch(0.6 0.1 250)').data)
    expect(toks.find((t) => t.line === 0 && t.char === 18)?.type).toBe('type')
  })
})
