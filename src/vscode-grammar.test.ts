import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildTmLanguage } from './tmgrammar'
import { COLOR_FNS, KEYWORDS, TYPE_WORDS } from './vocab'

// The committed VS Code grammar lives in the sibling milda-vscode package. In the
// standalone milda-lsp mirror that package isn't checked out, so guard on its presence.
const grammarPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'milda-vscode',
  'syntaxes',
  'milda.tmLanguage.json',
)
const present = existsSync(grammarPath)

describe('VS Code TextMate grammar', () => {
  it('builds a grammar whose word lists come from the shared vocab', () => {
    const g = buildTmLanguage()
    // Keywords, types and colour-fns must all appear in the generated match patterns,
    // so the TextMate highlighter can never drift from the LSP/JetBrains vocabulary.
    for (const w of KEYWORDS) expect(g.repository.keyword.match).toContain(w)
    for (const w of [...TYPE_WORDS, ...COLOR_FNS]) expect(g.repository.type.match).toContain(w)
  })

  it.skipIf(!present)('committed milda-vscode grammar is up to date (run gen:highlight)', () => {
    const committed = readFileSync(grammarPath, 'utf8')
    const fresh = `${JSON.stringify(buildTmLanguage(), null, 2)}\n`
    expect(committed).toBe(fresh)
  })
})
