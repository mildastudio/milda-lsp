import { parseMildaDocument } from '@mildastudio/milda'
import { describe, expect, it } from 'vitest'
import { computeCompletions, STATEMENT_SNIPPETS } from './completion'

// ─── The shape of a statement ─────────────────────────────────────────────────
// Almost everything in this language is `keyword name { … }`, and typing the braces, the quotes
// and the name by hand is both the dull part and where the shape goes wrong. So a keyword
// completed at the head of a statement arrives as its whole shape, with the name as a tab stop.
//
// A scaffold the reader would then complain about is worse than no scaffold at all, so every
// entry in the table is expanded here and run through the real parser. That is also what keeps
// the table honest as the surface grows: a statement whose shape changes fails this file.

/** A snippet as the editor would leave it if the author tabbed through without typing: the
 *  placeholder defaults, with the empty stops removed. */
const expand = (snippet: string): string =>
  snippet
    .replace(/\$\{\d+\|([^|]*)\|\}/g, (_, choices: string) => choices.split(',')[0])
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}/g, '')
    .replace(/\$0/g, '')
    .replace(/\t/g, '  ')

// Where each statement lives. Every key of the table needs an entry here, so a new scaffold
// cannot be added without saying where it belongs (and having that checked).
const WRAPPERS: Readonly<Record<string, (body: string) => string>> = {
  'context-group': (b) => b,
  foundations: (b) => b,
  meta: (b) => b,
  type: (b) => `${b} object { field : string }`,
  // The scaffold leaves the type open (`: Type`), so the wrapper supplies one the reader knows.
  'global-prop': (b) => b.replace(': Type', ': string'),
  component: (b) => b,
  rule: (b) => `component Child {}\ncomponent Parent {}\n${b}`,
  group: (b) => b,
  example: (b) => `component Card {\n  part root { kind container }\n}\n${b}`,
  docs: (b) => b,
  assets: (b) => b,
  props: (b) => `component B {\n${b}\n}`,
  events: (b) => `component B {\n${b}\n}`,
  part: (b) => `component B {\n${b}\n}`,
  realize: (b) => `component B {\n  part root { kind container }\n${b}\n}`,
  layout: (b) => `component B {\n  part root {\n${b}\n  }\n}`,
  state: (b) => `component B {\n  part root {\n${b}\n  }\n}`,
  when: (b) =>
    `component B {\n  props { open : boolean = false }\n  part root {\n${b.replace('condition', 'open = true')}\n  }\n}`,
  a11y: (b) => `component B {\n  part root {\n${b}\n  }\n}`,
  emits: (b) => `component B {\n  part root {\n${b}\n  }\n}`,
  behavior: (b) => `component B {\n  part root {\n${b}\n  }\n}`,
  behaviour: (b) => `component B {\n  part root {\n${b}\n  }\n}`,
  instance: (b) =>
    `component Inner {\n  part root { kind container }\n}\ncomponent B {\n  part root {\n${b}\n  }\n}`,
  object: (b) => `type Thing = ${b}`,
  demo: (b) =>
    `component Card {\n  part root { kind container }\n}\nexample "one" for Card {\n${b}\n}`,
  site: (b) => `docs {\n${b}\n}`,
  footer: (b) => `docs {\n${b}\n}`,
  page: (b) => `docs {\n${b}\n}`,
}

describe('every statement scaffold', () => {
  it('says where it belongs', () => {
    expect(Object.keys(STATEMENT_SNIPPETS).sort()).toEqual(Object.keys(WRAPPERS).sort())
  })

  for (const [keyword, snippet] of Object.entries(STATEMENT_SNIPPETS)) {
    it(`\`${keyword}\` expands to something the reader accepts`, () => {
      const source = WRAPPERS[keyword](expand(snippet))
      const { issues } = parseMildaDocument(source)
      // Errors are the bar: a scaffold is a skeleton, so a note about an empty block is fair,
      // but nothing in it may be un-READABLE.
      const errors = issues.filter((i) => i.severity === 'error')
      expect(
        errors.map((e) => `${e.line}:${e.col} ${e.code} ${e.message}`),
        source,
      ).toEqual([])
    })
  }

  it('carries the tab stops a client can walk through', () => {
    // Every scaffold that names something puts the name FIRST, so the author types it straight
    // away rather than hunting for the caret.
    for (const [keyword, snippet] of Object.entries(STATEMENT_SNIPPETS)) {
      if (!snippet.includes('${1')) continue
      expect(snippet.indexOf('${1'), keyword).toBeLessThan(snippet.indexOf('$0') + snippet.length)
    }
  })
})

describe('a scaffold arrives only where the keyword is a statement head', () => {
  const at = (src: string, snippets = true) => {
    const index = src.indexOf('▐')
    const before = src.slice(0, index)
    return computeCompletions(
      src.replace('▐', ''),
      {
        line: before.split('\n').length - 1,
        character: before.length - (before.lastIndexOf('\n') + 1),
      },
      { snippets },
    )
  }
  const insertOf = (src: string, label: string, snippets = true) =>
    at(src, snippets).find((i) => i.label === label)?.insertText

  it('scaffolds a top-level block', () => {
    expect(insertOf('▐', 'component')).toBe('component ${1:Name} "${2:what it is for}" {\n\t$0\n}')
    expect(insertOf('▐', 'context-group')).toBe('context-group ${1:Name} {\n\t$0\n}')
  })

  it('scaffolds a part statement, and a part', () => {
    expect(insertOf('component B {\n  ▐', 'part')).toBe('part ${1:name} {\n\t$0\n}')
    expect(insertOf('component B {\n  part root {\n    ▐', 'state')).toBe(
      'state ${1:hovered} {\n\t$0\n}',
    )
  })

  it('leaves the same word alone when it is an argument', () => {
    // `group radio` inside a part is a realization value, not a declaration - and `state` after
    // `bind` names a UI state. Neither is a statement head, so neither gets braces.
    expect(insertOf('component B {\n  part root {\n    group ▐', 'radio')).toBeUndefined()
    expect(insertOf('component B {\n  part root {\n    bind ▐', 'state')).toBeUndefined()
  })

  it('sends a snippet-less client the plain keyword', () => {
    expect(insertOf('▐', 'component', false)).toBeUndefined()
  })
})
