/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SubscribeModelChanges } from '@vybestack/llxprt-code-core/utils/events.js';

export function subscribe(
  subscribeChanges: SubscribeModelChanges,
  modelChanged: () => void,
  profileChanged: () => void,
  currentRelease: (() => void) | undefined,
  onRelease: () => void,
): () => void {
  if (currentRelease !== undefined)
    throw new Error('Client model notifications are already bound');
  const unsubscribe = subscribeChanges((profile) => {
    if (profile === undefined) modelChanged();
    else profileChanged();
  });
  return () => {
    try {
      unsubscribe();
    } finally {
      onRelease();
    }
  };
}

export function release(unsubscribe: (() => void) | undefined): unknown[] {
  try {
    unsubscribe?.();
    return [];
  } catch (error) {
    return [error];
  }
}
