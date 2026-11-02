import { describe, expect, it } from 'vitest'
import { CompletionItemKind } from 'vscode-languageserver-types'
import { computeCompletions } from './completion'
import { cursorContext } from './context'

// Completion is scoped to the cursor's position in the language. These tests are written
// against the position a person's caret is actually in mid-edit - including documents
// that don't parse yet - because that is the only state completion ever runs in.
const labels = (items: { label: string }[]): string[] => items.map((i) => i.label)

/** Complete at `▐` in the given source (the marker is removed before analysis). */
function completeAt(
  src: string,
): { label: string; kind?: CompletionItemKind; insertText?: string }[] {
  const index = src.indexOf('▐')
  if (index < 0) throw new Error('the source needs a ▐ caret marker')
  const text = src.replace('▐', '')
  const beforeCaret = src.slice(0, index)
  const line = beforeCaret.split('\n').length - 1
  const character = beforeCaret.length - (beforeCaret.lastIndexOf('\n') + 1)
  return computeCompletions(text, { line, character })
}

describe('cursorContext', () => {
  it('tracks the chain of open blocks', () => {
    const ctx = cursorContext('component B {\n  part root {\n    ▐', { line: 2, character: 4 })
    expect(ctx.stack).toEqual(['component', 'part'])
    expect(ctx.scope).toBe('part')
  })

  it('closes a block on `}`', () => {
    const src = 'foundations {\n}\n'
    expect(cursorContext(src, { line: 2, character: 0 }).scope).toBe('')
  })

  it('keeps the statement typed so far, and the partial word out of it', () => {
    const ctx = cursorContext('foundations {\n  token space/2 : siz', { line: 1, character: 21 })
    expect(ctx.statement).toEqual(['token', 'space/2', ':'])
    expect(ctx.partial).toBe('siz')
    expect(ctx.prev).toBe(':')
  })

  it('ignores braces inside comments and strings', () => {
    const src = '# a comment {\ncomponent B "a } brace" {\n  ▐'
    expect(cursorContext(src, { line: 2, character: 2 }).stack).toEqual(['component'])
  })

  it('names a block after the construct that opened it, not the statement’s first word', () => {
    const head = (src: string): string => {
      const lines = src.split('\n')
      return cursorContext(src, { line: lines.length - 1, character: lines.at(-1)!.length }).scope
    }
    // Opened mid-statement: the alias block belongs to `alias`, not to `token`.
    expect(head('foundations {\n  token bg : color = alias by Size {\n    ')).toBe('alias')
    expect(head('type Point = object {\n  ')).toBe('object')
    // A trailing `when` qualifies a head, it isn’t one - unless it stands alone.
    expect(head('component B {\n  part root {\n    state hovered when size = 2 {\n      ')).toBe(
      'state',
    )
    expect(head('component B {\n  part root {\n    layout when size = 2 {\n      ')).toBe('layout')
    expect(head('component B {\n  part root {\n    when size = 2 {\n      ')).toBe('when')
    // A name-led realization sub-block keeps its own name as the head.
    expect(head('component B {\n  realize root {\n    presentation popover {\n      ')).toBe(
      'presentation',
    )
  })
})

describe('computeCompletions - foundations', () => {
  // The reported bug: inside `foundations { … }` the top-level keywords were offered,
  // so `foundations` suggested itself and `token` was missing.
  it('offers only `token` inside a foundations block', () => {
    expect(labels(completeAt('foundations {\n  ▐\n}\n'))).toEqual(['token'])
  })

  it('offers nothing top-level inside foundations, even mid-word', () => {
    const items = labels(completeAt('foundations {\n  f▐\n}\n'))
    expect(items).not.toContain('foundations')
    expect(items).not.toContain('milda')
    expect(items).not.toContain('component')
  })

  it('offers token types after the `:`', () => {
    const items = completeAt('foundations {\n  token space/2 : ▐\n}\n')
    expect(labels(items)).toEqual(expect.arrayContaining(['color', 'spacing', 'duration']))
    expect(items[0].kind).toBe(CompletionItemKind.TypeParameter)
    // camelCase aliases stay accepted by the parser but aren't advertised
    expect(labels(items)).not.toContain('fontFamily')
  })

  // The literal forms the declared type admits come FIRST (a colour token is written
  // `= hex(…)` far more often than `= raw …`), then the value kinds. See
  // ./value-authoring.test.ts for what each literal inserts.
  it('offers the type’s own literals after the `=`, then the value kinds', () => {
    // Each colour space appears twice where it takes an alpha - `oklch` and `oklch / A` - so
    // that "how do I write a translucent colour" has an answer in the list.
    expect(labels(completeAt('foundations {\n  token brand : color = ▐\n}\n'))).toEqual([
      'hex',
      'oklch',
      'oklch / A',
      'srgb',
      'srgb / A',
      'rgb',
      'rgb / A',
      'p3',
      'p3 / A',
      'hsl',
      'hsl / A',
      'raw',
      'alias',
      'escape',
      'compute',
    ])
    // A length token admits `scaled(n)` directly, and a radius admits `pill` (0038).
    expect(labels(completeAt('foundations {\n  token space/2 : spacing = ▐\n}\n'))).toEqual([
      'scaled',
      'raw',
      'alias',
      'escape',
      'compute',
    ])
    expect(labels(completeAt('foundations {\n  token radius/full : radius = ▐\n}\n'))).toEqual([
      'scaled',
      'pill',
      'raw',
      'alias',
      'escape',
      'compute',
    ])
  })

  it('offers the literal functions after `raw`, per declared type', () => {
    expect(labels(completeAt('foundations {\n  token brand : color = raw ▐\n}\n'))).toEqual(
      expect.arrayContaining(['hex', 'oklch', 'p3']),
    )
    // A length token gets its own literal function rather than the colour ones.
    expect(labels(completeAt('foundations {\n  token space/2 : spacing = raw ▐\n}\n'))).toEqual([
      'scaled',
    ])
    expect(completeAt('foundations {\n  token weight/bold : font-weight = raw ▐\n}\n')).toEqual([])
  })

  it('offers declared context groups after `alias by`', () => {
    const src = 'context-group Size { S1 S2 }\nfoundations {\n  token bg : color = alias by ▐\n}\n'
    expect(labels(completeAt(src))).toEqual(['Size'])
  })

  it('offers contexts inside an alias block, and token refs past the arrow', () => {
    // The refs offered are the ones that would FIT the slot (see ./value-authoring.test.ts);
    // what this case is about is that all three spellings of the arrow are read as one.
    const head =
      'context-group Size { S1 S2 }\nfoundations {\n  token accent/9 : color = hex(00f)\n'
    expect(labels(completeAt(`${head}  token bg : color = alias by Size {\n    ▐`))).toEqual(
      expect.arrayContaining(['default', 'S1', 'S2']),
    )
    // Both arrow spellings are the same atom.
    expect(
      labels(completeAt(`${head}  token bg : color = alias by Size {\n    S1 -> ▐`)),
    ).toContain('accent.9')
    expect(labels(completeAt(`${head}  token bg : color = alias by Size {\n    S1 → ▐`))).toContain(
      'accent.9',
    )
    // `-` is a word character, so an unspaced arrow must still read as an arrow.
    expect(labels(completeAt(`${head}  token bg : color = alias by Size {\n    S1->▐`))).toContain(
      'accent.9',
    )
  })
})

describe('computeCompletions - component bodies', () => {
  const OPEN = 'component B {\n' // deliberately unclosed: the mid-edit state

  it('offers component keywords in a component body, not top-level ones', () => {
    const items = labels(completeAt(`${OPEN}  ▐`))
    expect(items).toEqual(expect.arrayContaining(['archetype', 'props', 'part', 'realize']))
    expect(items).not.toContain('component')
    expect(items).not.toContain('foundations')
  })

  it('offers archetypes after `archetype`', () => {
    expect(labels(completeAt(`${OPEN}  archetype ▐`))).toEqual(
      expect.arrayContaining(['Button', 'Link', 'Form']),
    )
  })

  it('offers capabilities after `requires`', () => {
    expect(labels(completeAt(`${OPEN}  requires ▐`)).length).toBeGreaterThan(0)
  })

  it('offers part keywords and surface facet names inside a part', () => {
    const items = labels(completeAt(`${OPEN}  part root {\n    ▐`))
    expect(items).toEqual(expect.arrayContaining(['layout', 'state', 'slot', 'fill', 'ink']))
    // The surface spelling the parser accepts - not the prelude's AST spelling.
    expect(items).toContain('text.clamp')
    expect(items).not.toContain('textClamp')
  })

  it('offers layout keys inside layout - not facets', () => {
    const items = labels(completeAt(`${OPEN}  part root {\n    layout {\n      ▐`))
    expect(items).toEqual(expect.arrayContaining(['stack', 'gap', 'align', 'inset']))
    expect(items).not.toContain('fill')
  })

  it('offers a layout key’s own values', () => {
    expect(labels(completeAt(`${OPEN}  part root {\n    layout { stack ▐`))).toEqual([
      'row',
      'column',
      'layers',
    ])
  })

  it('offers the edges after pinned and bleed, and the intents after size (0056)', () => {
    expect(labels(completeAt(`${OPEN}  part root {\n    layout { position pinned ▐`))).toEqual([
      'block-start',
      'block-end',
      'inline-start',
      'inline-end',
      'block',
      'inline',
      'all',
    ])
    expect(labels(completeAt(`${OPEN}  part root {\n    layout { size width ▐`))).toEqual([
      'fit',
      'fill',
      'weight',
      'fixed',
      'ratio',
    ])
    expect(labels(completeAt(`${OPEN}  part root {\n    layout { position ▐`))).toEqual([
      'flow',
      'overlay',
      'pinned',
      'bleed',
    ])
  })

  it('offers UI states after `state`', () => {
    expect(labels(completeAt(`${OPEN}  part root {\n    state ▐`))).toEqual(
      expect.arrayContaining(['hovered', 'pressed', 'disabled']),
    )
  })

  it('offers slot arities after `slot`', () => {
    expect(labels(completeAt(`${OPEN}  part root {\n    slot ▐`))).toEqual(
      expect.arrayContaining(['single', 'optional', 'many', 'of']),
    )
  })

  it('offers declared token refs after a facet name, in dotted form', () => {
    const src = `foundations {\n  token space/2 : spacing = 8px\n}\n${OPEN}  part root {\n    fill ▐`
    const items = completeAt(src)
    expect(labels(items)).toContain('space.2')
    expect(items.every((i) => i.kind === CompletionItemKind.Value)).toBe(true)
  })

  it('offers type words plus declared types after a prop name, each with its colon', () => {
    const src = `context-group Size { S1 }\ntype Icon = string\n${OPEN}  props {\n    size ▐`
    const items = completeAt(src)
    expect(labels(items)).toEqual(expect.arrayContaining(['enum', 'ref', 'Size', 'Icon']))
    // A type picked here cannot land on the line without the `:` the reader requires.
    expect(items.find((i) => i.label === 'Size')?.insertText).toBe(': Size')
  })

  it('offers type words after the colon itself, then without repeating it', () => {
    const src = `context-group Size { S1 }\n${OPEN}  props {\n    size : ▐`
    const items = completeAt(src)
    expect(labels(items)).toEqual(expect.arrayContaining(['enum', 'Size']))
    expect(items.find((i) => i.label === 'Size')?.insertText).toBeUndefined()
  })

  it('offers a prop’s own context-group members as its default', () => {
    const src = `context-group Size { S1 S2 S3 }\n${OPEN}  props {\n    size : Size = ▐`
    expect(labels(completeAt(src))).toEqual(['S1', 'S2', 'S3', 'true', 'false', 'alias'])
  })

  it('offers `from` after an event name', () => {
    expect(labels(completeAt(`${OPEN}  events {\n    click ▐`))).toEqual(['from'])
  })
})

describe('computeCompletions - document root', () => {
  it('offers top-level keywords at the start of a statement', () => {
    expect(labels(completeAt('foundations {\n}\n▐'))).toEqual(
      expect.arrayContaining(['component', 'foundations', 'context-group', 'type']),
    )
  })

  it('stays quiet once the statement has a head keyword', () => {
    // `component ▐` wants a name of the author's choosing, not more keywords.
    expect(completeAt('component ▐')).toEqual([])
  })
})
