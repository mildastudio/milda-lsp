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
  '  props { size : number = 3 }', // line 3
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
    // `Button` after `component` is the name this file declares, so it IS coloured…
    expect(at(1, 10)).toMatchObject({ type: 'class' })
    // …while `Button` after `archetype` names something the prelude declares, and a lexical
    // classifier has nothing to say about it.
    expect(at(2, 12)).toBeUndefined()
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

  // A literal's payload is one thing, so it gets one colour. Digits or not is an accident
  // of the notation: `hex(fff)` used to come out plain while `hex(000)` came out a number.
  it('paints every word inside a value literal as its value', () => {
    const payload = (src: string) =>
      decode(computeSemanticTokens(src).data)
        .filter((t) => t.char > src.indexOf('('))
        .map((t) => t.type)
    expect(payload('token a : color = hex(fff)')).toEqual(['number'])
    expect(payload('token a : color = hex(000)')).toEqual(['number'])
    expect(payload('token a : color = hex(ABCDEF)')).toEqual(['number'])
    // Five words: the three channels, the alpha separator (a word character in this
    // grammar) and the alpha itself - all of them the one value.
    expect(payload('token a : color = oklch(62% 0.19 256deg / 50%)')).toEqual([
      'number',
      'number',
      'number',
      'number',
      'number',
    ])
    expect(payload('token a : spacing = scaled(1.25)')).toEqual(['number'])
  })

  it('closes the literal at the `)` and at end-of-line', () => {
    const after = (src: string, from: number) =>
      decode(computeSemanticTokens(src).data).filter((t) => t.char >= from)
    // `pill` after a closed literal is a keyword again, not a channel.
    expect(after('token a : radius = hex(fff) pill', 28)[0]?.type).toBe('keyword')
    // An unclosed literal must not paint the next line (mid-edit is the common case).
    const next = decode(computeSemanticTokens('token a : color = hex(\ncomponent X {').data)
    expect(next.find((t) => t.line === 1)?.type).toBe('keyword')
  })

  // A reader should see at a glance which names are the language's and which are their own.
  it('highlights a name this file declares', () => {
    const typeOf = (src: string, char: number) =>
      decode(computeSemanticTokens(src).data).find((t) => t.char === char)?.type
    expect(typeOf('  token brand : color = hex(fff)', 8)).toBe('class')
    expect(typeOf('component Badge "a label" {', 10)).toBe('class')
    expect(typeOf('context-group ColorScheme {', 14)).toBe('class')
    expect(typeOf('type Density = enum { compact }', 5)).toBe('class')
    // A part's name IS a dotted path, and here it is a declaration rather than a reference.
    expect(typeOf('  part root.label {', 7)).toBe('class')
    // A reference to the same thing stays a reference.
    expect(typeOf('    ink color.text', 8)).toBe('property')
    // And a word the language owns keeps its own colour, wherever it sits.
    expect(typeOf('  token raw : color = hex(fff)', 8)).toBe('keyword')
  })

  // Token types are not a closed word list (`border`, `opacity` and `shadow` are token
  // types AND facet heads), so the `:` is what identifies one.
  it('highlights the declared type after a `:`', () => {
    const typeOf = (src: string, char: number) =>
      decode(computeSemanticTokens(src).data).find((t) => t.char === char)?.type
    expect(typeOf('  token brand : color = hex(fff)', 16)).toBe('type') // color
    // …and the name beside it is a different category (see the declaration test above).
    expect(typeOf('  token brand : color = hex(fff)', 8)).toBe('class')
    expect(typeOf('  token r : radius = 2px', 12)).toBe('type')
    expect(typeOf('  size : Size = S2', 9)).toBe('type') // a prop's own context group
    // A keyword after a `:` still reads as itself.
    expect(typeOf('  x : true', 6)).toBe('keyword')
  })
})
