// ─── Milda highlight vocabulary — single source of truth ──────────────────────
// Shared by the LSP semantic-token classifier (./semantic-tokens.ts) AND
// code-generated into the JetBrains plugin's Kotlin lexer (MildaVocab.kt, via
// tools/gen-highlight.ts). Keeping the word sets here — and generating the Kotlin copy
// — means the two highlighters can never drift on which words are keywords / type
// words / color functions. (Tokenization LOGIC parity is enforced separately by the
// golden-corpus conformance test.)

export const KEYWORDS: readonly string[] = [
  'milda', 'prelude', 'meta', 'context-group', 'foundations', 'type', 'component',
  'archetype', 'props', 'events', 'uses', 'wire', 'gate', 'motion', 'requires',
  'part', 'realize', 'layout', 'state', 'when', 'present', 'slot', 'alias', 'by',
  'escape', 'from', 'bind', 'commit', 'drop', 'note', 'keyed-by', 'broadcast',
  'arena', 'as', 'on', 'true', 'false',
]

export const TYPE_WORDS: readonly string[] = [
  'string', 'number', 'boolean', 'enum', 'ref', 'array', 'union', 'context', 'object',
]

// First-class color-literal functions (also highlighted like types).
export const COLOR_FNS: readonly string[] = ['hex', 'srgb', 'rgb', 'p3', 'oklch', 'hsl']
