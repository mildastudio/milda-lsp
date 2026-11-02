// ─── Milda LSP - cursor context ───────────────────────────────────────────────
// Where in the language is the cursor? Completion needs an answer even while the
// document is half-typed and doesn't parse, so this is a brace-tracking scan of the
// text BEFORE the cursor rather than a look at the parse tree: each `{` pushes the
// head keyword of the statement that opened it, each `}` pops. What comes back is the
// chain of open blocks plus the atoms of the statement being typed - enough to answer
// "am I inside `foundations`?" or "have I already typed the `:` of a token decl?".
//
// Only the prefix matters, so an unclosed block (the common case mid-edit) is fine;
// comments and string literals are skipped so a `{` inside either can't open a block.

import type { Position } from 'vscode-languageserver-types'

// Identifier / path / prop-ref characters - the classifier's word class (see
// ./semantic-tokens). A dotted ref (`space.2`, `text.clamp`) is a single atom.
const WORD = /[A-Za-z0-9_./%$-]/
const WORD_TAIL = /[A-Za-z0-9_./%$-]+$/ // the same class, anchored: the word being typed

/** A string literal, collapsed to one opaque atom (its content is never vocabulary). */
export const STRING_ATOM = '""'

/** Both spellings of the alias / wire arrow (`->` and `→`) come through as this. */
export const ARROW_ATOM = '->'

export interface CursorContext {
  /** Head keyword of each open block, outermost first - e.g. `['component', 'part']`. */
  stack: string[]
  /** Innermost open block's head (`''` at the document root). */
  scope: string
  /** Atoms of the statement so far, excluding the partial word under the cursor -
   *  e.g. `['token', 'space/2', ':', 'size', '=']`. Operators come through as atoms. */
  statement: string[]
  /** The partial word being typed (what the client filters its list against). */
  partial: string
  /** Last atom of `statement`, or `''` - the "what did I just type" signal. */
  prev: string
  /** The atoms of the statement that OPENED the innermost block. A block body's vocabulary
   *  can depend on them: `behavior focus-trap { ▐ }` offers a focus trap's fields, and
   *  `svg "logo" { ▐ }` an svg asset's - which the head keyword alone cannot tell you
   *  (proposal 0041). Empty at the document root. */
  blockStatement: string[]
}

export function cursorContext(text: string, position: Position): CursorContext {
  const lines = text.split('\n')
  const line = lines[position.line] ?? ''
  // Clamp: a client may report a character past end-of-line (virtual space).
  const character = Math.min(position.character, line.length)
  const before = line.slice(0, character)
  const partial = WORD_TAIL.exec(before)?.[0] ?? ''
  // Scan up to the START of the partial word: the word under the cursor is what the
  // client filters with, not part of the statement's already-typed context.
  const offset =
    lines.slice(0, position.line).reduce((n, l) => n + l.length + 1, 0) +
    (character - partial.length)

  const stack: string[] = []
  // The opening statement of each block on the stack, in step with it.
  const openers: string[][] = []
  let statement: string[] = []
  let i = 0
  while (i < offset) {
    const c = text[i]
    if (c === '#') {
      while (i < offset && text[i] !== '\n') i++
      continue
    }
    if (c === '"') {
      i++
      while (i < offset && text[i] !== '"' && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1
      if (text[i] === '"') i++
      statement.push(STRING_ATOM)
      continue
    }
    if (c === '\n' || c === ';') {
      statement = []
      i++
      continue
    }
    if (c === '{') {
      stack.push(headOf(statement))
      openers.push(statement)
      statement = []
      i++
      continue
    }
    if (c === '}') {
      stack.pop()
      openers.pop()
      statement = []
      i++
      continue
    }
    // The operators that change what may come next: `:` `=`, the comma of a list (`global a, ▐`,
    // `tokens color, ▐` - the next item, not whatever follows the previous one) and the
    // alias/wire arrow (either spelling). Everything else - parens, comparisons - is skipped.
    if (c === ':' || c === '=' || c === ',') {
      statement.push(c)
      i++
      continue
    }
    if (c === '→') {
      statement.push(ARROW_ATOM)
      i++
      continue
    }
    if (c === '-' && text[i + 1] === '>') {
      statement.push(ARROW_ATOM)
      i += 2
      continue
    }
    if (WORD.test(c)) {
      const start = i
      // Stop before an arrow: `-` is a word character, so `S1->x` must not eat the `-`.
      while (i < offset && WORD.test(text[i]) && !(text[i] === '-' && text[i + 1] === '>')) i++
      statement.push(text.slice(start, i))
      continue
    }
    i++
  }

  return {
    stack,
    scope: stack[stack.length - 1] ?? '',
    statement,
    partial,
    prev: statement[statement.length - 1] ?? '',
    blockStatement: openers[openers.length - 1] ?? [],
  }
}

// Every keyword that can introduce a `{ … }` block (grammar: topdecl, cmember, pstmt,
// tokenvalue, typeexpr). A block whose head is none of these is one of the language's
// name-led blocks - a realization sub-block like `presentation popover { … }`.
const BLOCK_KEYWORDS = new Set([
  'foundations',
  'meta',
  'context-group',
  'component',
  'rule',
  'props',
  'events',
  'part',
  'layout',
  'state',
  'when',
  'realize',
  'alias',
  'object',
])

/**
 * The keyword a block hangs off. Scanned BACKWARD from the `{`, so a block opened
 * mid-statement reports the construct that actually opened it (`token bg : color = alias
 * by Size {` → `alias`, not `token`). `when` is the exception: it trails a real head
 * (`state hovered when …`, `layout when …`), so it only wins when nothing else is there.
 * A head that is no keyword at all falls back to the statement's first word.
 */
function headOf(statement: string[]): string {
  let sawWhen = false
  for (let i = statement.length - 1; i >= 0; i--) {
    const atom = statement[i]
    if (atom === 'when') {
      sawWhen = true
      continue
    }
    if (BLOCK_KEYWORDS.has(atom)) return atom
  }
  if (sawWhen) return 'when'
  for (const atom of statement) {
    if (/^[A-Za-z_]/.test(atom)) return atom // skips strings, operators and numbers alike
  }
  return ''
}
