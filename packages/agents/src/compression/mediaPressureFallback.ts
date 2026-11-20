/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isRequestByteOverflowError,
  type RequestByteOverflowError,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { PendingMediaBudgetError } from './pendingMediaBudgetError.js';

/**
 * A byte overflow the media fallback may still relieve. A pending-only
 * overflow is already final: no history change can fix it.
 */
export function isRelievableMediaPressure(
  error: unknown,
): error is RequestByteOverflowError {
  return (
    isRequestByteOverflowError(error) &&
    !(error instanceof PendingMediaBudgetError)
  );
}
