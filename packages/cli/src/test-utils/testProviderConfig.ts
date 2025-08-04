/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * When testing in jsdom or other browser-like environments,
 * pass true as the second parameter to getProviderManager:
 *
 * @example
 * ```typescript
 * import { getProviderManager } from '../providers/providerManagerInstance';
 *
 * // In your test
 * const manager = getProviderManager(undefined, true); // Enable browser environment
 * ```
 */
export const ALLOW_BROWSER_IN_TESTS = true;
