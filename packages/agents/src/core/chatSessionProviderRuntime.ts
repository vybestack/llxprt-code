/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ANTHROPIC_DEFAULT_BASE_URL,
  ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';

export function resolveProviderBaseUrl(
  provider: IProvider,
  baseUrl: string | undefined,
): string | undefined {
  // Load balancers: use the last-selected sub-profile's base URL so that
  // turns are stamped with the actual endpoint that generated them. This
  // enables cross-endpoint thinking-block stripping when a load balancer
  // rotates between Anthropic-compatible endpoints (e.g. z.ai and native
  // Anthropic).
  const lbProvider = provider as unknown as {
    getLastSelectedBaseUrl?: () => string | undefined;
  };
  if (typeof lbProvider.getLastSelectedBaseUrl === 'function') {
    const lbBaseUrl = lbProvider.getLastSelectedBaseUrl();
    if (lbBaseUrl) return lbBaseUrl;
  }
  // Native Anthropic without an explicit base URL defaults to
  // api.anthropic.com. Stamping turns with this default ensures they are
  // distinguishable from z.ai turns and can be stripped when switching.
  if (provider.name === 'anthropic') {
    return baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL;
  }
  return baseUrl;
}

export function initialProviderBaseUrl(
  provider: string,
  baseUrl: string | undefined,
): string | undefined {
  return (
    baseUrl ??
    (provider === 'anthropic' ? ANTHROPIC_DEFAULT_BASE_URL : undefined)
  );
}

export async function cleanupChatSessionProviderFiles(
  lifecycle: object | undefined,
  runtimeId: string,
): Promise<void> {
  if (!(lifecycle instanceof ProviderFileLifecycle)) return;
  const result = await lifecycle.cleanupScope('session', runtimeId);
  if (result.failed > 0) {
    throw new Error(
      `Provider file cleanup incomplete for session ${runtimeId}; files=${lifecycle
        .snapshot()
        .deletionFailures.map((failure) => failure.fileId)
        .join(',')}`,
    );
  }
  if (result.deferred > 0) {
    await lifecycle.waitForScopeCleanup('session', runtimeId);
  }
}
