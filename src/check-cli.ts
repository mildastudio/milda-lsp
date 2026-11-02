#!/usr/bin/env node
// ─── Milda LSP - `milda-check` executable ─────────────────────────────────────
// `milda-check <file.milda | directory> ...` prints one line per finding and exits 1 when
// any is an error (or, with --strict, a warning). A directory contributes every `.milda`
// file in it, and all the files of one call are checked together, so references between
// them resolve. The work is in ./check; this file only reads arguments and the disk.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { checkMildaFiles, formatFinding, type CheckInput } from './check'

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const targets = args.filter((a) => !a.startsWith('--'))

if (targets.length === 0 || args.includes('--help')) {
  process.stdout.write(
    'usage: milda-check [--strict] <file.milda | directory> ...\n' +
      '  Prints path:line:col severity [code] message for every finding.\n' +
      '  Exits 1 on any error; with --strict, on any warning too.\n',
  )
  process.exit(targets.length === 0 ? 2 : 0)
}

const files: CheckInput[] = []
for (const target of targets) {
  const paths = statSync(target).isDirectory()
    ? readdirSync(target)
        .filter((n) => n.endsWith('.milda'))
        .sort()
        .map((n) => join(target, n))
    : [target]
  for (const path of paths) files.push({ path, text: readFileSync(path, 'utf8') })
}

const findings = checkMildaFiles(files)
for (const f of findings) process.stdout.write(formatFinding(f) + '\n')

const errors = findings.filter((f) => f.severity === 'error').length
const warnings = findings.filter((f) => f.severity === 'warning').length
process.stdout.write(
  `${files.length} file${files.length === 1 ? '' : 's'}: ${errors} error${errors === 1 ? '' : 's'}, ` +
    `${warnings} warning${warnings === 1 ? '' : 's'}\n`,
)
process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0)
