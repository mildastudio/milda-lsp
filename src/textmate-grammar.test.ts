import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildTmLanguage } from './tmgrammar'
import { COLOR_FNS, KEYWORDS, TYPE_WORDS } from './vocab'

// The generated grammar is committed in two places: the VS Code / Open VSX extension
// and the plugin-free JetBrains TextMate bundle under docs/. Neither is checked out in
// the standalone milda-lsp mirror, so guard each on its presence.
const here = dirname(fileURLToPath(import.meta.url))
const vscodeDir = join(here, '..', '..', 'milda-vscode')
const bundleDir = join(here, '..', '..', '..', 'docs', 'dsl', 'editors', 'jetbrains')
const consumers = [
  { name: 'milda-vscode', grammar: join(vscodeDir, 'syntaxes', 'milda.tmLanguage.json') },
  { name: 'JetBrains TextMate bundle', grammar: join(bundleDir, 'milda.tmLanguage.json') },
]

describe('TextMate grammar', () => {
  it('builds a grammar whose word lists come from the shared vocab', () => {
    const g = buildTmLanguage()
    // Keywords, types and colour-fns must all appear in the generated match patterns,
    // so the TextMate highlighter can never drift from the LSP/JetBrains vocabulary.
    for (const w of KEYWORDS) expect(g.repository.keyword.match).toContain(w)
    for (const w of [...TYPE_WORDS, ...COLOR_FNS]) expect(g.repository.type.match).toContain(w)
  })

  const fresh = `${JSON.stringify(buildTmLanguage(), null, 2)}\n`
  for (const { name, grammar } of consumers) {
    it.skipIf(!existsSync(grammar))(
      `committed ${name} grammar is up to date (run gen:highlight)`,
      () => {
        expect(readFileSync(grammar, 'utf8')).toBe(fresh)
      },
    )
  }

  // Same grammar, same editing behaviour: the bundle's language config is a copy of the
  // extension's, so `⌘/`, bracket pairs and Enter-indent behave identically in both.
  const langConfigs = [
    join(vscodeDir, 'language-configuration.json'),
    join(bundleDir, 'language-configuration.json'),
  ]
  it.skipIf(!langConfigs.every(existsSync))(
    'bundle language-configuration.json matches the extension (run gen:highlight)',
    () => {
      const [vscode, bundle] = langConfigs.map((p) => readFileSync(p, 'utf8'))
      expect(bundle).toBe(vscode)
    },
  )
})
