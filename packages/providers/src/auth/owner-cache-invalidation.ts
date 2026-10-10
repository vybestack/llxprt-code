/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { unwrapLoggingProvider } from './auth-utils.js';

const logger = new DebugLogger('llxprt:oauth:cache');

export function invalidateOwnerAuthCaches(
  rawProvider: { name: string } | undefined,
): void {
  const provider = unwrapLoggingProvider(rawProvider);
  if (provider) clearProviderCaches(provider);
}

function clearProviderCaches(provider: { name: string }): void {
  for (const method of ['clearAuthCache', 'clearAuth', 'clearState']) {
    const clear: unknown = Reflect.get(provider, method);
    if (typeof clear !== 'function') continue;
    try {
      clear.call(provider);
    } catch (error) {
      logger.debug(`${method} failed for ${provider.name}:`, error);
    }
  }
}

export function createOwnerAuthCacheInvalidator(
  getProvider: (providerName: string) => { name: string } | undefined,
): (providerName: string) => void {
  return (providerName) => invalidateOwnerAuthCaches(getProvider(providerName));
}
