import { describe, expect, it } from 'vitest'
import { NODE_KINDS, PART_KEYWORDS } from '@mildastudio/milda'
import { computeCompletions } from './completion'

// ─── Completion for the v0.3 surface (proposal 0041) ──────────────────────────
// The format gained roughly thirty statements - a part's kind, its text, its accessible
// naming, its emissions, its transitions, the component it nests, its behaviours - plus four
// top-level blocks. Completion knew four part keywords: `layout`, `state`, `when`, `slot`.
//
// That is worse than it sounds. A surface nobody can discover is a surface nobody uses, and
// the vocabulary lists were about to become the same "two lists that must agree, in two files,
// with nothing checking" defect the format itself kept producing. So the part keywords come
// from the PARSER's own export, and every closed word set from the language's vocabulary
// module - and this file asserts that what the editor offers is what the reader accepts.

const labels = (src: string): string[] => {
  const index = src.indexOf('▐')
  if (index < 0) throw new Error('the source needs a ▐ caret marker')
  const text = src.replace('▐', '')
  const before = src.slice(0, index)
  const line = before.split('\n').length - 1
  const character = before.length - (before.lastIndexOf('\n') + 1)
  return computeCompletions(text, { line, character }).map((i) => i.label)
}

const PART = (body: string) => `component B {\n  part root {\n    ${body}`

describe('a part statement', () => {
  it('offers every statement the parser accepts, not a hand-kept subset', () => {
    const offered = labels(PART('▐'))
    // The exact assertion that matters: nothing the reader accepts is missing.
    for (const keyword of PART_KEYWORDS) {
      expect(offered, `\`${keyword}\` is accepted by the parser but not offered`).toContain(keyword)
    }
  })

  it('offers the node kinds after `kind`', () => {
    const offered = labels(PART('kind ▐'))
    expect(offered).toEqual([...NODE_KINDS])
  })

  it('offers provenance after `origin`, and the realizations after control/group', () => {
    expect(labels(PART('origin ▐'))).toEqual(['root', 'archetype', 'author'])
    expect(labels(PART('control ▐'))).toEqual(['checkbox', 'switch'])
    expect(labels(PART('group ▐'))).toEqual(['radio', 'segmented'])
  })

  it('offers the two bindings after `bind`, then the UI states', () => {
    expect(labels(PART('bind ▐'))).toEqual(['value', 'state'])
    expect(labels(PART('bind state ▐'))).toContain('disabled')
  })

  it('offers the behaviour kinds after `behavior`, then that behaviour’s own fields', () => {
    expect(labels(PART('behavior ▐'))).toContain('focus-trap')
    const fields = labels(PART('behavior focus-trap {\n      ▐'))
    expect(fields).toEqual(['initial-focus-node-id', 'return-focus-on-close', 'allow-escape-key'])
    // A node-valued field takes a part PATH - the file's own way of addressing a node.
    const paths = labels(
      'component B {\n  part root {}\n  part root.input {}\n  part root.x {\n    behavior focus-trap { initial-focus-node-id ▐',
    )
    expect(paths).toContain('root.input')
  })

  it('offers a config surface’s fields, then that field’s own vocabulary', () => {
    expect(labels(PART('calendar {\n      ▐'))).toEqual([
      'selection-mode',
      'week-starts-on',
      'disabled-weekdays',
    ])
    expect(labels(PART('calendar { selection-mode ▐'))).toEqual(['single', 'range'])
    expect(labels(PART('color-picker { alpha ▐'))).toEqual(['true', 'false'])
    // The single-valued surfaces read as one statement, not a block.
    expect(labels(PART('severity ▐'))).toEqual(['info', 'success', 'warning', 'danger'])
    expect(labels(PART('accordion ▐'))).toEqual(['single', 'multiple'])
  })

  it('offers the interactions inside `emits`, and the facets inside `motion`', () => {
    expect(labels(PART('emits {\n      change on ▐'))).toContain('activate')
    expect(labels(PART('motion {\n      ▐'))).toEqual(['transition'])
    const motion = labels(PART('motion {\n      transition ▐'))
    expect(motion).toContain('fill')
    expect(motion).toContain('duration')
  })

  it('offers part paths where a statement addresses another node', () => {
    const offered = labels(
      'component B {\n  part root {}\n  part root.label {}\n  part root.input {\n    a11y { labelled-by ▐',
    )
    expect(offered).toContain('root.label')
  })
})

describe('the library around the components', () => {
  it('offers the new top-level blocks', () => {
    const offered = labels('▐')
    for (const keyword of ['group', 'example', 'docs', 'assets', 'icons'])
      expect(offered).toContain(keyword)
  })

  it('offers the docs blocks inside a page, and a token type where one is expected', () => {
    const inDocs = labels('docs {\n  ▐')
    expect(inDocs).toEqual(['site', 'footer', 'page'])
    const inPage = labels('docs {\n  page "Home" {\n    ▐')
    expect(inPage).toContain('heading')
    expect(inPage).toContain('component-props')
    expect(labels('docs {\n  page "Home" {\n    tokens ▐')).toContain('color')
  })

  it('offers the asset kinds, then that kind’s own metadata', () => {
    const inAssets = labels('assets {\n  ▐')
    expect(inAssets).toContain('folder')
    expect(inAssets).toContain('svg')
    const inSvg = labels('assets {\n  svg "logo" {\n    ▐')
    // The bytes can travel two ways (§1.2), so both keys are offered.
    expect(inSvg).toContain('url')
    expect(inSvg).toContain('data')
    expect(inSvg).toContain('view-box')
    // …and a font's metadata is a font's, not an svg's.
    expect(labels('assets {\n  font "Inter" {\n    ▐')).toContain('font-family')
  })

  it('offers the icon statements, then each one’s own keys', () => {
    expect(labels('icons {\n  ▐')).toEqual(['set', 'glyph', 'custom'])
    expect(labels('icons {\n  set lucide "Lucide" {\n    ▐')).toEqual([
      'provider',
      'license',
      'samples',
    ])
    expect(labels('icons {\n  glyph lucide check {\n    ▐')).toEqual(['label', 'svg'])
    expect(labels('icons {\n  custom "Spark" {\n    ▐')).toEqual(['asset', 'label'])
  })

  it('offers an example’s own members', () => {
    expect(labels('example "Demo" for B {\n  ▐')).toEqual(['demo', 'part'])
  })
})
