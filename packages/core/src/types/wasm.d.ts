/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type declarations for WASM binary resources.
 *
 * Tree-sitter grammar `.wasm` files are loaded at runtime via
 * `require.resolve` + `readFileSync` (see `shell-parser.ts`), so no build-time
 * `?binary` plugin or module augmentation is required.
 */
