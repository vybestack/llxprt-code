/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';

const TIKTOKEN_LOADER_MARKER = 'const candidates = __dirname';

export function rewriteTiktokenLoader(source: string): string {
  if (!source.includes(TIKTOKEN_LOADER_MARKER)) {
    throw new Error(
      `Unable to make @dqbd/tiktoken portable: expected loader marker ${JSON.stringify(TIKTOKEN_LOADER_MARKER)}`,
    );
  }
  return source.replace(
    TIKTOKEN_LOADER_MARKER,
    'const candidates = globalThis.__dirname',
  );
}

export const portableTiktokenPlugin: Bun.BunPlugin = {
  name: 'portable-tiktoken-wasm',
  setup(build) {
    // The filter runs against a resolved path, which uses native separators.
    // A forward-slash-only pattern never matches on Windows, so onLoad would
    // silently not fire and the bundle would keep the original
    // `const candidates = __dirname`. That is undefined in an ESM bundle — the
    // banner defines `globalThis.__dirname`, not a bare `__dirname` — so a
    // bundle built on Windows could not locate its tiktoken WASM at runtime.
    build.onLoad(
      { filter: /@dqbd[\\/]tiktoken[\\/]tiktoken\.cjs$/ },
      (args) => ({
        contents: rewriteTiktokenLoader(readFileSync(args.path, 'utf8')),
        loader: 'js',
      }),
    );
  },
};
