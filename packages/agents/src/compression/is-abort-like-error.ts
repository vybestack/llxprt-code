/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function isAbortLikeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return (
    Reflect.get(error, 'name') === 'AbortError' ||
    Reflect.get(error, 'code') === 'ABORT_ERR'
  );
}
