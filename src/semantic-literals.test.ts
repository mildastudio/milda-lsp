import { describe, expect, it } from 'vitest'
import { computeSemanticDiagnostics } from './semantic'

// The Studio prints literals into token positions (`gap 0px`, `size fixed(50%)`, `border
// transparent Hairline`), and the semantic pass used to call every one a missing token - so a
// file exported from the Studio opened in VS Code or JetBrains covered in errors (proposal 0049:
// a token first, a literal only once no token claims the word).
const file = (part: string) =>
  [
    'foundations {',
    '  token SM : dimension = { value: 8; unit: px }',
    '}',
    'component Tabs {',
    '  part tab {',
    ...part.split('\n').map((l) => `    ${l}`),
    '  }',
    '}',
  ].join('\n')

describe('computeSemanticDiagnostics - literals in token positions', () => {
  it('says nothing about the literals the Studio exports', () => {
    const text = file(
      [
        'layout { stack row; gap 0px; size fixed(50%) fixed(16px) }',
        'inset 6px SM',
        'border transparent Hairline',
      ].join('\n'),
    )
    expect(computeSemanticDiagnostics(text)).toEqual([])
  })

  it('still puts an error on a misspelled token', () => {
    const codes = computeSemanticDiagnostics(file('layout { gap acent-3 }')).map((d) => d.code)
    expect(codes).toEqual(['layout.danglingToken'])
  })
})
