// ─── Milda LSP - signature help ───────────────────────────────────────────────
// While the cursor sits inside a value literal's parentheses, the editor shows what that
// function takes and which argument is being typed: `oklch(L C H / A)` with `C` in bold
// once you are past the first space. It is the answer to "I picked `oklch`, now what are
// the three numbers?" - the one question completion cannot answer, because at that point
// there is no word to complete, only a value to write.
//
// The signature text comes from the language's own literal table (VALUE_LITERAL_FNS), the
// same one the parser reads its function names from, so the hint cannot describe a
// function the reader does not accept.

import { VALUE_LITERAL_FNS, type LiteralFnSpec } from '@mildastudio/milda'
import {
  type Position,
  type SignatureHelp,
  type SignatureInformation,
} from 'vscode-languageserver-types'

/** The call the cursor is inside, and how far into its arguments it has got. */
interface OpenCall {
  fn: string
  /** 0-based index of the argument being typed. */
  argIndex: number
}

export function computeSignatureHelp(text: string, position: Position): SignatureHelp | null {
  const call = openCallAt(text, position)
  if (!call) return null
  const spec = VALUE_LITERAL_FNS[call.fn]
  if (!spec) return null

  const params = [...spec.channels.map((c) => ({ name: c.name, hint: c.hint }))]
  if (spec.alpha)
    params.push({ name: 'A', hint: 'alpha, 0..1 or a percentage - write it after a `/`' })

  const signature: SignatureInformation = {
    label: `${call.fn}(${labelOf(spec)})`,
    documentation: spec.doc,
    parameters: params.map((p) => ({ label: p.name, documentation: `${p.name} - ${p.hint}` })),
  }
  return {
    signatures: [signature],
    activeSignature: 0,
    // Past the last argument the hint stays on it rather than pointing at nothing.
    activeParameter: Math.min(call.argIndex, params.length - 1),
  }
}

/** `oklch(L C H / A)` - the alpha is shown as the optional slash form the parser reads. */
function labelOf(spec: LiteralFnSpec): string {
  const channels = spec.channels.map((c) => c.name).join(' ')
  return spec.alpha ? `${channels} / A` : channels
}

/**
 * Walk back from the cursor for the innermost `(` that is still open, and read the word in
 * front of it. Only the current line is considered: a literal is written on one line, and
 * an unclosed paren left further up the file must not make every line look like a call.
 */
function openCallAt(text: string, position: Position): OpenCall | null {
  const line = text.split('\n')[position.line] ?? ''
  const before = line.slice(0, Math.min(position.character, line.length))
  // A `#` starts a comment: nothing after it is code, so nothing in it is a call.
  const code = before.includes('#') ? before.slice(0, before.indexOf('#')) : before

  let depth = 0
  let open = -1
  for (let i = code.length - 1; i >= 0; i--) {
    const c = code[i]
    if (c === ')') depth++
    else if (c === '(') {
      if (depth === 0) {
        open = i
        break
      }
      depth--
    }
  }
  if (open < 0) return null

  const name = /[A-Za-z]+$/.exec(code.slice(0, open).trimEnd())?.[0] ?? ''
  if (!name) return null

  // Arguments are separated by whitespace, or by the `/` that introduces the alpha - the
  // same split the parser makes. Counting the separators (not the words) is what puts the
  // hint on the argument being STARTED: after `oklch(0.62 ` the answer is the second one.
  const inner = code.slice(open + 1).replace(/^\s+/, '')
  const argIndex = inner === '' ? 0 : (inner.match(/[\s/]+/g) ?? []).length
  return { fn: name, argIndex }
}
