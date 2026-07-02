/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// The canonical GitIgnoreParser implementation lives in the storage package.
// This re-export preserves backward compatibility for consumers that import
// from @vybestack/llxprt-code-core while avoiding a stale duplicate.
export {
  GitIgnoreParser,
  type GitIgnoreFilter,
  type GitIgnoreParserOptions,
  type IgnoreMatchState,
} from '@vybestack/llxprt-code-storage';
