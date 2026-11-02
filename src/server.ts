// ─── Milda LSP - server wiring ────────────────────────────────────────────────
// Binds the pure feature cores (./diagnostics, ./semantic, ./symbols, ./folding) to
// an LSP transport over stdio. Editors (JetBrains via LspServerSupportProvider,
// VS Code, Neovim, Zed) spawn this process and speak LSP to it; all Milda-specific
// logic lives in the cores so this file stays a transport shim.
//
// Later slices add capabilities here (completionProvider, hoverProvider,
// definitionProvider) as the corresponding cores land.

import {
  createConnection,
  ProposedFeatures,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocuments,
  TextDocumentSyncKind,
  CodeActionKind,
  type InitializeResult,
} from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { computeDiagnostics } from './diagnostics'
import { computeSemanticDiagnostics } from './semantic'
import { readSiblingMildaTexts } from './project'
import { computeDocumentSymbols } from './symbols'
import { computeFoldingRanges } from './folding'
import { computeCompletions } from './completion'
import { computeHover } from './hover'
import { computeCodeActions, withUri } from './required-parts'
import { computeDefinition } from './definition'
import { computeSemanticTokens, SEMANTIC_TOKEN_TYPES } from './semantic-tokens'
import { computeSignatureHelp } from './signature-help'

// Where the completion list should open by itself.
//
// The punctuation is the obvious half: each of these ends one decision and begins the next -
// `:` (now the type), `=` (now the value), `(` (now the channels), `.` (a token path), a space
// (the next word of a statement).
//
// The letters are the surprising half, and they are here for a concrete reason: JetBrains' LSP
// client opens the completion popup ONLY for a character the server declared as a trigger
// (`LspAutoPopupTypedHandler` checks the typed char against `completionProvider.triggerCharacters`
// and does nothing otherwise). Without them, typing `a` inside `component { … }` asked the server
// nothing, and the author had to know to press the completion shortcut to discover `archetype`,
// `props`, `part` - a surface nobody can discover is a surface nobody uses. Editors that already
// open on identifier characters (VS Code) are unaffected: they were asking us anyway.
const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i))
const COMPLETION_TRIGGERS: string[] = [
  '.',
  ' ',
  ':',
  '=',
  '(',
  '-',
  '/',
  '$',
  ...LETTERS,
  ...LETTERS.map((c) => c.toUpperCase()),
]

export function startServer(): void {
  // Wire stdio explicitly so the binary works over stdin/stdout without the caller
  // passing a `--stdio` flag (JetBrains' LSP client, Neovim, and Zed all just spawn
  // the process and talk over its pipes).
  const connection = createConnection(
    ProposedFeatures.all,
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
  )
  const documents = new TextDocuments(TextDocument)

  // What the CLIENT can do, read once at initialize. Only snippets change what we send: a
  // suggestion with tab stops is worse than useless in a client that would paste `${1:name}`
  // as text, so the shape of the answer depends on this.
  let clientSnippets = false

  connection.onInitialize((params): InitializeResult => {
    clientSnippets =
      params.capabilities.textDocument?.completion?.completionItem?.snippetSupport === true
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        completionProvider: { triggerCharacters: COMPLETION_TRIGGERS },
        // While the cursor is inside a literal's parentheses, say what its channels are.
        // Re-triggered on the separators, so the hint follows the argument being typed.
        signatureHelpProvider: { triggerCharacters: ['(', ' '], retriggerCharacters: [' ', '/'] },
        hoverProvider: true,
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
        definitionProvider: true,
        semanticTokensProvider: {
          legend: { tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [] },
          full: true,
        },
      },
      serverInfo: { name: 'milda-lsp', version: '0.1.0' },
    }
  })

  const publish = (doc: TextDocument): void => {
    const text = doc.getText()
    // Semantic checks see the whole design system (this file + its sibling .milda
    // files), so cross-file token/archetype references don't read as "missing".
    const siblings = readSiblingMildaTexts(doc.uri)
    connection.sendDiagnostics({
      uri: doc.uri,
      version: doc.version,
      // Syntactic (parser) + semantic (validate) diagnostics in one push.
      diagnostics: [...computeDiagnostics(text), ...computeSemanticDiagnostics(text, siblings)],
    })
  }

  // Re-lint on open and on every edit; clear diagnostics when a document closes.
  documents.onDidChangeContent((e) => publish(e.document))
  documents.onDidClose((e) => connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] }))

  connection.onDocumentSymbol((params) => {
    const doc = documents.get(params.textDocument.uri)
    return doc ? computeDocumentSymbols(doc.getText()) : []
  })

  connection.onFoldingRanges((params) => {
    const doc = documents.get(params.textDocument.uri)
    return doc ? computeFoldingRanges(doc.getText()) : []
  })

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri)
    return doc
      ? computeCompletions(doc.getText(), params.position, { snippets: clientSnippets })
      : []
  })

  connection.onSignatureHelp((params) => {
    const doc = documents.get(params.textDocument.uri)
    return doc ? computeSignatureHelp(doc.getText(), params.position) : null
  })

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri)
    return doc ? computeHover(doc.getText(), params.position) : null
  })

  connection.onCodeAction((params) => {
    const doc = documents.get(params.textDocument.uri)
    if (!doc) return []
    return computeCodeActions(doc.getText(), params.range, params.context.diagnostics).map((a) =>
      withUri(a, params.textDocument.uri),
    )
  })

  connection.onDefinition((params) => {
    const doc = documents.get(params.textDocument.uri)
    return doc ? computeDefinition(doc.getText(), params.textDocument.uri, params.position) : null
  })

  connection.languages.semanticTokens.on((params) => {
    const doc = documents.get(params.textDocument.uri)
    return doc ? computeSemanticTokens(doc.getText()) : { data: [] }
  })

  documents.listen(connection)
  connection.listen()
}
