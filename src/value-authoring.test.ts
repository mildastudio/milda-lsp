import {
  COLOR_LITERAL_ALIASES,
  COLOR_LITERAL_FNS,
  COLOR_LITERAL_SPELLINGS,
  LENGTH_LITERAL_FNS,
  parseMildaDocument,
  TOKEN_TYPE_NAMES,
  VALUE_LITERAL_FNS,
} from '@mildastudio/milda'
import { describe, expect, it } from 'vitest'
import { computeCompletions, type CompletionCapabilities } from './completion'
import { computeSignatureHelp } from './signature-help'
import { COLOR_FNS, LENGTH_FNS } from './vocab'

// ─── Writing a value, step by step ────────────────────────────────────────────
// Reported from watching someone type a foundations block: they knew `token` and they knew
// they wanted a colour, and the editor helped with neither the shape of the declaration nor
// the channels of the literal. Knowing that `oklch` exists is not the same as knowing what
// its three numbers are, and a completion list cannot answer the second question - there is
// no word to complete once the cursor is inside the parentheses.
//
// So: a declaration arrives whole (name → type → value, as tab stops), a literal arrives
// pre-filled and in range, and while the channels are being typed the argument hint says
// which one is which. Every word of it comes from the language's own literal table, so the
// help can only describe the function the reader accepts.

const SNIPPETS: CompletionCapabilities = { snippets: true }

const at = (src: string, caps: CompletionCapabilities = SNIPPETS) => {
  const index = src.indexOf('▐')
  if (index < 0) throw new Error('the source needs a ▐ caret marker')
  const before = src.slice(0, index)
  const line = before.split('\n').length - 1
  const character = before.length - (before.lastIndexOf('\n') + 1)
  return computeCompletions(src.replace('▐', ''), { line, character }, caps)
}
const labels = (src: string, caps?: CompletionCapabilities) => at(src, caps).map((i) => i.label)
const insert = (src: string, label: string, caps?: CompletionCapabilities) =>
  at(src, caps).find((i) => i.label === label)?.insertText

describe('a token declaration', () => {
  it('arrives whole, with the type list waiting at its own stop', () => {
    const text = insert('foundations {\n  ▐', 'token')
    expect(text).toContain('token ${1:name} : ')
    // A CHOICE placeholder: the client opens the list of token types at stop 2 by itself,
    // so the author types a name and is then asked the one question that follows.
    for (const type of TOKEN_TYPE_NAMES) expect(text).toContain(type)
    expect(text).toMatch(/\|\} =\$0$/) // no space: the author's next keystroke opens the value list
  })

  it('offers the types after the name as well, and brings the `:` with them', () => {
    // Written by hand, this is the step where the separator goes missing.
    expect(insert('foundations {\n  token brand ▐', 'color')).toBe(': color')
    expect(labels('foundations {\n  token brand ▐')).toEqual([...TOKEN_TYPE_NAMES])
    expect(labels('foundations {\n  token brand : ▐')).toEqual([...TOKEN_TYPE_NAMES])
  })

  it('leaves a snippet-less client plain text it can use', () => {
    expect(insert('foundations {\n  ▐', 'token', {})).toBeUndefined() // the label, as-is
    expect(insert('foundations {\n  token b : color = ▐', 'oklch', {})).toBe('oklch(')
  })
})

describe('the value after `=`', () => {
  it('offers the colour literals on a colour token, pre-filled and in range', () => {
    const offered = labels('foundations {\n  token brand : color = ▐')
    // Every colour space, in the table's order, each followed by its translucent form where it
    // has one (see the alpha tests below).
    expect(offered.filter((l) => !l.includes('/'))).toEqual([
      ...COLOR_LITERAL_FNS,
      'raw',
      'alias',
      'escape',
      'compute',
    ])
    expect(insert('foundations {\n  token brand : color = ▐', 'oklch')).toBe(
      'oklch(${1:0.62} ${2:0.19} ${3:256})$0',
    )
    expect(insert('foundations {\n  token brand : color = ▐', 'hex')).toBe('hex(${1:ffffff})$0')
    // …and still the three value kinds, after them.
    expect(offered).toContain('alias')
    expect(offered).toContain('raw')
    expect(offered).toContain('escape')
  })

  it('offers the length literals on a length token, and `pill` only on a radius', () => {
    expect(labels('foundations {\n  token pad : spacing = ▐')).toContain('scaled')
    expect(labels('foundations {\n  token pad : spacing = ▐')).not.toContain('pill')
    expect(labels('foundations {\n  token r : radius = ▐')).toContain('pill')
    // A colour literal has no business on a spacing token, and the parser would reject it.
    expect(labels('foundations {\n  token pad : spacing = ▐')).not.toContain('oklch')
  })

  it('offers the colour literals on every colour-valued type, not just `color`', () => {
    // `ring` and `backdrop` are colours too - the reader says so, so the editor must.
    expect(labels('foundations {\n  token focus : ring = ▐')).toContain('oklch')
    expect(labels('foundations {\n  token veil : backdrop = ▐')).toContain('hex')
  })

  it('scaffolds an alias over the groups this document declares', () => {
    const text = insert(
      'context-group Mode { Light Dark }\nfoundations {\n  token b : color = ▐',
      'alias',
    )
    expect(text).toBe('alias by ${1|Mode|} {\n\t$0\n}')
    // With no group to choose from, a plain placeholder rather than an empty list.
    expect(insert('foundations {\n  token b : color = ▐', 'alias')).toBe(
      'alias by ${1:Group} {\n\t$0\n}',
    )
  })

  it('offers the alias block the contexts of ITS OWN group', () => {
    const offered = labels(
      'context-group Mode { Light Dark }\ncontext-group Size { S1 S2 }\n' +
        'foundations {\n  token b : color = alias by Mode {\n    ▐',
    )
    expect(offered).toEqual(['Light', 'Dark', 'default'])
  })
})

describe('the argument hint inside a literal', () => {
  const help = (src: string) => {
    const index = src.indexOf('▐')
    return computeSignatureHelp(src.replace('▐', ''), { line: 0, character: index })
  }
  const active = (src: string) => {
    const h = help(src)
    const i = h?.activeParameter ?? -1
    return h?.signatures[0].parameters?.[i]?.label
  }

  it('names the function and follows the argument being typed', () => {
    expect(help('token a : color = oklch(▐')?.signatures[0].label).toBe('oklch(L C H / A)')
    expect(active('token a : color = oklch(▐')).toBe('L')
    expect(active('token a : color = oklch(0.62 ▐')).toBe('C')
    expect(active('token a : color = oklch(0.62 0.19 ▐')).toBe('H')
    // The alpha is written after a slash, glued or spaced - the parser reads both.
    expect(active('token a : color = oklch(0.62 0.19 256 / ▐')).toBe('A')
    expect(active('token a : color = oklch(0.62 0.19 256/▐')).toBe('A')
    // Past the last argument the hint stays on it rather than pointing at nothing.
    expect(active('token a : color = oklch(1 2 3 4 5 6 ▐')).toBe('A')
  })

  it('describes hex and the length literal too', () => {
    expect(help('token a : color = hex(▐')?.signatures[0].label).toBe('hex(digits)')
    expect(help('token a : color = hex(▐')?.signatures[0].parameters?.[0].documentation).toContain(
      '3, 4, 6 or 8',
    )
    expect(help('token a : spacing = scaled(▐')?.signatures[0].label).toBe('scaled(n)')
    // No alpha channel on a length, and none on hex (the digits carry it).
    expect(help('token a : spacing = scaled(▐')?.signatures[0].parameters).toHaveLength(1)
  })

  it('says nothing where there is no open call', () => {
    expect(help('token a : color = hex(fff)▐')).toBeNull() // the call is closed
    expect(help('token a : color = ▐')).toBeNull()
    expect(help('# a comment about oklch(▐')).toBeNull()
    expect(help('token a : color = nonsense(▐')).toBeNull() // not a literal function
  })
})

describe('the literal table', () => {
  it('is the same set of functions the highlighter colours', () => {
    // Three consumers read these names: the parser, the highlighter and this help. The
    // parser's list IS the table; this pins the highlighter's copy to it. The highlighter also
    // colours the ALIAS spellings, because a `rgba(…)` payload is a value like any other.
    expect([...COLOR_FNS].sort()).toEqual([...COLOR_LITERAL_SPELLINGS].sort())
    expect([...LENGTH_FNS].sort()).toEqual([...LENGTH_LITERAL_FNS].sort())
    expect(Object.keys(VALUE_LITERAL_FNS).sort()).toEqual(
      [...COLOR_LITERAL_FNS, ...LENGTH_LITERAL_FNS].sort(),
    )
  })

  it('gives every channel a sample the parser reads back without a word', () => {
    // A pre-filled call the reader then complains about would be worse than an empty one,
    // so the samples are run through the real parser rather than eyeballed.
    for (const [fn, spec] of Object.entries(VALUE_LITERAL_FNS)) {
      // A text-relative length on a font-size is what `scaled` is for; on a spacing token
      // the parser rightly asks whether the padding really should grow with the text.
      const type = LENGTH_LITERAL_FNS.includes(fn) ? 'font-size' : 'color'
      const call = `${fn}(${spec.channels.map((c) => c.sample).join(' ')})`
      const { issues, document } = parseMildaDocument(
        `foundations {\n  token t : ${type} = ${call}\n}\n`,
      )
      expect(issues, `${call} should parse cleanly`).toEqual([])
      expect(document.foundations.layers[0]?.tokens[0]?.value, call).toMatchObject({ kind: 'raw' })
    }
  })
})

// ─── An alias line, from the context to the value ─────────────────────────────
// `Light -> black` is three decisions, and the editor used to help with none of them: the
// context (which the group knows), the arrow (which is not a decision at all) and a value of
// the right KIND - a colour token cannot hold a radius, and the reader says so, so offering one
// would be offering an error.
describe('an alias line', () => {
  const DOC =
    'context-group Mode { Light Dark }\n' +
    'foundations {\n' +
    '  token color/black : color = hex(000)\n' +
    '  token color/white : color = hex(fff)\n' +
    '  token space/2 : spacing = 8px\n' +
    '  token ring/focus : ring = hex(00f)\n' +
    '  token text : color = alias by Mode {\n'

  it('offers each context of its own group, with the arrow', () => {
    const items = at(`${DOC}    ▐`)
    expect(items.map((i) => i.label)).toEqual(['Light', 'Dark', 'default'])
    expect(items.map((i) => i.insertText)).toEqual(['Light -> ', 'Dark -> ', 'default -> '])
  })

  it('offers the values that would fit the token, and not the ones that would not', () => {
    const offered = labels(`${DOC}    Light -> ▐`)
    // Colour tokens, including the `ring` (a ring IS a colour, which is why the reader accepts
    // it in a colour slot)…
    expect(offered).toContain('color.black')
    expect(offered).toContain('color.white')
    expect(offered).toContain('ring.focus')
    // …and not the spacing token, which would be an `alias-type-mismatch` error.
    expect(offered).not.toContain('space.2')
    // A literal can stand in a slot too, pre-filled like anywhere else.
    expect(offered).toContain('hex')
    expect(insert(`${DOC}    Light -> ▐`, 'hex')).toBe('hex(${1:ffffff})$0')
  })

  it('offers length tokens in a length token’s alias', () => {
    const src =
      'context-group Mode { Light Dark }\nfoundations {\n' +
      '  token color/black : color = hex(000)\n  token space/2 : spacing = 8px\n' +
      '  token pad : spacing = alias by Mode {\n    Light -> ▐'
    const offered = labels(src)
    expect(offered).toContain('space.2')
    expect(offered).not.toContain('color.black')
    expect(offered).toContain('scaled')
  })
})

// ─── Alpha ────────────────────────────────────────────────────────────────────
// A translucent colour is written `… / A` (or with 4 or 8 hex digits), and nothing in a list of
// function names says so. Now every space that takes an alpha is offered twice.
describe('a translucent colour', () => {
  it('is offered as a second form of every space that takes one', () => {
    const offered = labels('foundations {\n  token veil : color = ▐')
    for (const fn of COLOR_LITERAL_FNS) {
      if (VALUE_LITERAL_FNS[fn]?.alpha === true) expect(offered).toContain(`${fn} / A`)
    }
    expect(insert('foundations {\n  token veil : color = ▐', 'oklch / A')).toBe(
      'oklch(${1:0.62} ${2:0.19} ${3:256} / ${4:50%})$0',
    )
    // hex carries its alpha in the digits, so it has no second form.
    expect(offered).not.toContain('hex / A')
  })

  it('is read in every spelling the reader promises', () => {
    const alpha = (literal: string) => {
      const { document, issues } = parseMildaDocument(
        `foundations {\n  token t : color = ${literal}\n}\n`,
      )
      expect(issues, literal).toEqual([])
      return (document.foundations.layers[0].tokens[0].value as { value: { alpha?: number } }).value
        .alpha
    }
    // The slash form, the bare fourth channel, a percentage, and the hex shorthands.
    expect(alpha('srgb(1 1 1 / 0.5)')).toBe(0.5)
    expect(alpha('srgb(1 1 1 0.5)')).toBe(0.5)
    expect(alpha('oklch(0.62 0.19 256 / 50%)')).toBe(0.5)
    expect(alpha('hex(ffffff80)')).toBeCloseTo(0.502, 3)
    expect(alpha('hex(fff8)')).toBeCloseTo(0.533, 3)
    // And the CSS spellings someone brings with them: `rgba`/`hsla`, commas and all.
    expect(alpha('rgba(59 130 246 0.5)')).toBe(0.5)
    expect(alpha('rgba(59, 130, 246, 0.5)')).toBe(0.5)
    expect(alpha('hsla(210 50% 40% / 0.5)')).toBe(0.5)
    expect(alpha('rgb(59, 130, 246)')).toBeUndefined() // opaque, and still read
  })

  it('maps an alias spelling onto the function it means', () => {
    const space = (literal: string) => {
      const { document } = parseMildaDocument(`foundations {\n  token t : color = ${literal}\n}\n`)
      return (document.foundations.layers[0].tokens[0].value as { value: { space: string } }).value
        .space
    }
    for (const [alias, canonical] of Object.entries(COLOR_LITERAL_ALIASES)) {
      expect(COLOR_LITERAL_SPELLINGS).toContain(alias)
      expect(COLOR_LITERAL_FNS).toContain(canonical)
    }
    expect(space('rgba(255 0 0 0.5)')).toBe('srgb') // rgb() IS sRGB
    expect(space('hsla(210 50% 40%)')).toBe('hsl')
  })

  it('says what happened when a `#` ate the digits', () => {
    // `#` opens a comment here, so `hex(#ffffff)` loses its payload AND the rest of the line.
    const { issues } = parseMildaDocument('foundations {\n  token t : color = hex(#ffffff)\n}\n')
    const hex = issues.find((i) => i.code === 'color-hex')
    expect(hex?.message).toContain('starts a comment')
  })
})
