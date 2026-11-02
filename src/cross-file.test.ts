import { describe, expect, it } from 'vitest'
import { DiagnosticSeverity } from 'vscode-languageserver-types'
import { computeSemanticDiagnostics } from './semantic'

const component = [
  'component Btn "b" {',
  '  archetype Button',
  '  part root { fill accent.9 }',
  '}',
].join('\n')
const foundations = [
  'foundations {',
  '  token accent/9 : dimension = { value: 1; unit: px }',
  '}',
].join('\n')

const errorCodes = (text: string, siblings: string[] = []) =>
  computeSemanticDiagnostics(text, siblings)
    .filter((d) => d.severity === DiagnosticSeverity.Error)
    .map((d) => d.code)

describe('computeSemanticDiagnostics - cross-file', () => {
  it('flags a token ref as dangling with no sibling context', () => {
    expect(errorCodes(component)).toContain('facet.danglingToken')
  })

  it('resolves the token ref once the defining sibling is provided', () => {
    expect(errorCodes(component, [foundations])).not.toContain('facet.danglingToken')
  })

  it("reports the current file's own issues, not a sibling's", () => {
    const siblingWithError = ['foundations {', '  token x/a : dimension = x.missing', '}'].join(
      '\n',
    )
    const codes = errorCodes(component, [siblingWithError])
    // The component's own unresolved token still shows (sibling doesn't define it)...
    expect(codes).toContain('facet.danglingToken')
    // ...but the sibling's dangling alias ref belongs to the sibling's editor view.
    expect(codes).not.toContain('alias.danglingRef')
  })
})
