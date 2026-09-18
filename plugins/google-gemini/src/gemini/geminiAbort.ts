/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal !== undefined && signal.aborted === true) {
    const error = new Error('Operation was aborted');
    error.name = 'AbortError';
    throw error;
  }
}
