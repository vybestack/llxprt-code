/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EmptyStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { StructuredErrorCategory } from '@vybestack/llxprt-code-core/core/turn.js';
import { RetriesExhaustedError } from './errors.js';
import {
  formatPublicProviderMessage,
  getEffectiveProviderStatus,
  getSafeProviderMessage,
} from './providerErrorObservation.js';

export function createRetriesExhaustedError(
  error: unknown,
  attempts: number,
  category: StructuredErrorCategory = 'server_error',
  status?: number,
): RetriesExhaustedError {
  const effectiveStatus = getEffectiveProviderStatus(error, status, category);
  const cause =
    error instanceof Error ? error : new Error(getSafeProviderMessage(error));
  return new RetriesExhaustedError(
    formatPublicProviderMessage(
      `Provider retries exhausted after ${attempts} transport attempts`,
      getSafeProviderMessage(error),
    ),
    category,
    { status: effectiveStatus, cause },
  );
}

export function throwIfEmptyStreamExhaustsBudget(
  producedContent: boolean,
  used: number,
  limit: number,
): void {
  if (producedContent || used < limit) return;
  throw createRetriesExhaustedError(
    new EmptyStreamError('Model stream ended immediately with no content.'),
    used,
  );
}
