// ─── Milda LSP - completion ───────────────────────────────────────────────────
// Suggestions are scoped to the cursor's position IN THE LANGUAGE, not to the whole
// document: the open-block chain and the already-typed atoms of the current statement
// (./context) decide which vocabulary is legal here. So `foundations { ▐ }` offers
// `token` and nothing else - never `foundations` or `component`, which cannot appear
// there - and `token space/2 : ▐` offers token types.
//
// Vocabulary comes from the language itself: the prelude (archetypes, states, atoms,
// capabilities) and the parser's own surface word sets (facet names, layout keys, token
// types - @mildastudio/milda exports them), so a suggestion can never be something the
// parser would reject. Names declared in the document (tokens, types, context groups)
// come from the span table.

import { requiredPartCompletions } from './required-parts'
import {
  ASSET_BASE_KEYS,
  ASSET_FIELD_KEYS,
  ASSET_KINDS,
  atomsByName,
  BEHAVIOR_FIELDS,
  BEHAVIOR_KINDS,
  camelField,
  CELL_MODIFIERS,
  COLOR_LITERAL_FNS,
  COLOR_TOKEN_TYPE_NAMES,
  CONTROL_REALIZATIONS,
  DEMO_ACTION_OPS,
  DOC_BLOCK_KEYWORDS,
  DOCS_FOOTER_KEYWORDS,
  DOCS_KEYWORDS,
  DOCS_SITE_KEYS,
  EXAMPLE_KEYWORDS,
  FACET_NAMES,
  GROUP_REALIZATIONS,
  INTERACTION_KINDS,
  kebabField,
  LAYOUT_KEYS,
  LAYOUT_VALUES,
  LENGTH_LITERAL_FNS,
  LENGTH_TOKEN_TYPE_NAMES,
  MEDIA_TYPES,
  NODE_KINDS,
  NODE_ORIGINS,
  PART_CONFIGS,
  PART_KEYWORDS,
  PRESENTATION_KINDS,
  preludeV0,
  SLOT_ARITIES,
  SLOT_MODIFIERS,
  SLOT_ROLES,
  STATE_NAMES,
  TOKEN_TYPE_NAMES,
  TOKEN_TYPES_BY_NAME,
  TOKEN_VALUE_KINDS,
  tokenTypeFamily,
  VALUE_LITERAL_FNS,
  type NodeSpan,
} from '@mildastudio/milda'
import {
  type CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  type Position,
} from 'vscode-languageserver-types'
import { parse } from './analysis'
import { ARROW_ATOM, cursorContext, type CursorContext } from './context'
import { TYPE_WORDS } from './vocab'

// Keywords, grouped by the block that admits them (grammar: `cmember`, `pstmt`, `topdecl`).
// The part statements come from the PARSER's own list (proposal 0041): completion offering a
// word the reader rejects - or, as here, failing to offer twenty-six words it accepts - is the
// same drift the format's own defects came from, so there is one list.
const TOP_KEYWORDS = [
  'milda',
  'prelude',
  'meta',
  'context-group',
  'foundations',
  'type',
  // A prop the whole system declares once, taken by reference (0051 §5).
  'global-prop',
  'component',
  // How the system is meant to be put together (0052 §5).
  'rule',
  // v0.3 (0041) - the library around the components.
  'group',
  'example',
  'docs',
  'assets',
  // The icon library - the sets a bare glyph name resolves against, and the curated glyphs.
  'icons',
]
const COMPONENT_KEYWORDS = [
  'archetype',
  'meta',
  'props',
  'events',
  'uses',
  'wire',
  'gate',
  'part',
  'realize',
  'requires',
  'motion',
  'group',
]
const REALIZE_KEYWORDS = ['drop', 'wire', 'present']
// The statement keywords of a `rule` block (0052 §5.3): every statement opens with one of them.
const RULE_KEYWORDS = ['max', 'min', 'never', 'only', 'tokens', 'prefer', 'because']
// What a props block may say besides a prop (0052 §4, 0051 §5).
const PROPS_KEYWORDS = ['one-of', 'any-of', 'exclusive', 'global']

// The value vocabulary of a part statement, keyed by the keyword that precedes it. Only the
// CLOSED sets are here: a statement whose argument is an author-chosen name (`bind value <prop>`)
// has no vocabulary to offer, and guessing one would be worse than offering nothing.
const PART_STATEMENT_VALUES: Record<string, readonly string[]> = {
  kind: NODE_KINDS,
  origin: NODE_ORIGINS,
  control: CONTROL_REALIZATIONS,
  group: GROUP_REALIZATIONS,
  presentation: PRESENTATION_KINDS,
  media: MEDIA_TYPES,
  cell: CELL_MODIFIERS,
  bind: ['value', 'state'],
  source: ['bind', 'static'],
  behavior: BEHAVIOR_KINDS,
  behaviour: BEHAVIOR_KINDS,
  content: ['bind'],
  alt: ['bind'],
  destination: ['bind'],
  repeat: ['static'],
  action: INTERACTION_KINDS,
  present: ['when'],
  // The single-valued config surfaces (`severity danger`).
  ...Object.fromEntries(
    Object.entries(PART_CONFIGS)
      .filter(([, spec]) => spec.single)
      .map(([name, spec]) => [
        name,
        (spec.fields.value as { values?: readonly string[] })?.values ?? [],
      ]),
  ),
}

const FACETS = new Set<string>(FACET_NAMES)
const CONTENT_SPECS = ['content', 'ref']

// ─── statement scaffolds ──────────────────────────────────────────────────────
// The SHAPE of a statement, for a client that can walk an author through one. Everything in
// this language is `keyword name { … }` with small variations, and typing the braces, the
// quotes and the name by hand is both the boring part and where the shape goes wrong.
//
// Keyed by the keyword, and only ever applied at the HEAD of a statement (see
// `computeCompletions`), so a word that means something else as an argument is unaffected.
// Every entry is expanded and run through the real parser in ./statement-scaffolds.test.ts:
// a scaffold the reader would complain about is worse than no scaffold.
export const STATEMENT_SNIPPETS: Readonly<Record<string, string>> = {
  // The document's own declarations.
  'context-group': 'context-group ${1:Name} {\n\t$0\n}',
  foundations: 'foundations {\n\t$0\n}',
  meta: 'meta {\n\t$0\n}',
  type: 'type ${1:Name} = $0',
  // No `= default` in the scaffold: a global prop with no default means "inherit the ambient
  // value", which is a real and common choice, and a scaffold has to expand to something the
  // reader accepts on its own.
  'global-prop': 'global-prop ${1:name} : ${2:Type}$0',
  component: 'component ${1:Name} "${2:what it is for}" {\n\t$0\n}',
  // The reason is part of the shape, not an afterthought: a rule without one is an error.
  rule: 'rule ${1:id} ${2|error,warning|} {\n\t${3:never Child within Parent}\n\tbecause "${4:why it matters}"\n}',
  group: 'group ${1:path} "${2:what belongs here}"',
  example: 'example "${1:name}" for ${2:Component} {\n\t$0\n}',
  docs: 'docs {\n\t$0\n}',
  assets: 'assets {\n\t$0\n}',
  // A component's members.
  props: 'props {\n\t$0\n}',
  events: 'events {\n\t$0\n}',
  // The kind is part of the shape: a saved file states what every part IS (0055).
  part: `part \${1:name}: \${2|${NODE_KINDS.join(',')}|} {\n\t$0\n}`,
  realize: 'realize ${1:target} {\n\t$0\n}',
  // A part's own blocks.
  layout: 'layout { stack ${1:row}; gap ${2:space.2} }',
  state: 'state ${1:hovered} {\n\t$0\n}',
  when: 'when ${1:condition} {\n\t$0\n}',
  a11y: 'a11y {\n\t$0\n}',
  emits: 'emits {\n\t$0\n}',
  behavior: 'behavior ${1:focus-trap} {\n\t$0\n}',
  behaviour: 'behaviour ${1:focus-trap} {\n\t$0\n}',
  instance: 'instance ${1:Component} {\n\t$0\n}',
  // Inside a type expression, and inside an example.
  object: 'object {\n\t$0\n}',
  demo: 'demo {\n\t$0\n}',
  // The docs overlay.
  site: 'site {\n\t$0\n}',
  footer: 'footer {\n\t$0\n}',
  page: 'page "${1:Title}" {\n\t$0\n}',
}

/** What the client can do with a suggestion. `snippets` = it understands tab stops and
 *  choice placeholders (`${1:name}`, `${2|color,spacing|}`), which is what lets one
 *  suggestion carry a whole declaration and then walk the author through its parts. */
export interface CompletionCapabilities {
  snippets?: boolean
}

export function computeCompletions(
  text: string,
  position: Position,
  caps: CompletionCapabilities = {},
): CompletionItem[] {
  const { document, spans } = parse(text)
  const ctx = cursorContext(text, position)
  // The tokens this file declares, by the dotted path a reference uses, with their TYPE - so a
  // slot can be offered the values that would actually fit it.
  const tokens = new Map<string, string>(
    document.foundations.layers.flatMap((layer) =>
      layer.tokens.map((t) => [t.name.replace(/\//g, '.'), String(t.type)] as const),
    ),
  )
  const snippets = caps.snippets === true
  const items = suggest(ctx, spans, snippets, tokens)
  // Inside a component, the parts its archetype requires and the file does not have yet come
  // first: they are the lines the reader would otherwise add on the author's behalf (0055).
  if (ctx.scope === 'component' && ctx.statement.length === 0)
    items.unshift(...requiredPartCompletions(text, position, snippets))
  // At the head of a statement, a keyword that has a known SHAPE arrives as that shape. Applied
  // here, once, rather than at each of the twenty places a keyword list is built - and only
  // where the keyword really is a statement head, which is the only place a scaffold is right.
  if (!snippets || ctx.statement.length > 0) return items
  return items.map((entry) => {
    const shape = STATEMENT_SNIPPETS[entry.label]
    if (!shape || entry.insertText !== undefined) return entry
    return { ...entry, insertTextFormat: InsertTextFormat.Snippet, insertText: shape }
  })
}

function suggest(
  ctx: CursorContext,
  spans: NodeSpan[],
  snippets: boolean,
  tokens: Map<string, string>,
): CompletionItem[] {
  const { scope, statement, prev } = ctx
  const fresh = statement.length === 0 // at the start of a statement

  switch (scope) {
    // ── document root ──────────────────────────────────────────────────────────
    case '':
      // Only at the head of a statement: `component ▐` wants a name, not a keyword.
      return fresh ? keywords(TOP_KEYWORDS) : []

    // ── foundations { token PATH : TYPE = VALUE } ───────────────────────────────
    case 'foundations': {
      // One suggestion carries the whole declaration and then walks the author through it:
      // name, then the type (offered as a list at that stop), then the value. Typing the
      // shape out by hand is where the `:` gets left out and the line stops being a token.
      if (fresh) return [tokenDecl(snippets)]
      if (prev === ':')
        return words(TOKEN_TYPE_NAMES, CompletionItemKind.TypeParameter, 'token type')
      // `token brand ▐` - what follows a name is its type, so offer the types here too, with
      // the `:` that introduces them: a type chosen this way cannot leave the line without
      // its separator, which is the one way to write a token the reader then misreads.
      if (statement.length === 2 && statement[0] === 'token') {
        return TOKEN_TYPE_NAMES.map((t) => ({
          ...item(t, CompletionItemKind.TypeParameter, 'token type'),
          insertText: `: ${t}`,
        }))
      }
      // After `=` (and after an explicit `raw`) the literal forms the DECLARED TYPE admits,
      // pre-filled with in-range channels, ahead of the three value kinds. A colour token
      // is written `= hex(…)` far more often than `= raw …`, so the literals come first.
      if (prev === '=') {
        return [
          ...valueLiterals(declaredType(statement), snippets),
          ...valueKinds(spans, snippets, declaredType(statement)),
        ]
      }
      if (prev === 'raw') return valueLiterals(declaredType(statement), snippets)
      if (prev === 'alias') return keywords(['by'])
      if (prev === 'by') return declared(spans, 'contextGroup', CompletionItemKind.Enum)
      return []
    }

    // ── alias by GROUP { ctx -> token/2 } (token value or prop default) ────────
    case 'alias': {
      // What an alias line needs is the context, the arrow, and a value of the right kind, and
      // the editor used to help with none of the three. Now: every context of THIS group, each
      // carrying its own arrow (the line is `Ctx -> value`, so the arrow is not a decision), and
      // then the values that fit the token's declared type.
      const type = declaredType(ctx.blockStatement)
      if (fresh) {
        const own = contextsOf(spans, aliasGroup(ctx))
        const contexts =
          own.length > 0 ? own : declared(spans, 'context', CompletionItemKind.EnumMember)
        return [
          ...contexts.map((c) => ({ ...c, insertText: `${c.label} -> ` })),
          {
            ...item('default', CompletionItemKind.Keyword, 'for every other context'),
            insertText: 'default -> ',
          },
        ]
      }
      // The token being declared is excluded: an alias to itself is a cycle, not a value.
      if (prev === ARROW_ATOM) {
        return aliasValues(
          type,
          tokens,
          snippets,
          (ctx.blockStatement[1] ?? '').replace(/\//g, '.'),
        )
      }
      return []
    }

    // ── component { … } ────────────────────────────────────────────────────────
    case 'component': {
      if (fresh) return keywords(COMPONENT_KEYWORDS)
      if (statement[0] === 'part') return partHeader(statement, prev)
      if (prev === 'archetype') {
        return preludeV0.archetypes.map((a) => item(a.name, CompletionItemKind.Class, a.contract))
      }
      if (prev === 'uses') {
        return Object.values(atomsByName).map((a) => item(a.name, CompletionItemKind.Module, a.doc))
      }
      if (prev === 'requires') {
        return preludeV0.capabilities.map((c) => item(c.name, CompletionItemKind.Property, c.note))
      }
      return []
    }

    // ── props { name : TYPE = default } ─────────────────────────────────────────
    case 'props': {
      // `global ▐` - a reference to a prop the system declares once (0051 §5), so what follows is
      // the registry, not a type.
      if (prev === 'global' || (prev === ',' && statement[0] === 'global')) {
        return declared(spans, 'globalProp', CompletionItemKind.Property)
      }
      // At the head of a line the author is naming a prop - or stating a constraint over some.
      if (fresh) return keywords(PROPS_KEYWORDS)
      // `one-of ▐` / `one-of a, ▐` - the props of this block.
      if (
        ['one-of', 'any-of', 'exclusive'].includes(statement[0] ?? '') &&
        (prev === statement[0] || prev === ',')
      )
        return declared(spans, 'prop', CompletionItemKind.Property)
      if (prev === 'required') return keywords(['when'])
      if (prev === 'ref') return declared(spans, 'sharedType', CompletionItemKind.Interface)
      if (prev === 'context') return declared(spans, 'contextGroup', CompletionItemKind.Enum)
      // A default: the members of the prop's own context group when it has one, since
      // `size : Size = ▐` can only be one of Size's contexts (or a context-aliased default).
      if (prev === '=')
        return [...contextsOf(spans, propType(statement)), ...keywords(['true', 'false', 'alias'])]
      if (prev === ':') return typeExpr(spans)
      // `size ▐` - what follows a name is its type, offered with the `:` that introduces it,
      // exactly as a token declaration does. A type picked from the list cannot land on the
      // line without the separator the reader requires.
      if (statement.length === 1) return withColon(typeExpr(spans))
      return keywords(['required', 'bind'])
    }

    // ── rule id severity { statement · because "…" } (0052 §5) ──────────────────
    case 'rule': {
      if (fresh) return keywords(RULE_KEYWORDS)
      const head = statement[0] ?? ''
      if (prev === 'archetype' || (head === 'prefer' && prev === ',')) {
        return preludeV0.archetypes.map((a) => item(a.name, CompletionItemKind.Class, a.contract))
      }
      if (head === 'tokens') {
        return prev === 'tokens' || prev === ','
          ? words(TOKEN_TYPE_NAMES, CompletionItemKind.TypeParameter, 'token type')
          : []
      }
      if (head === 'prefer') {
        if (prev === 'prefer') return declared(spans, 'component', CompletionItemKind.Class)
        return prev === 'for' ? keywords(['archetype']) : keywords(['for'])
      }
      if (head === 'because') return []
      // A subject: a component, or `archetype` for a prelude archetype.
      const subjectHere =
        prev === 'never' ||
        prev === 'only' ||
        prev === 'within' ||
        prev === ',' ||
        ((head === 'max' || head === 'min') && /^\d+$/.test(prev))
      if (subjectHere)
        return [
          ...declared(spans, 'component', CompletionItemKind.Class),
          ...keywords(['archetype']),
        ]
      if (prev === 'max' || prev === 'min') return []
      return keywords(['where', 'within'])
    }

    // ── events { name from Machine.event } ─────────────────────────────────────
    case 'events':
      return statement.length === 1 ? keywords(['from']) : []

    // ── type X = object { field : TYPE } ──────────────────────────────────────
    case 'object':
      if (prev === ':') return typeExpr(spans)
      if (prev === 'ref') return declared(spans, 'sharedType', CompletionItemKind.Interface)
      return []

    // ── part { what it IS · how it is painted } ────────────────────────────────
    case 'part': {
      if (fresh) return [...keywords(PART_KEYWORDS), ...facetItems()]
      // A UI state: `state ▐`, `bind state ▐`, `when state ▐`, and `ancestor <part> ▐`.
      if (prev === 'state' || statement[statement.length - 2] === 'ancestor') return stateItems()
      if (prev === 'slot') return [...keywords(SLOT_ARITIES), ...keywords(SLOT_MODIFIERS)]
      if (SLOT_ARITIES.includes(prev)) return keywords(SLOT_MODIFIERS)
      if (prev === 'of') return keywords(CONTENT_SPECS)
      if (prev === 'role') return keywords(SLOT_ROLES)
      if (prev === 'sample') return keywords(['example'])
      if (statement[0] === 'action' && statement.length === 2) return keywords(DEMO_ACTION_OPS)
      if (statement[0] === 'emits' || statement[0] === 'motion') return []
      const values = PART_STATEMENT_VALUES[prev]
      if (values) return words(values, CompletionItemKind.EnumMember, prev)
      return facetValues(prev, spans)
    }

    // ── emits { <event> on <interaction> payload … } ───────────────────────────
    case 'emits':
      if (prev === 'on')
        return words(INTERACTION_KINDS, CompletionItemKind.EnumMember, 'interaction')
      if (prev === 'payload') return keywords(['bind'])
      // After the event name: what may follow it.
      return statement.length >= 1 ? keywords(['on', 'payload', 'signal', 'locked']) : []

    // ── a11y { name … · labelled-by <part> · described-by <part> } ─────────────
    case 'a11y':
      if (fresh) return keywords(['name', 'labelled-by', 'described-by'])
      if (prev === 'name') return keywords(['bind'])
      return partPaths(spans)

    // ── motion { transition <facets> duration <tok> … } ────────────────────────
    case 'motion': {
      if (fresh) return keywords(['transition'])
      if (prev === 'duration' || prev === 'easing' || prev === 'delay') return tokenRefs(spans)
      // The leading words of a transition are the facets it animates.
      return [...facetItems(), ...keywords(['duration', 'easing', 'delay'])]
    }

    // ── content { default … · when <pred> -> … } ───────────────────────────────
    case 'content':
      if (fresh) return keywords(['default', 'when', 'otherwise'])
      if (prev === 'default' || prev === 'otherwise' || prev === ARROW_ATOM)
        return keywords(['bind'])
      return []

    // ── instance Component { prop = value } ───────────────────────────────────
    case 'instance':
      return prev === '=' ? keywords(['bind', 'true', 'false']) : []

    // ── behavior <kind> { field value } · a per-archetype config block ─────────
    case 'behavior':
    case 'behaviour':
      return flatBlockKeys(BEHAVIOR_FIELDS[camelField(statementHead(ctx, 1))] ?? {}, prev, spans)

    // ── a per-archetype config block (`calendar { … }`, `tabs { … }`, …) ────────
    case 'calendar':
    case 'time-picker':
    case 'tabs':
    case 'slider':
    case 'rating':
    case 'color-picker':
    case 'overlay': {
      const spec = PART_CONFIGS[scope]
      if (!spec) return []
      if (fresh)
        return words(Object.keys(spec.fields).map(kebabField), CompletionItemKind.Field, scope)
      const field = spec.fields[camelField(prev)]
      if (!field) return []
      if (field.kind === 'boolean') return keywords(['true', 'false'])
      if (field.kind === 'enum' || field.kind === 'enums') {
        return words(field.values, CompletionItemKind.EnumMember, prev)
      }
      return []
    }

    // ── demo { var : TYPE = initial } inside an example ────────────────────────
    case 'demo':
      if (prev === ':') return typeExpr(spans)
      return statement.length === 1 ? withColon(typeExpr(spans)) : []

    // ── example "…" for Component { demo · part } ──────────────────────────────
    case 'example':
      if (statement[0] === 'part') return partHeader(statement, prev)
      return fresh ? keywords(EXAMPLE_KEYWORDS) : []

    // ── docs { site · footer · page } ──────────────────────────────────────────
    case 'docs':
      return fresh ? keywords(DOCS_KEYWORDS) : []

    case 'site':
      return fresh ? words(DOCS_SITE_KEYS, CompletionItemKind.Field, 'docs site') : []

    case 'footer':
      return fresh ? keywords(DOCS_FOOTER_KEYWORDS) : []

    // ── page "…" { heading · component · tokens · … } ──────────────────────────
    case 'page': {
      if (fresh) return words(DOC_BLOCK_KEYWORDS, CompletionItemKind.Field, 'doc block')
      const head = statement[0] ?? ''
      if (head === 'tokens' || head === 'swatch') {
        return words(TOKEN_TYPE_NAMES, CompletionItemKind.TypeParameter, 'token type')
      }
      if (head === 'component-group')
        return declared(spans, 'contextGroup', CompletionItemKind.Enum)
      if (head.startsWith('component'))
        return declared(spans, 'component', CompletionItemKind.Class)
      if (statement.length >= 2) return keywords(['anchor'])
      return []
    }

    // ── assets { folder … · svg "name" in … { … } } ────────────────────────────
    case 'assets': {
      if (fresh)
        return [...keywords(['folder']), ...words(ASSET_KINDS, CompletionItemKind.Class, 'asset')]
      if (ASSET_KINDS.includes(statement[0] ?? '')) return keywords(['in'])
      return []
    }

    // ── icons { set <prefix> "Name" { … } · glyph <prefix> <name> { … } · custom "Name" { … } }
    case 'icons': {
      if (fresh) return keywords(['set', 'glyph', 'custom'])
      return []
    }

    // Each icon statement's own block: the keys the reader knows, and no others (it reports and
    // drops anything else).
    case 'set':
      return fresh
        ? words(['provider', 'license', 'samples'], CompletionItemKind.Field, 'icon set')
        : []
    case 'glyph':
      return fresh ? words(['label', 'svg'], CompletionItemKind.Field, 'glyph') : []
    case 'custom':
      return fresh ? words(['asset', 'label'], CompletionItemKind.Field, 'custom glyph') : []

    // An asset's own block: the base keys every asset has, plus its per-kind metadata. `url`
    // and `data` are the two shapes the bytes can take (0041 §1.2).
    case 'svg':
    case 'font':
    case 'image':
    case 'video':
    case 'animation': {
      if (!fresh) return prev === 'tags' ? [] : []
      const kind = statementHead(ctx, 0)
      return [
        ...words(ASSET_BASE_KEYS, CompletionItemKind.Field, 'asset'),
        ...words(ASSET_FIELD_KEYS[kind] ?? [], CompletionItemKind.Field, kind),
      ]
    }

    // ── state ‹s› { … } · when ‹cond› { … } - facets plus a nested layout ──────
    case 'state':
    case 'when':
      if (fresh) return [...keywords(['layout']), ...facetItems()]
      return facetValues(prev, spans)

    // ── layout { stack row · gap space.2 · … } ─────────────────────────────────
    case 'layout': {
      if (fresh) return words(LAYOUT_KEYS, CompletionItemKind.Field, 'layout')
      const values = LAYOUT_VALUES[prev]
      if (values) return words(values, CompletionItemKind.EnumMember, prev)
      if (prev === 'gap' || prev === 'inset') return tokenRefs(spans)
      return []
    }

    // ── realize ‹target› { … } ────────────────────────────────────────────────
    case 'realize':
      if (fresh) return [...keywords(REALIZE_KEYWORDS), ...facetItems()]
      return facetValues(prev, spans)

    // Blocks whose bodies are author-chosen names, not vocabulary.
    case 'context-group':
    case 'meta':
    case 'token': // a structured token value: `= { … }`
      return []

    // A realization sub-block (`presentation popover { … }`) - facet paint.
    default:
      return fresh ? facetItems() : facetValues(prev, spans)
  }
}

// ─── vocabulary helpers ───────────────────────────────────────────────────────

/** Every UI state the reader accepts. The words are the vocabulary's `STATE_NAMES`; the prelude's
 *  taxonomy is total over them, so it supplies each one's source as the detail. */
function stateItems(): CompletionItem[] {
  const from = new Map(preludeV0.states.map((s) => [s.name as string, s.from]))
  return STATE_NAMES.map((name) =>
    item(name, CompletionItemKind.EnumMember, `from ${from.get(name)}`),
  )
}

/** Inside an asset or config/behaviour block: the keys it accepts, then nothing. A `node`-valued
 *  field takes a part PATH, which is the one place a block body offers document names. */
function flatBlockKeys(
  fields: Readonly<Record<string, string>>,
  prev: string,
  spans: NodeSpan[],
): CompletionItem[] {
  const kinds = Object.fromEntries(Object.entries(fields).map(([f, t]) => [kebabField(f), t]))
  const type = kinds[prev]
  if (type === 'node' || type === 'nodes') return partPaths(spans)
  if (type === 'boolean') return keywords(['true', 'false'])
  if (type) return []
  return words(Object.keys(kinds), CompletionItemKind.Field, 'setting')
}

/** The part paths declared in this document - how the surface addresses a node (0041). */
function partPaths(spans: NodeSpan[]): CompletionItem[] {
  return spans
    .filter((s) => s.kind === 'part')
    .map((s) => item(s.name, CompletionItemKind.Reference, 'part'))
}

/** The `n`th atom of the statement that OPENED the current block (a behaviour's kind, an
 *  asset's kind): the block body's vocabulary depends on it. */
function statementHead(ctx: CursorContext, n: number): string {
  return ctx.blockStatement[n] ?? ''
}

/** After a facet name, the value is a token ref; anything else has no vocabulary. */
function facetValues(prev: string, spans: NodeSpan[]): CompletionItem[] {
  return FACETS.has(prev) ? tokenRefs(spans) : []
}

function facetItems(): CompletionItem[] {
  const covers = new Map<string, string>(preludeV0.facets.map((f) => [f.name as string, f.covers]))
  return FACET_NAMES.map((name) =>
    // Prelude facet names are the AST spelling (`textClamp`); the surface uses `text.clamp`.
    // An edge form (`inset.inline-start`, `border.top`) says what its base facet says.
    item(
      name,
      CompletionItemKind.Field,
      covers.get(name) ?? covers.get(camel(name)) ?? covers.get(name.split('.')[0]!),
    ),
  )
}

/** Token refs are offered in the dotted form a facet value takes (`space.2`). */
function tokenRefs(spans: NodeSpan[]): CompletionItem[] {
  return spans
    .filter((s) => s.kind === 'token')
    .map((s) => item(s.name.replace(/\//g, '.'), CompletionItemKind.Value, `token ${s.name}`))
}

/** Everywhere a type is expected: the built-in type words plus this document's own. The
 *  built-ins are the highlighter's TYPE_WORDS - the grammar's `typeexpr` heads are exactly
 *  the words coloured as types, and one list is better than two that must agree. */
function typeExpr(spans: NodeSpan[]): CompletionItem[] {
  return [
    ...keywords(TYPE_WORDS),
    ...declared(spans, 'sharedType', CompletionItemKind.Interface),
    ...declared(spans, 'contextGroup', CompletionItemKind.Enum),
  ]
}

function declared(
  spans: NodeSpan[],
  kind: NodeSpan['kind'],
  itemKind: CompletionItemKind,
): CompletionItem[] {
  return spans.filter((s) => s.kind === kind).map((s) => item(s.name, itemKind))
}

/** The members of the named context group - nothing when `name` isn't one. */
function contextsOf(spans: NodeSpan[], name: string): CompletionItem[] {
  const group = spans.find((s) => s.kind === 'contextGroup' && s.name === name)
  if (!group) return []
  return spans
    .filter((s) => s.kind === 'context' && s.parentId === group.id)
    .map((s) => item(s.name, CompletionItemKind.EnumMember, `context ${name}`))
}

// ─── value literals ──────────────────────────────────────────────────────────
// Which literal functions belong on which token type comes from the parser's own type map
// (`COLOR_TOKEN_TYPE_NAMES` / `LENGTH_TOKEN_TYPE_NAMES`), not from a list kept here: `ring`
// and `backdrop` are colour types too, and every hand-written "the colour types" set forgot
// them.
const COLOR_TYPES = new Set<string>(COLOR_TOKEN_TYPE_NAMES)
const LENGTH_TYPES = new Set<string>(LENGTH_TOKEN_TYPE_NAMES)

/** The literal forms a token of this declared type can be given, pre-filled. A colour space that
 *  takes an alpha channel is offered twice: opaque, and with the alpha written out. The
 *  translucent form is a `/ A` an author has to know about otherwise, and "how do I make this
 *  half-transparent" is exactly the question a list of function names does not answer. */
function valueLiterals(type: string | null, snippets: boolean): CompletionItem[] {
  if (type == null) return []
  const fns = COLOR_TYPES.has(type)
    ? COLOR_LITERAL_FNS
    : LENGTH_TYPES.has(type)
      ? LENGTH_LITERAL_FNS
      : []
  const items = fns.flatMap((fn, i) =>
    VALUE_LITERAL_FNS[fn]?.alpha === true
      ? [literalItem(fn, snippets, i), literalItem(fn, snippets, i, true)]
      : [literalItem(fn, snippets, i)],
  )
  // `pill` is a radius intent rather than a measurement (0038), so it belongs to exactly
  // one type - the parser rejects it on any other.
  if (type === 'radius') {
    items.push({
      ...item('pill', CompletionItemKind.Constant, 'fully rounded'),
      sortText: `0${fns.length}`,
    })
  }
  return items
}

/** The right-hand side of an alias line: the tokens whose type would FIT this slot (a colour
 *  token cannot hold a radius - that is an error the reader reports, so the editor should not
 *  offer it), then the literal forms, since a slot may hold a value outright. */
function aliasValues(
  type: string | null,
  tokens: Map<string, string>,
  snippets: boolean,
  own: string,
): CompletionItem[] {
  const want = type ? tokenTypeFamily(TOKEN_TYPES_BY_NAME[type] ?? type) : null
  const refs = [...tokens.entries()]
    .filter(
      ([path, tokenType]) => path !== own && (want == null || tokenTypeFamily(tokenType) === want),
    )
    .map(([path, tokenType]) => item(path, CompletionItemKind.Value, `${tokenType} token`))
  return [...refs, ...valueLiterals(type, snippets)]
}

/** `oklch` → an `oklch(0.62 0.19 256)` the author can then adjust, with the channels as tab
 *  stops. A function name alone answers "which spaces are there?" but not "what do I write
 *  in it?", which is the question the author actually has at that point. */
function literalItem(
  fn: string,
  snippets: boolean,
  order: number,
  withAlpha = false,
): CompletionItem {
  const spec = VALUE_LITERAL_FNS[fn]
  const channels = spec?.channels ?? []
  const args = channels.map((c) => c.name).join(' ')
  const out: CompletionItem = {
    // The label keeps the function's name first so it still filters on what is being typed;
    // what follows says which of the two forms this is.
    label: withAlpha ? `${fn} / A` : fn,
    kind: CompletionItemKind.Function,
    detail: withAlpha ? `${fn}(${args} / A)` : `${fn}(${args})`,
    documentation: [
      spec?.doc,
      ...channels.map((c) => `${c.name} - ${c.hint}`),
      ...(withAlpha ? ['A - alpha, 0..1 or a percentage'] : []),
    ]
      .filter(Boolean)
      .join('\n'),
    // Literals sort above `raw`/`alias`/`escape`, in the table's order, translucent after opaque.
    sortText: `0${order}${withAlpha ? 'b' : 'a'}`,
  }
  if (!snippets) return { ...out, insertText: `${fn}(` }
  const stops = channels.map((c, i) => `\${${i + 1}:${c.sample}}`)
  if (withAlpha) stops.push(`/ \${${channels.length + 1}:50%}`)
  return {
    ...out,
    insertTextFormat: InsertTextFormat.Snippet,
    insertText: `${fn}(${stops.join(' ')})$0`,
  }
}

/** `token ▐` → the whole declaration. The type stop is a CHOICE, so the list of token types
 *  opens there by itself - the client walks the author from name to type to value. */
function tokenDecl(snippets: boolean): CompletionItem {
  const base = item('token', CompletionItemKind.Keyword, 'token PATH : TYPE = VALUE')
  if (!snippets) return base
  return {
    ...base,
    insertTextFormat: InsertTextFormat.Snippet,
    // The caret lands right AFTER the `=`, with no space: the space is the author's next
    // keystroke, it is a completion trigger, and by then the type is known - so the list that
    // opens is that type's own literals rather than a generic one. (A choice placeholder cannot
    // do this: its options are fixed when the snippet is written, before the type is picked.)
    insertText: `token \${1:name} : \${2|${TOKEN_TYPE_NAMES.join(',')}|} =$0`,
  }
}

/** The kinds a token value can take. `alias` carries its `by` (and the groups this document
 *  declares) so the next thing to decide is which group, not which word; `compute` carries its
 *  braces for the same reason - the shape is the part nobody should have to remember. */
function valueKinds(
  spans: NodeSpan[],
  snippets: boolean,
  declared?: string | null,
): CompletionItem[] {
  const groups = spans.filter((s) => s.kind === 'contextGroup').map((s) => s.name)
  return TOKEN_VALUE_KINDS.map((kind) => {
    const base = item(kind, CompletionItemKind.Keyword)
    if (!snippets) return base
    if (kind === 'alias') {
      // With no group declared yet there is nothing to choose from, so the stop is a plain
      // placeholder rather than an empty list.
      const group = groups.length > 0 ? `\${1|${groups.join(',')}|}` : '${1:Group}'
      return {
        ...base,
        detail: 'a value per context',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: `alias by ${group} {\n\t$0\n}`,
      }
    }
    if (kind === 'compute') {
      // The step offered as the placeholder is the one that BELONGS to the declared type: a
      // measurement is scaled, a colour is lightened. Offering `lighten` on a font size would
      // teach the wrong vocabulary at the exact moment the author is learning it.
      const step = declared && LENGTH_TYPES.has(declared) ? 'scale 1.25' : 'lighten 20%'
      return {
        ...base,
        detail: 'derived from another token',
        insertTextFormat: InsertTextFormat.Snippet,
        insertText: `compute \${1:token} { \${2:${step}} }$0`,
      }
    }
    return base
  })
}

/** The group an `alias by GROUP { … }` block hangs off, from the statement that opened it. */
function aliasGroup(ctx: CursorContext): string {
  const by = ctx.blockStatement.indexOf('by')
  return by >= 0 ? (ctx.blockStatement[by + 1] ?? '') : ''
}

/** The token's declared type, from `token PATH : TYPE = …` typed so far. */
function declaredType(statement: string[]): string | null {
  const colon = statement.indexOf(':')
  return colon >= 0 ? (statement[colon + 1] ?? null) : null
}

/** A prop's declared type, from `name : TYPE …`. Read past the colon when it is there, and
 *  past its absence when it is not: an author mid-line has not written it yet. */
function propType(statement: string[]): string {
  return (statement[1] === ':' ? statement[2] : statement[1]) ?? ''
}

// `part Button: container {` - what a part IS, said where it is named (0055 §3.2). After the
// name come the kinds, carrying the colon that introduces them, exactly as a token's type does;
// after the kind, only the brace. The name itself is the author's.
function partHeader(statement: readonly string[], prev: string): CompletionItem[] {
  const kinds = () => words(NODE_KINDS, CompletionItemKind.EnumMember, 'kind')
  if (statement.length === 2) return withColon(kinds())
  if (prev === ':' && statement.length === 3) return kinds()
  return []
}

/** The same suggestions, each carrying the `:` that introduces a type - the one spelling of
 *  name-then-type on this surface (milda 0.4), as the token declaration already offers. */
function withColon(items: CompletionItem[]): CompletionItem[] {
  return items.map((it) => ({ ...it, insertText: `: ${it.insertText ?? it.label}` }))
}

const camel = (name: string): string => name.replace(/\.(\w)/g, (_, c: string) => c.toUpperCase())

const keywords = (list: readonly string[]): CompletionItem[] =>
  list.map((k) => item(k, CompletionItemKind.Keyword))

const words = (
  list: readonly string[],
  kind: CompletionItemKind,
  detail?: string,
): CompletionItem[] => list.map((w) => item(w, kind, detail))

function item(label: string, kind: CompletionItemKind, detail?: string): CompletionItem {
  return detail ? { label, kind, detail } : { label, kind }
}
