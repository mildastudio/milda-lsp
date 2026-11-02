import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMildaDocument } from '@mildastudio/milda'
import { describe, expect, it } from 'vitest'

// ─── The starter file the editors offer ───────────────────────────────────────
// *New | Milda File* (JetBrains) writes a template. A starter file with a mistake in it is
// worse than no template at all: the author's first experience of the language is their own
// editor underlining code they did not write. The reader is the judge, so the template is run
// through the real parser here - the plugin's own tests cannot do it, being a JVM away from
// the grammar.
//
// The plugin is not checked out in the standalone milda-lsp mirror, so this guards on presence
// (as ./textmate-grammar.test.ts does for the generated grammars).
const here = dirname(fileURLToPath(import.meta.url))
const template = join(
  here,
  '..',
  '..',
  'milda-jetbrains',
  'src',
  'main',
  'resources',
  'fileTemplates',
  'internal',
  'Milda File.milda.ft',
)

describe('the New | Milda File template', () => {
  it.skipIf(!existsSync(template))('parses cleanly, with nothing to report', () => {
    // The one Velocity macro the template uses is the new file's name.
    const source = readFileSync(template, 'utf8').replace(/\$\{NAME\}/g, 'Palette')
    const { document, issues } = parseMildaDocument(source)
    expect(issues).toEqual([])
    // And it is a system, not a stub: a context group, tokens, and an alias that covers it.
    expect(document.foundations.contextGroups).toHaveLength(1)
    expect(document.foundations.layers[0].tokens.length).toBeGreaterThanOrEqual(4)
    expect(document.meta.name).toBe('Palette')
  })
})
