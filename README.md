# @mildastudio/milda-lsp

A [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
server for the Milda design-system DSL (`.milda` files).

It reuses the `@mildastudio/milda` parser directly, so the language server and the
Studio speak the exact same grammar - there is no second parser to keep in sync. One
server backs every LSP-capable editor: JetBrains IDEs, VS Code, Neovim, Zed.

## Status

**M1 - diagnostics.** On open and on every edit, the server parses with the
error-recovering `parseMildaDocument` and publishes one diagnostic per syntactic
issue, each widened from the parser's point anchor to the token underneath it.

**M2 - spans, semantics, structure.** The parser now emits a source-span side-table
(`ParseResult.spans`) keyed by the same ids the AST uses, without adding positions to
any AST type. On top of it:

- **Semantic diagnostics** from `engine/validate` (unknown archetype, alias-by an
  undeclared context group, facet/layout references to missing tokens, dangling
  param→prop bindings, unknown states), each placed on the offending entity's span.
- **Document symbols** - a hierarchical outline (component → parts / props / events,
  context group → members).
- **Folding ranges** for every multi-line declaration block.

**M3 - completion, hover, navigation.** Vocabulary is the live prelude plus the parser's
own surface word sets, so it never drifts from the language.

- **Completion** - scoped to where the cursor is _in the language_, not to the document.
  The chain of open blocks and the already-typed atoms of the current statement
  (`src/context.ts`) decide what is legal here, so `foundations { … }` offers `token` and
  nothing else - never `foundations` or `component`, which cannot appear there. Then:
  token types after the `:` of a token decl, value kinds after its `=`, colour-space
  literals after `raw` on a colour token; archetypes after `archetype`, capabilities after
  `requires`; part keywords + facet names inside a part, layout keys (and each key's own
  values) inside `layout`, UI states after `state`, slot arities after `slot`; declared
  token refs after a facet name; type words + this document's types after a prop name.
  Because the context is read off the text rather than the parse tree, it still works in
  the half-typed, doesn't-parse-yet state that is the only one completion ever runs in.
  Facet names come from the parser's `FACET_NAMES`, so what is offered is the surface
  spelling it accepts (`text.clamp`) rather than the AST's (`textClamp`).
- **Hover** - Markdown docs for the identifier under the cursor: document declarations
  (token type/value, component archetype + description, context-group members) and
  prelude vocabulary (archetype `contract` + composes, facet `covers`, state `from`).
- **Go-to-definition** - from a reference (token ref, component / type name) to the
  declaration's name range.

**M4 - semantic highlighting + JetBrains plugin.** The server now answers
`textDocument/semanticTokens/full`, so syntax colouring travels with the language
server (keywords, types, strings, numbers, comments, dotted refs, prop refs) instead
of a per-editor grammar. Three of the rules are positional rather than word-list, because a word
list gets them wrong: everything inside a value literal's parentheses is that literal's VALUE (so
`hex(fff)` and `hex(000)` read alike, where a per-word classifier coloured one as a number and the
other as an identifier); the word after a `:` is the declared TYPE (which cannot be a word list at
all - `border`, `opacity` and `shadow` are token types _and_ facet heads, and only the position
tells them apart); and the word after a declaring keyword is a name THIS FILE declares, which gets
its own category (`class`) so a reader can tell their own names from the language's.

> **JetBrains note.** The plugin does its own colouring from a verified twin of this classifier and
> switches the LSP semantic-token layer OFF, because the platform maps LSP `type` to
> `DefaultLanguageHighlighterColors.IDENTIFIER` - the plain foreground - and would repaint over it.
> Editors whose mapping is theirs to theme (VS Code, Neovim, Zed) keep using the server's tokens. A thin JetBrains plugin that launches this server lives in
> [`packages/milda-jetbrains`](../milda-jetbrains).

**Writing a value.** Knowing that `oklch` exists is not the same as knowing what its three
numbers are, and once the cursor is inside the parentheses there is no word left to complete.
So the two features work as one:

- A **statement arrives whole** - completing `token` inserts `token name : TYPE = value` with tab
  stops, and the type stop is a _choice_ placeholder, so the client opens the list of token types
  there by itself. Every other statement head with a fixed shape does the same
  (`STATEMENT_SNIPPETS`): `component Name "…" { … }`, `context-group Name { … }`, `part name { … }`,
  `page "Title" { … }`, and so on - each one expanded and run through the real parser in
  `src/statement-scaffolds.test.ts`, since a scaffold the reader rejects is worse than none.
  Completing a literal inserts a pre-filled call (`oklch(0.62 0.19 256)`) whose channels are the
  tab stops, and every colour space that takes an alpha is offered twice - `oklch` and
  `oklch / A` - because "how do I make this translucent" is not answerable from a list of names.
  All of it is sent only to a client that declared `snippetSupport`; everyone else gets plain text
  it can use.
- **An alias line** is three decisions and the editor now helps with all three: the contexts of
  ITS OWN group, each carrying the `->` (which is not a decision), and then the values that would
  FIT the token - a colour token is offered colour tokens (a `ring` among them, since a ring is a
  colour) and never a spacing token, because that is an error the reader reports.
- **Argument hints** (`textDocument/signatureHelp`) name the channels while they are typed:
  `oklch(L C H / A)`, with the one being written highlighted. Which literals exist, what each
  channel accepts and an in-range sample all come from the language's own
  `VALUE_LITERAL_FNS` - the table the parser reads its function names from - so the hint
  cannot describe a function the reader would reject. Every sample is run through the real
  parser in `src/value-authoring.test.ts`: a pre-filled call the reader then complains about
  would be worse than an empty one.

The completion trigger characters are the points where one decision ends and the next begins
(`:` → the type, `=` → the value, `(` → the channels, `.` → a token path, and a space → the
next word), **plus every letter**. The letters are not decoration: JetBrains' LSP client opens
the popup only for a character the server declared as a trigger (`LspAutoPopupTypedHandler`
checks the typed character against `completionProvider.triggerCharacters` and does nothing
otherwise), so without them, typing `a` inside `component { … }` asked the server nothing and
`archetype`/`props`/`part` could only be found with the completion shortcut. Editors that
already open on identifier characters were asking us anyway.

That also shapes the `token` scaffold: it ends at `=` with **no** trailing space, because the
space is the author's next keystroke and by then the type is known - so the list that opens is
that type's own literals rather than a fixed one. A choice placeholder cannot do that; its
options are decided when the snippet is written.

## Run

```bash
npm run build -w @mildastudio/milda-lsp   # emits a self-contained dist/index.cjs
```

The `milda-lsp` binary speaks LSP over **stdio**. Point any editor's generic LSP
client at it for the `milda` language / `.milda` extension. For local development
without a build step, editors that accept a command can run:

```bash
npx tsx packages/milda-lsp/src/index.ts
```

### JetBrains

Install the plugin in [`packages/milda-jetbrains`](../milda-jetbrains) (paid JetBrains
IDEs only - the LSP API is not in Community editions). It launches this server and
wires up every feature above, including semantic highlighting. See that package's
README to build and install.

## Architecture

Each feature is a pure, transport-free, unit-tested core; `server.ts` binds them to
the LSP stdio transport. All Milda-specific logic lives in the cores.

- `src/diagnostics.ts` - syntactic diagnostics (`text → Diagnostic[]`).
- `src/semantic.ts` - semantic diagnostics via `engine/validate`, placed by span.
- `src/symbols.ts` - hierarchical document symbols from the span table.
- `src/folding.ts` - folding ranges from the span table.
- `src/completion.ts` - context-aware completion items.
- `src/hover.ts` - hover docs for the identifier under the cursor.
- `src/definition.ts` - go-to-definition for references.
- `src/semantic-tokens.ts` - lexical classifier → LSP semantic tokens (highlighting).
- `src/signature-help.ts` - what a value literal's arguments are, while they are typed.
- `src/analysis.ts` - shared position helpers (word-at-cursor, enclosing span,
  reference resolution) used by completion / hover / definition.
- `src/range.ts` - the single 1-based (Milda) → 0-based (LSP) position bridge.
- `src/server.ts` - transport wiring + advertised capabilities.
- `src/index.ts` - the `milda-lsp` executable; just starts the server.
