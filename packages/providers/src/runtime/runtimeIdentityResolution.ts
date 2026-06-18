/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * Pure helpers for resolving the active runtime identity, extracted from
 * runtimeRegistry.ts so each step is independently testable and lint-clean.
 *
 * The runtime registry Map and LEGACY_RUNTIME_ID constant are passed in as
 * dependencies to avoid a circular module import with runtimeRegistry.ts.
 */

import { peekActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core';

export interface RuntimeIdentity {
  runtimeId: string;
  metadata: Record<string, unknown>;
}

/**
 * Try resolving the identity from the AsyncLocalStorage runtime scope.
 */
export function resolveFromAsyncLocalStorage(
  scope: RuntimeIdentity | undefined,
): RuntimeIdentity | undefined {
  return scope;
}

/**
 * Try resolving the identity from the active provider runtime context.
 */
export function resolveFromActiveContext(
  registry: Map<string, unknown>,
  legacyRuntimeId: string,
): RuntimeIdentity | undefined {
  const context = peekActiveProviderRuntimeContext();
  if (!context) {
    return undefined;
  }

  const candidateId =
    typeof context.runtimeId === 'string' && context.runtimeId.trim() !== ''
      ? context.runtimeId
      : legacyRuntimeId;

  const metadata = context.metadata ?? {};

  // If the active context's runtimeId is registered in the CLI registry, use it.
  if (registry.has(candidateId)) {
    return { runtimeId: candidateId, metadata };
  }

  // Otherwise fall back to the first registered runtimeId (typically
  // cli.runtime.bootstrap). The active context may be a provider-scoped
  // context (e.g. a per-call UUID from BaseProvider) never registered in the
  // CLI runtime registry.
  const firstRegistered = resolveFromFirstRegistered(registry);
  if (firstRegistered) {
    return { runtimeId: firstRegistered.runtimeId, metadata };
  }

  return { runtimeId: candidateId, metadata };
}

/**
 * Try resolving the identity from the first registered runtime entry.
 */
export function resolveFromFirstRegistered(
  registry: Map<string, unknown>,
): RuntimeIdentity | undefined {
  const firstRegistered = registry.keys().next().value;
  if (!firstRegistered) {
    return undefined;
  }
  return { runtimeId: firstRegistered, metadata: {} };
}
