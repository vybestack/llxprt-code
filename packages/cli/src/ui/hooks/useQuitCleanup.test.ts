/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  __resetCleanupStateForTesting,
  registerCleanup,
} from '../../utils/cleanup.js';

describe('quit cleanup integration', () => {
  beforeEach(() => {
    __resetCleanupStateForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mouse cleanup is registered and called on exit', async () => {
    const mockWrite = vi.fn().mockReturnValue(true);
    vi.spyOn(process.stdout, 'write').mockImplementation(mockWrite);

    // Simulate the pattern used in gemini.tsx - register mouse cleanup
    const disableMouseEvents = vi.fn(() => {
      process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
    });

    registerCleanup(disableMouseEvents);

    // Simulate quit behavior - import the cleanup runner
    const { runExitCleanup } = await import('../../utils/cleanup.js');
    await runExitCleanup();

    expect(disableMouseEvents).toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('\x1b[?1000l'),
    );
  });

  it('cleanup functions are called in registration order', async () => {
    const callOrder: string[] = [];

    registerCleanup(() => {
      callOrder.push('first');
    });
    registerCleanup(() => {
      callOrder.push('second');
    });
    registerCleanup(() => {
      callOrder.push('third');
    });

    const { runExitCleanup } = await import('../../utils/cleanup.js');
    await runExitCleanup();

    expect(callOrder).toEqual(['first', 'second', 'third']);
  });
});
