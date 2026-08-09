/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Public surface for the secure browser launcher.
 *
 * This module re-exports ONLY the production API. The dependency-injected
 * factory and its types live in `secure-browser-launcher-internal.ts`, which
 * is intentionally absent from the package subpath map so that no
 * package-public code path can bypass the test fail-closed guard.
 */

export {
  isBrowserLaunchDisabledDuringTests,
  openBrowserSecurely,
  shouldLaunchBrowser,
  validateProfileDirectory,
  type BrowserKind,
  type BrowserLaunchOptions,
} from './secure-browser-launcher-internal.js';
