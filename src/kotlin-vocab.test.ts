import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildKotlinVocab } from './kotlin-vocab'

// The JetBrains plugin is not checked out in the standalone milda-lsp mirror, so the comparison
// is guarded on its presence, the way the grammar's is.
const here = dirname(fileURLToPath(import.meta.url))
const kotlin = join(
  here,
  '..',
  '..',
  'milda-jetbrains',
  'src',
  'main',
  'kotlin',
  'studio',
  'milda',
  'lang',
  'MildaVocab.kt',
)

describe('MildaVocab.kt', () => {
  it.skipIf(!existsSync(kotlin))(
    'is what gen:highlight would write today (run `npm run gen:highlight -w @mildastudio/milda-lsp`)',
    () => {
      expect(readFileSync(kotlin, 'utf8')).toBe(buildKotlinVocab())
    },
  )
})
