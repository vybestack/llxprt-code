/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type declarations for WASM binary imports.
 * These are handled by esbuild's wasm-binary plugin which embeds
 * WASM files as Uint8Array at build time.
 */

declare module '*.wasm?binary' {
  const content: Uint8Array;
  export default content;
}

declare module 'tree-sitter-bash/tree-sitter-bash.wasm?binary' {
  const content: Uint8Array;
  export default content;
}
