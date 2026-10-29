/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  disposeLazyNativeRecording,
  joinNativePersistence,
  joinNativePublicTurn,
} from './helpers/native-finalizer-contracts.js';

describe('native public Agent recording finalizer join', () => {
  it('joins the final public-turn positional write and mirror acknowledgement before shutdown completes', async () => {
    await expect(joinNativePublicTurn()).resolves.toBeUndefined();
  }, 30000);

  for (const terminal of ['stop', 'dispose'] as const) {
    for (const fault of ['none', 'trailer', 'flush'] as const) {
      it(`joins accepted native persistence before ${terminal} completes with ${fault} fault`, async () => {
        await expect(
          joinNativePersistence(terminal, fault),
        ).resolves.toBeUndefined();
      }, 30000);
    }
  }

  it('releases an empty recording lock without allocating a native file during shutdown', async () => {
    await expect(disposeLazyNativeRecording()).resolves.toBeUndefined();
  }, 30000);
});
