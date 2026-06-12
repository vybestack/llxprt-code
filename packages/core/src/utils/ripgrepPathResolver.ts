/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ripgrep path resolution now lives in the dependency-free
 * `@vybestack/llxprt-code-tools` package, which owns the grep tool and the
 * `@lvce-editor/ripgrep` dependency. Core re-exports these symbols for
 * backwards compatibility so existing consumers (e.g. the CLI) keep working
 * without core re-declaring the binary-downloading ripgrep dependency. Having
 * the dependency in a single package avoids duplicate postinstall downloads
 * that previously broke the sandbox Docker image build.
 */
export {
  getRipgrepPath,
  isRipgrepAvailable,
  clearRipgrepAvailabilityCache,
  ensureWindowsShortcut,
} from '@vybestack/llxprt-code-tools';
