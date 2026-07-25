import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeSemanticTokens, decodeSemanticTokens } from './semantic-tokens'

// The committed golden token streams (highlight-corpus/*.tokens.json) are the contract
// the Kotlin lexer is tested against. This test keeps them FRESH: if the TS classifier
// changes, the goldens must be regenerated (`npm run gen:highlight`) or this fails —
// which in turn signals the Kotlin lexer needs re-checking against the new goldens.
const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'highlight-corpus')
const files = readdirSync(corpusDir).filter((f) => f.endsWith('.milda')).sort()

describe('highlight goldens are fresh (TS is the source of truth)', () => {
  it('has a corpus', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const f of files) {
    it(`${f} matches its committed golden`, () => {
      const text = readFileSync(join(corpusDir, f), 'utf8')
      const actual = decodeSemanticTokens(computeSemanticTokens(text).data)
      const goldenPath = join(corpusDir, f.replace(/\.milda$/, '.tokens.json'))
      const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
      expect(actual).toEqual(golden)
    })
  }
})
