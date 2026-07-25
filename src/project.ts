// ─── Milda LSP — project (cross-file) context ─────────────────────────────────
// A Milda design system is authored as one directory of `.milda` files (foundations,
// palettes, and component files that reference each other). Analyzing a single file
// in isolation reports every cross-file reference as "missing", so the semantic pass
// needs the sibling files too. This reads them from disk (the edited file's own text
// comes from the in-memory document), with a small mtime cache so unchanged siblings
// aren't re-read on every keystroke.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Cached {
  mtimeMs: number
  text: string
}
const cache = new Map<string, Cached>()

/** Texts of every other `.milda` file in the same directory as `uri`. */
export function readSiblingMildaTexts(uri: string): string[] {
  let path: string
  try {
    path = fileURLToPath(uri)
  } catch {
    return [] // non-file URIs (untitled buffers, etc.) have no siblings
  }
  const dir = dirname(path)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const out: string[] = []
  for (const name of entries) {
    if (!name.endsWith('.milda')) continue
    const full = join(dir, name)
    if (full === path) continue // the edited file comes from the in-memory document
    try {
      const mtimeMs = statSync(full).mtimeMs
      const hit = cache.get(full)
      if (hit && hit.mtimeMs === mtimeMs) {
        out.push(hit.text)
        continue
      }
      const text = readFileSync(full, 'utf8')
      cache.set(full, { mtimeMs, text })
      out.push(text)
    } catch {
      // unreadable / deleted between readdir and read — skip it
    }
  }
  return out
}
