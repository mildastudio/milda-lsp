import { MILDA_SURFACE_VERSION, PRELUDE_VERSION } from '@mildastudio/milda'
import { describe, expect, it } from 'vitest'
import { checkMildaFiles, checkMildaFragment, formatFinding, mildaFences } from './check'

const HEADER = `milda ${MILDA_SURFACE_VERSION}\nprelude ${PRELUDE_VERSION}\n`

const FOUNDATIONS = `${HEADER}
foundations {
  token accent : color = hex(7c3aed)
  token space/sm : spacing = 8px
}
`

const BUTTON = `${HEADER}
component Button {
  archetype Button
  part Button: container {
    fill accent
    inset space.sm
  }
  part label: text {
    content "Go"
  }
}
`

describe('milda-check', () => {
  it('finds nothing in a clean pair, because siblings resolve each other', () => {
    const findings = checkMildaFiles([
      { path: 'foundations.milda', text: FOUNDATIONS },
      { path: 'button.milda', text: BUTTON },
    ])
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
  })

  it('reports a reference the sibling does not declare, on the file that makes it', () => {
    const findings = checkMildaFiles([
      { path: 'foundations.milda', text: FOUNDATIONS },
      { path: 'button.milda', text: BUTTON.replace('fill accent', 'fill brand.nope') },
    ])
    const hit = findings.find((f) => f.message.includes('brand.nope'))
    expect(hit?.path).toBe('button.milda')
    expect(hit?.severity).toBe('error')
    // Semantic issues sit on the declaration that owns them - the component - not on the facet.
    expect(hit?.line).toBe(BUTTON.split('\n').findIndex((l) => l.includes('component Button')) + 1)
  })

  it('reports a part the archetype requires and the file leaves out', () => {
    const withoutLabel = BUTTON.replace(/  part label: text \{[^}]*\}\n/, '')
    const findings = checkMildaFiles([
      { path: 'foundations.milda', text: FOUNDATIONS },
      { path: 'button.milda', text: withoutLabel },
    ])
    expect(findings.map((f) => f.code)).toContain('part.required')
  })

  it('reports a syntax error with a 1-based position and prints it the way compilers do', () => {
    const findings = checkMildaFiles([
      { path: 'x.milda', text: `${HEADER}foundations {\n  token\n}\n` },
    ])
    const error = findings.find((f) => f.severity === 'error')
    expect(error).toBeDefined()
    expect(error!.line).toBeGreaterThanOrEqual(1)
    expect(error!.col).toBeGreaterThanOrEqual(1)
    expect(formatFinding(error!)).toMatch(/^x\.milda:\d+:\d+ error /)
  })
})

describe('fragments in prose', () => {
  const md = [
    '# Title',
    '',
    '```milda foundations',
    'token accent : color = hex(7c3aed)',
    '```',
    '',
    '```milda part',
    'part label: text {',
    '  background red',
    '}',
    '```',
    '',
    '```ts',
    'not milda',
    '```',
  ].join('\n')

  it('finds each milda fence with its wrap and the line its code starts on', () => {
    expect(mildaFences(md).map((f) => [f.wrap, f.line])).toEqual([
      ['foundations', 4],
      ['part', 8],
    ])
  })

  it('places a finding on the line of the prose, not of the scaffold', () => {
    const [, part] = mildaFences(md)
    const findings = checkMildaFragment('doc.md', part!.code, part!.wrap, part!.line)
    expect(findings).toEqual([
      expect.objectContaining({ path: 'doc.md', line: 9, code: 'facet-unknown' }),
    ])
  })

  it('finds nothing in a clean piece', () => {
    const [foundations] = mildaFences(md)
    expect(checkMildaFragment('doc.md', foundations!.code, foundations!.wrap)).toEqual([])
  })
})
