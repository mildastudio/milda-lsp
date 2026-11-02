import { describe, expect, it } from 'vitest'
import { computeCompletions } from './completion'

// ─── Completion for how the system is used (proposal 0052) ─────────────────────
// Every rule statement opens with one keyword of its own (§5.3), which is what lets the editor
// answer "what can go here" from the first word of the line alone. These pin that it does.

const labels = (src: string): string[] => {
  const index = src.indexOf('▐')
  if (index < 0) throw new Error('the source needs a ▐ caret marker')
  const before = src.slice(0, index)
  const line = before.split('\n').length - 1
  const character = before.length - (before.lastIndexOf('\n') + 1)
  return computeCompletions(src.replace('▐', ''), { line, character }).map((i) => i.label)
}

const SYSTEM = `component Button {\n  props {\n    label : string\n    labelledBy : string\n  }\n}\ncomponent Badge {}\n`
const RULE = (body: string) => `${SYSTEM}rule r error {\n  ${body}`

describe('a rule', () => {
  it('is offered at the top level', () => {
    expect(labels('▐')).toContain('rule')
  })

  it('offers the statement keywords at the head of a line', () => {
    expect(labels(RULE('▐'))).toEqual([
      'max',
      'min',
      'never',
      'only',
      'tokens',
      'prefer',
      'because',
    ])
  })

  it('offers the components, and `archetype`, where a subject goes', () => {
    for (const at of ['never ▐', 'max 1 ▐', 'only Badge within ▐', 'only Badge within Button, ▐'])
      expect(labels(RULE(at)), at).toEqual(['Button', 'Badge', 'archetype'])
  })

  it('offers the prelude archetypes after `archetype`', () => {
    expect(labels(RULE('never Badge within archetype ▐'))).toContain('Dialog')
  })

  it('offers what follows a subject', () => {
    expect(labels(RULE('never Badge ▐'))).toEqual(['where', 'within'])
  })

  it('offers token types after `tokens`', () => {
    expect(labels(RULE('tokens ▐'))).toContain('color')
    expect(labels(RULE('tokens color, ▐'))).toContain('spacing')
  })

  it('walks `prefer` through its words', () => {
    expect(labels(RULE('prefer ▐'))).toEqual(['Button', 'Badge'])
    expect(labels(RULE('prefer Button ▐'))).toEqual(['for'])
    expect(labels(RULE('prefer Button for ▐'))).toEqual(['archetype'])
  })
})

describe('a props block', () => {
  const PROPS = (line: string) => `component B {\n  props {\n    loading : boolean\n    ${line}`
  it('offers the group constraints at the head of a line', () => {
    expect(labels(PROPS('▐'))).toEqual(['one-of', 'any-of', 'exclusive', 'global'])
  })
  it('offers `required`, then `when`', () => {
    expect(labels(PROPS('loadingLabel : string ▐'))).toEqual(['required', 'bind'])
    expect(labels(PROPS('loadingLabel : string required ▐'))).toEqual(['when'])
  })
})
