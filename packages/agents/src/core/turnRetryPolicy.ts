/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isSchemaDepthError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { isProviderApiError } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { isTerminalRetryError } from './turnAbortHelpers.js';

export function shouldRetryDirectProviderError(error: unknown): boolean {
  if (isTerminalRetryError(error)) return false;
  if (!isProviderApiError(error) || !error.message) return false;
  const status = error.status ?? 0;
  if (status === 400 || isSchemaDepthError(error.message)) return false;
  return status === 429 || (status >= 500 && status < 600);
}
