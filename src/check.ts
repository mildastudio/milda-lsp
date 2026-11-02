// ─── Milda LSP - one-shot check ───────────────────────────────────────────────
// The diagnostics an editor shows, for a caller that is not an editor: a CI step, a
// pre-commit hook, or an AI agent that has just written a `.milda` file and needs to know
// whether the reader agrees with it. That last caller is why this exists - an agent that
// can run the real reader corrects itself from diagnostics instead of from its own
// guesses about the language (the Milda agent skill tells it to run this after every edit).
//
// Same two passes the server publishes on every keystroke, so a file that is clean here is
// clean in the editor. The semantic pass sees the other files given in the same call as
// siblings, the way the server sees the other `.milda` files of a directory: a token
// declared in `foundations.milda` resolves from `button.milda`.

import { type Diagnostic, DiagnosticSeverity } from 'vscode-languageserver-types'
import { computeDiagnostics } from './diagnostics'
import { computeSemanticDiagnostics } from './semantic'

export interface CheckInput {
  path: string
  text: string
}

export interface CheckFinding {
  path: string
  /** 1-based, as a person and a terminal count. */
  line: number
  col: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  code: string
  message: string
}

const SEVERITY: Record<DiagnosticSeverity, CheckFinding['severity']> = {
  [DiagnosticSeverity.Error]: 'error',
  [DiagnosticSeverity.Warning]: 'warning',
  [DiagnosticSeverity.Information]: 'info',
  [DiagnosticSeverity.Hint]: 'hint',
}

// A diagnostic's message may be Markdown in newer protocol versions; a terminal prints its text.
const text = (message: Diagnostic['message']): string =>
  typeof message === 'string' ? message : message.value

/** Every finding for every file, in file order then position order. */
export function checkMildaFiles(files: readonly CheckInput[]): CheckFinding[] {
  const out: CheckFinding[] = []
  for (const file of files) {
    const siblings = files.filter((f) => f !== file).map((f) => f.text)
    const diagnostics: Diagnostic[] = [
      ...computeDiagnostics(file.text),
      ...computeSemanticDiagnostics(file.text, siblings),
    ]
    diagnostics.sort(
      (a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character,
    )
    for (const d of diagnostics) {
      out.push({
        path: file.path,
        line: d.range.start.line + 1,
        col: d.range.start.character + 1,
        severity: SEVERITY[d.severity ?? DiagnosticSeverity.Error],
        code: String(d.code ?? ''),
        message: text(d.message),
      })
    }
  }
  return out
}

// ─── Fragments ────────────────────────────────────────────────────────────────
// Prose about the language - a skill, a README, a spec, a docs page - quotes it in pieces: three
// lines of a `foundations` block, one part, the statements a lesson adds to a part it showed
// before. A piece is checked inside the scaffold that says where it goes, so a stale word in
// documentation fails the same way it would in a file. In Markdown the fence's info string names
// the scaffold: ```milda (a whole file or top-level statements), ```milda foundations, ```milda
// component (a component body), ```milda props, ```milda part (parts beside a root), ```milda
// part-body (statements of one part), ```milda rules (top-level rules) and ```milda rule-body.

export type FragmentWrap =
  'none' | 'foundations' | 'component' | 'props' | 'part' | 'part-body' | 'rules' | 'rule-body'
export const FRAGMENT_WRAPS: readonly FragmentWrap[] = [
  'none',
  'foundations',
  'component',
  'props',
  'part',
  'part-body',
  'rules',
  'rule-body',
]

// What the scaffolds declare, so a piece about one statement does not trip over a name another
// one leans on: the context groups a token aliases by, the props a part binds, the components a
// rule talks about.
const PROPS = `  props {
    label : string
    disabled : boolean = false
    invalid : boolean = false
    loading : boolean = false
    icon : string
  }
`
const RULE_SUBJECTS = ['Button', 'Badge', 'Card', 'Link', 'Tab', 'Tabs']
  .map(
    (name) =>
      `component ${name} {\n  props {\n    variant : enum(Primary, Secondary) = Primary\n  }\n}\n`,
  )
  .join('')

const SCAFFOLD: Record<FragmentWrap, [before: string, after: string]> = {
  none: ['', ''],
  foundations: [
    'context-group ColorScheme { Light Dark }\ncontext-group Density { Compact Comfortable }\nfoundations {\n',
    '\n}\n',
  ],
  component: ['component Demo {\n', '\n}\n'],
  props: [
    'context-group Variant { Primary Secondary }\ncomponent Demo {\n  props {\n',
    '\n  }\n}\n',
  ],
  part: [`component Demo {\n${PROPS}  part Demo: container {\n  }\n`, '\n}\n'],
  'part-body': [`component Demo {\n${PROPS}  part Demo: container {\n`, '\n  }\n}\n'],
  rules: [RULE_SUBJECTS, '\n'],
  'rule-body': [`${RULE_SUBJECTS}rule demo warning {\n`, '\n  because "a reason"\n}\n'],
}

/** A fenced ```milda block in Markdown, with the 1-based line its code starts on. */
export interface MildaFence {
  wrap: FragmentWrap
  code: string
  line: number
}

/** Every ```milda fence in a Markdown text. An unknown wrap word is reported as wrap `none`. */
export function mildaFences(markdown: string): MildaFence[] {
  const out: MildaFence[] = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})milda(?:\s+(\S+))?\s*$/.exec(lines[i]!)
    if (!open) continue
    const [, indent, fence, word] = open
    const body: string[] = []
    let j = i + 1
    for (; j < lines.length && !lines[j]!.trimStart().startsWith(fence!); j++) {
      body.push(lines[j]!.startsWith(indent!) ? lines[j]!.slice(indent!.length) : lines[j]!)
    }
    const wrap = (FRAGMENT_WRAPS as readonly string[]).includes(word ?? '')
      ? (word as FragmentWrap)
      : 'none'
    out.push({ wrap, code: body.join('\n'), line: i + 2 })
    i = j
  }
  return out
}

/**
 * The reader's findings for a piece, placed on the piece's own lines. Syntactic only: a piece
 * leans on tokens and components it does not declare, so semantic checks belong to whole files
 * (`checkMildaFiles`).
 */
export function checkMildaFragment(
  path: string,
  code: string,
  wrap: FragmentWrap,
  firstLine = 1,
): CheckFinding[] {
  const [before, after] = SCAFFOLD[wrap]
  const shift = before.split('\n').length - 1
  return computeDiagnostics(before + code + after).map((d) => {
    const line = d.range.start.line - shift
    return {
      path,
      // A finding in the scaffold itself (an unclosed brace in the piece) lands on its first line.
      line: firstLine + Math.max(0, line),
      col: d.range.start.character + 1,
      severity: SEVERITY[d.severity ?? DiagnosticSeverity.Error],
      code: String(d.code ?? ''),
      message: text(d.message),
    }
  })
}

/** `path:line:col severity code message` - the shape compilers print, so tools can jump to it. */
export function formatFinding(f: CheckFinding): string {
  return `${f.path}:${f.line}:${f.col} ${f.severity} ${f.code ? `[${f.code}] ` : ''}${f.message}`
}
