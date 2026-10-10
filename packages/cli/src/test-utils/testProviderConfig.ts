/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * When testing in jsdom or other browser-like environments,
 * pass allowBrowserEnvironment to createProviderManager options:
 *
 * @example
 * ```typescript
 * const { manager } = createProviderManager(runtime, {
 *   fileSystem: new NodeFileSystem(),
 *   allowBrowserEnvironment: true,
 * });
 * ```
 */
export const ALLOW_BROWSER_IN_TESTS = true;
