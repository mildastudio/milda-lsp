// ─── Milda LSP - the language features, without the server ────────────────────
// Everything the server answers, as plain functions over (text, position): what an
// in-browser editor needs to offer the same completion, diagnostics and hover the
// VS Code and JetBrains clients get. Exposed as @mildastudio/milda-lsp/language.
//
// Nothing reachable from here may touch the protocol or Node: these modules speak
// `vscode-languageserver-types` (pure data + enums) and only ./server imports
// `vscode-languageserver/node`. That split is what lets a web page load this entry.
// Sibling-file resolution (./project) reads the filesystem and is deliberately absent;
// a browser caller passes sibling texts to `computeSemanticDiagnostics` itself.

export { computeCompletions, STATEMENT_SNIPPETS, type CompletionCapabilities } from './completion'
export { computeDiagnostics, DIAGNOSTIC_SOURCE } from './diagnostics'
export { computeSemanticDiagnostics, SEMANTIC_SOURCE } from './semantic'
export { computeHover } from './hover'
export { computeSignatureHelp } from './signature-help'
export {
  computeSemanticTokens,
  decodeSemanticTokens,
  SEMANTIC_TOKEN_TYPES,
  type DecodedSemanticToken,
  type SemanticTokenType,
} from './semantic-tokens'
export {
  CompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
  MarkupKind,
  type CompletionItem,
  type Diagnostic,
  type Hover,
  type MarkupContent,
  type Position,
  type SignatureHelp,
} from 'vscode-languageserver-types'
