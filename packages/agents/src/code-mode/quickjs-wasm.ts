/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Loads the QuickJS WebAssembly module for the trusted wrapper from an
 * explicit file, so the wrapper never depends on where an inlined copy of the
 * emscripten loader thinks its sibling `.wasm` lives.
 *
 * Two layouts exist:
 * - Source and `dist` runs import the wrapper unbundled; the wasm is resolved
 *   through `quickjs-emscripten`, which owns the variant package dependency.
 * - The published CLI bundle emits the wrapper as `bundle/quickjs-wrapper.js`
 *   with {@link LLXPRT_BUNDLED_QUICKJS_WASM} defined at build time, and the
 *   wasm is staged next to it under that name.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_SYNC,
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSWASMModule,
} from 'quickjs-emscripten';

/**
 * File name of the wasm staged next to the bundled wrapper. Replaced by the
 * bundler (`define`); undeclared at runtime for unbundled runs.
 */
declare const LLXPRT_BUNDLED_QUICKJS_WASM: string | undefined;

/** The wasm of the release-sync variant as installed with quickjs-emscripten. */
export function resolveInstalledQuickJsWasm(anchorUrl: string): string {
  const quickJsEntry = createRequire(anchorUrl).resolve('quickjs-emscripten');
  return createRequire(quickJsEntry).resolve(
    '@jitl/quickjs-wasmfile-release-sync/wasm',
  );
}

export function resolveQuickJsWasmPath(): string {
  return typeof LLXPRT_BUNDLED_QUICKJS_WASM === 'string'
    ? fileURLToPath(new URL(LLXPRT_BUNDLED_QUICKJS_WASM, import.meta.url))
    : resolveInstalledQuickJsWasm(import.meta.url);
}

export async function loadQuickJsModule(): Promise<QuickJSWASMModule> {
  const bytes = readFileSync(resolveQuickJsWasmPath());
  const wasmBinary = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return newQuickJSWASMModuleFromVariant(
    newVariant(RELEASE_SYNC, { wasmBinary }),
  );
}
