// ─── Milda highlight vocabulary - single source of truth ──────────────────────
// Shared by the LSP semantic-token classifier (./semantic-tokens.ts) AND
// code-generated into the JetBrains plugin's Kotlin lexer (MildaVocab.kt, via
// tools/gen-highlight.ts). Keeping the word sets here - and generating the Kotlin copy
// - means the two highlighters can never drift on which words are keywords / type
// words / color functions. (Tokenization LOGIC parity is enforced separately by the
// golden-corpus conformance test.)

// Every word the grammar gives a fixed meaning to at a statement position. A word is
// left OUT when it is also a plausible author-chosen name, because colouring someone's
// part or context as a keyword reads worse than leaving one syntax word plain - that is
// why `content` (cf. `part content`) is absent while its neighbour `of` is present.
export const KEYWORDS: readonly string[] = [
  'milda',
  'prelude',
  'meta',
  'context-group',
  'foundations',
  'token',
  'type',
  'global-prop',
  'component',
  // How the system is used (proposal 0052). Left OUT on the rule above: `min`, `max`, `only`,
  // `tokens`, `for`, `error`, `warning` and `exclusive`, every one a plausible prop or part name
  // (the Form archetype has an `error` part). The words kept are the ones nobody names a thing.
  'rule',
  'because',
  'required',
  'one-of',
  'any-of',
  'within',
  'where',
  'never',
  'prefer',
  'archetype',
  'props',
  'events',
  'uses',
  'wire',
  'gate',
  'motion',
  'requires',
  'part',
  'realize',
  'layout',
  'state',
  'when',
  'present',
  'slot',
  'alias',
  'by',
  'raw',
  'escape',
  'from',
  'bind',
  'commit',
  'drop',
  'note',
  'keyed-by',
  'broadcast',
  'arena',
  'as',
  'on',
  'of',
  'active',
  'default',
  'single',
  'optional',
  'many',
  'true',
  'false',
  'pill',
  // v0.3 (proposal 0041) - the statements that say what a part IS, and the library around the
  // components. The rule above does most of the deciding here, and it excludes a lot: the
  // highlighter is a word list, not a parser, so a word colours wherever it appears. `kind`,
  // `content`, `value`, `group`, `media`, `source`, `alt`, `cell`, `origin`, `action`, `role`,
  // `page`, `site`, `footer`, `link`, `folder`, `in`, `under`, `set`, `toggle`, `static` and
  // `sample` are all plausible names for someone's prop, part or token, and colouring one of
  // those as a keyword reads worse than leaving a syntax word plain. `duration` and `easing`
  // are excluded for a sharper reason: they are token TYPES, already coloured as such.
  'emits',
  'a11y',
  'labelled-by',
  'described-by',
  'payload',
  'signal',
  'locked',
  'repeat',
  'instance',
  'behavior',
  'behaviour',
  'foreign',
  'transition',
  'presentation',
  'destination',
  'example',
  'demo',
  'docs',
  'assets',
  'icons',
  'copyright',
  'anchor',
  'otherwise',
]

export const TYPE_WORDS: readonly string[] = [
  'string',
  'number',
  'boolean',
  'enum',
  'ref',
  'array',
  'union',
  'context',
  'object',
]

// First-class color-literal functions (also highlighted like types). `rgba`/`hsla` are the CSS
// spellings of `rgb`/`hsl`, which the reader accepts; they are here so a highlighter treats
// their payload as a value too (./value-authoring.test.ts pins this list against the parser's).
export const COLOR_FNS: readonly string[] = [
  'hex',
  'srgb',
  'rgb',
  'p3',
  'oklch',
  'hsl',
  'rgba',
  'hsla',
]

// First-class length-literal functions (0038). `scaled(n)` is the canonical spelling for
// a text-relative length; the `rem`/`sp` suffixes are read but never written.
export const LENGTH_FNS: readonly string[] = ['scaled']

// The keywords whose next word is a name THIS FILE declares, so it can be coloured as one:
// a reader should be able to see at a glance which names are the language's and which are
// the author's. Only keywords where that is unambiguous are here - `group` is out because
// `group radio` inside a part is a realization value, not a name, and `example "…"` takes a
// string. (Context members - the bare words inside a `context-group` block - are declarations
// too, but nothing in a single line says so, and this is a lexical classifier.)
export const DECLARATION_KEYWORDS: readonly string[] = [
  'token',
  'component',
  'type',
  'global-prop',
  'rule',
  'context-group',
  'part',
  'layer',
]
