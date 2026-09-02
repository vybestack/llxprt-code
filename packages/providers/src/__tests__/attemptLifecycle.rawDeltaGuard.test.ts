/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the attempt-lifecycle metadata contract at the raw
 * token-delta seam (issue #3473, OCR remediation).
 *
 * A lifecycle observer travels through request metadata, so every hook it
 * advertises is external input. The observer guard must reject an observer
 * whose optional onRawTokenDelta is present but not a function: accepting it
 * makes resolveRawTokenDeltaNotifier call .bind on a non-function and throw
 * a TypeError at request time, failing the whole request instead of
 * degrading to visible-chunk timing.
 */

import { describe, it, expect } from 'bun:test';
import {
  ATTEMPT_LIFECYCLE_KEY,
  getAttemptLifecycleObserver,
  resolveRawTokenDeltaNotifier,
} from '../logging/attemptLifecycle.js';

describe('issue #3473: lifecycle observer guard for the raw-delta hook', () => {
  it('accepts an observer without an onRawTokenDelta hook and resolves no notifier', () => {
    const observer = {
      onAttemptStart: () => {},
      onAttemptEnd: () => {},
    };
    const metadata = { [ATTEMPT_LIFECYCLE_KEY]: observer };

    expect(getAttemptLifecycleObserver(metadata)).toBe(observer);
    expect(resolveRawTokenDeltaNotifier(metadata)).toBeUndefined();
  });

  it('accepts an observer whose onRawTokenDelta is a function and resolves a bound notifier', () => {
    let fired = 0;
    const observer = {
      onAttemptStart: () => {},
      onAttemptEnd: () => {},
      onRawTokenDelta: () => {
        fired++;
      },
    };
    const metadata = { [ATTEMPT_LIFECYCLE_KEY]: observer };

    const notifier = resolveRawTokenDeltaNotifier(metadata);
    expect(notifier).toBeTypeOf('function');
    notifier?.();
    expect(fired).toBe(1);
  });

  it('rejects an observer whose onRawTokenDelta is not a function instead of throwing at resolve time', () => {
    const metadata = {
      [ATTEMPT_LIFECYCLE_KEY]: {
        onAttemptStart: () => {},
        onAttemptEnd: () => {},
        onRawTokenDelta: 42,
      },
    };

    expect(getAttemptLifecycleObserver(metadata)).toBeUndefined();
    expect(resolveRawTokenDeltaNotifier(metadata)).toBeUndefined();
  });

  it('resolves no notifier when no observer is present in metadata', () => {
    expect(resolveRawTokenDeltaNotifier(undefined)).toBeUndefined();
    expect(resolveRawTokenDeltaNotifier({})).toBeUndefined();
  });
});
