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

**M3 - completion, hover, navigation.** Context comes from the token before the cursor
plus the enclosing declaration span; vocabulary is the live prelude, so it never drifts
from the language.

- **Completion** - archetype names after `archetype`, UI-state names after `state`,
  declared token refs after a facet, facet names + keywords inside a part, and
  top-level / component-body keywords elsewhere.
- **Hover** - Markdown docs for the identifier under the cursor: document declarations
  (token type/value, component archetype + description, context-group members) and
  prelude vocabulary (archetype `contract` + composes, facet `covers`, state `from`).
- **Go-to-definition** - from a reference (token ref, component / type name) to the
  declaration's name range.

**M4 - semantic highlighting + JetBrains plugin.** The server now answers
`textDocument/semanticTokens/full`, so syntax colouring travels with the language
server (keywords, types, strings, numbers, comments, dotted refs, prop refs) instead
of a per-editor grammar. A thin JetBrains plugin that launches this server lives in
[`packages/milda-jetbrains`](../milda-jetbrains).

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
IDEs only — the LSP API is not in Community editions). It launches this server and
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
- `src/analysis.ts` - shared position helpers (word-at-cursor, enclosing span,
  reference resolution) used by completion / hover / definition.
- `src/range.ts` - the single 1-based (Milda) → 0-based (LSP) position bridge.
- `src/server.ts` - transport wiring + advertised capabilities.
- `src/index.ts` - the `milda-lsp` executable; just starts the server.
