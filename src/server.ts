// ─── Milda LSP — server wiring ────────────────────────────────────────────────
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
import { computeDefinition } from './definition'
import { computeSemanticTokens, SEMANTIC_TOKEN_TYPES } from './semantic-tokens'

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

  connection.onInitialize(
    (): InitializeResult => ({
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        completionProvider: { triggerCharacters: ['.', ' '] },
        hoverProvider: true,
        definitionProvider: true,
        semanticTokensProvider: {
          legend: { tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [] },
          full: true,
        },
      },
      serverInfo: { name: 'milda-lsp', version: '0.1.0' },
    }),
  )

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
    return doc ? computeCompletions(doc.getText(), params.position) : []
  })

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri)
    return doc ? computeHover(doc.getText(), params.position) : null
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
