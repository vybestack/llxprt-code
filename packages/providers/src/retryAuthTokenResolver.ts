/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from './IProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

/**
 * Resolves the auth token from options (handles string, object with
 * provide(), and plain function). All callable invocations are wrapped in
 * try/catch so a rejecting token provider does not become an unhandled
 * rejection that masks the real error.
 * @fix issue1861
 */
const tokenResolverLogger = new DebugLogger('llxprt:retry:auth-token');

export async function resolveAuthTokenFromOptions(
  options: GenerateChatOptions,
): Promise<string> {
  const authToken = options.resolved?.authToken;
  if (typeof authToken === 'string') {
    return authToken;
  }
  // Handle RuntimeAuthTokenProvider object with provide method — check
  // this BEFORE the plain-function branch so callable objects that also
  // expose `provide` are routed correctly.
  if (
    authToken &&
    typeof authToken === 'object' &&
    'provide' in authToken &&
    typeof (authToken as { provide?: unknown }).provide === 'function'
  ) {
    try {
      const result = await (
        authToken as {
          provide: () => Promise<string | undefined> | string | undefined;
        }
      ).provide();
      return typeof result === 'string' ? result : '';
    } catch (err) {
      tokenResolverLogger.debug(
        () =>
          `Token provider threw, returning empty token: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }
  // Handle plain function returning string or Promise<string>
  if (typeof authToken === 'function') {
    try {
      const result = await (authToken as () => string | Promise<string>)();
      return typeof result === 'string' ? result : '';
    } catch (err) {
      tokenResolverLogger.debug(
        () =>
          `Token provider function threw, returning empty token: ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }
  return '';
}
