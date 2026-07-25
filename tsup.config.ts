import { defineConfig } from 'tsup'

// Bundle EVERYTHING (server + @mildastudio/milda parser + vscode-languageserver) into
// one file, so the built binary runs with plain `node dist/index.js` from any working
// directory — no reliance on node_modules being present, and no ESM subpath-resolution
// quirks. (vscode-languageserver exposes `/node` without an ESM `exports` map, which
// strict Node ESM cannot resolve when left external; tsx tolerates it, plain node does
// not — this is exactly what an editor spawns.) Node built-ins stay external.
// CJS output (emitted as `dist/index.cjs` since package.json is `type: module`):
// bundling the CJS `vscode-languageserver` into ESM triggers esbuild's "Dynamic
// require of 'util' is not supported" shim at runtime, whereas a CJS bundle keeps
// native `require` for Node built-ins. The result is a single self-contained CommonJS
// file an editor can launch with `node dist/index.cjs`.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  clean: true,
  noExternal: [/.*/],
})
