/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Neutral provider API error contract — structural type guard, not a base class.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-007
 * @pseudocode lines 80-84
 */

import { isRecord } from './jsonSchema.js';

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-007.1
 * @pseudocode lines 80-81
 */
export interface ProviderApiError {
  provider?: string;
  status?: number;
  code?: string;
  message: string;
  retryAfterMs?: number;
  isQuotaError?: boolean;
  isAuthError?: boolean;
  isTransient?: boolean;
  /**
   * The original provider SDK error, preserved verbatim for diagnostics.
   * May carry request/response context (headers, auth-adjacent details) from
   * the SDK — consumers MUST sanitize before logging, serializing, or sending
   * to telemetry; never emit `raw` unconditionally.
   */
  raw?: unknown;
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-007.2
 * @pseudocode lines 82-84
 */
export function isProviderApiError(value: unknown): value is ProviderApiError {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value['message'] !== 'string') {
    return false;
  }

  if ('status' in value && typeof value['status'] !== 'number') {
    return false;
  }

  if ('code' in value && typeof value['code'] !== 'string') {
    return false;
  }

  if ('provider' in value && typeof value['provider'] !== 'string') {
    return false;
  }

  if (
    'retryAfterMs' in value &&
    (typeof value['retryAfterMs'] !== 'number' ||
      !Number.isFinite(value['retryAfterMs']))
  ) {
    return false;
  }

  if ('isQuotaError' in value && typeof value['isQuotaError'] !== 'boolean') {
    return false;
  }

  if ('isAuthError' in value && typeof value['isAuthError'] !== 'boolean') {
    return false;
  }

  if ('isTransient' in value && typeof value['isTransient'] !== 'boolean') {
    return false;
  }

  return true;
}
