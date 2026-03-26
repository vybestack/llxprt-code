/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime utility functions for OAuth authentication.
 * These are pure functions used across multiple OAuth-related modules.
 */

import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';

/**
 * Checks if the 'authOnly' setting is enabled.
 * Accepts both boolean and string values.
 */
export function isAuthOnlyEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return false;
}

/**
 * Private helper to check if an object might be a logging wrapper.
 * Used by unwrapLoggingProvider to detect wrapped providers.
 */
function isLoggingWrapperCandidate(
  provider: unknown,
): provider is { wrappedProvider?: unknown } {
  return (
    !!provider &&
    typeof provider === 'object' &&
    Object.prototype.hasOwnProperty.call(provider, 'wrappedProvider')
  );
}

/**
 * Checks if a handler has request metadata capability.
 * Used to extract OAuthTokenRequestMetadata from handler objects.
 */
export function hasRequestMetadata(handler: unknown): handler is {
  getRequestMetadata: () => OAuthTokenRequestMetadata | undefined;
} {
  return (
    !!handler &&
    typeof handler === 'object' &&
    typeof (handler as { getRequestMetadata?: unknown }).getRequestMetadata ===
      'function'
  );
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P12
 * @requirement REQ-SP3-003
 * @pseudocode oauth-safety.md lines 1-17
 *
 * Unwraps a logging wrapper to get the underlying provider.
 * The generic constraint is intentionally broad to work with both
 * CLI OAuthProvider instances and core BaseProvider instances.
 */
export function unwrapLoggingProvider<T extends { name: string } | undefined>(
  provider: T,
): T {
  if (!provider) {
    return provider;
  }

  const visited = new Set<unknown>();
  let current: unknown = provider;

  while (isLoggingWrapperCandidate(current)) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    const next = current.wrappedProvider;
    if (!next) {
      break;
    }
    current = next;
  }

  return current as T;
}
