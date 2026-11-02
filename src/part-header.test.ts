import { describe, expect, it } from 'vitest'
import { NODE_KINDS } from '@mildastudio/milda'
import { computeCompletions } from './completion'
import { computeHover } from './hover'
import { computeSemanticTokens, decodeSemanticTokens } from './semantic-tokens'

// ─── The part header in the editor (proposal 0055 §3.2) ───────────────────────
// `part Button: container {` says what a part IS where it is named. Every export is written that
// way, so the editor has to know it as well as it knows the `kind` statement: offer the kinds
// after the colon, colour the kind as what follows a colon everywhere else (a type), and say what
// a part is when the cursor is on its name.

const at = (src: string) => {
  const index = src.indexOf('▐')
  const before = src.slice(0, index)
  return {
    text: src.replace('▐', ''),
    position: {
      line: before.split('\n').length - 1,
      character: before.length - (before.lastIndexOf('\n') + 1),
    },
  }
}
const labels = (src: string) => {
  const { text, position } = at(src)
  return computeCompletions(text, position).map((i) => i.label)
}
const hoverText = (src: string) => {
  const { text, position } = at(src)
  const h = computeHover(text, position)
  return h ? (h.contents as { value: string }).value : null
}

describe('completing a part header', () => {
  it('offers the node kinds after the colon', () => {
    expect(labels('component B {\n  part root: ▐')).toEqual([...NODE_KINDS])
    expect(labels('example "x" for B {\n  part root: ▐')).toEqual([...NODE_KINDS])
  })

  it('offers the kinds with their colon right after the name', () => {
    const { text, position } = at('component B {\n  part root ▐')
    const items = computeCompletions(text, position)
    expect(items.map((i) => i.label)).toEqual([...NODE_KINDS])
    expect(items.find((i) => i.label === 'icon')?.insertText).toBe(': icon')
  })

  it('offers nothing after the kind: there is no header flag', () => {
    expect(labels('component B {\n  part root: container ▐')).toEqual([])
  })

  it('no longer offers locked inside a part', () => {
    expect(labels('component B {\n  part root {\n    ▐')).not.toContain('locked')
  })
})

describe('reading a part header', () => {
  const SRC = 'component B {\n  part root: container {\n    fill accent\n  }\n}\n'

  it('colours the kind as the type after a colon', () => {
    const toks = decodeSemanticTokens(computeSemanticTokens(SRC).data).filter((t) => t.line === 1)
    expect(toks.map((t) => [SRC.split('\n')[1].slice(t.char, t.char + t.length), t.type])).toEqual([
      ['part', 'keyword'],
      ['root', 'class'],
      [':', 'operator'],
      ['container', 'type'],
    ])
  })

  it('says what a part is on its name, whichever spelling said it', () => {
    expect(hoverText('component B {\n  part ro▐ot: container {}\n}\n')).toContain(
      'kind: `container`',
    )
    expect(hoverText('component B {\n  part ro▐ot {\n    kind text\n  }\n}\n')).toContain(
      'kind: `text`',
    )
  })

  it('says when the archetype requires the part, which is why the editor keeps it', () => {
    const src =
      'component B {\n  archetype Button\n  part B: container {}\n  part lab▐el: text {}\n  part icon: icon {}\n}\n'
    expect(hoverText(src)).toContain('required by `Button`')
    expect(
      hoverText(src.replace('lab▐el', 'label').replace('part icon', 'part ic▐on')),
    ).not.toContain('required')
  })

  it('describes the kind word in the header and in the statement', () => {
    expect(hoverText('component B {\n  part root: cont▐ainer {}\n}\n')).toMatch(/^\*\*kind\*\*/)
    expect(hoverText('component B {\n  part root {\n    kind cont▐ainer\n  }\n}\n')).toMatch(
      /^\*\*kind\*\*/,
    )
  })
})
