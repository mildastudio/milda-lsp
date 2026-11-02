#!/usr/bin/env node
// ─── Milda LSP - executable entry ─────────────────────────────────────────────
// The `milda-lsp` binary. Editors launch this over stdio; it does nothing but
// start the server (all logic lives in ./server and ./diagnostics).

import { startServer } from './server'

startServer()
