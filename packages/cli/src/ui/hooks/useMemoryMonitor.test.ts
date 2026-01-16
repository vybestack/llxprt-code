/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '../../test-utils/render.js';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useMemoryMonitor,
  MEMORY_CHECK_INTERVAL_MS,
  MEMORY_WARNING_THRESHOLD_BYTES,
} from './useMemoryMonitor.js';
import process from 'node:process';
import { MessageType } from '../types.js';

describe('useMemoryMonitor', () => {
  const addItem = vi.fn();
  const memoryUsageSpy = vi.spyOn(process, 'memoryUsage');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not emit a warning when usage is below the threshold', () => {
    memoryUsageSpy.mockReturnValue({
      rss: MEMORY_WARNING_THRESHOLD_BYTES / 4,
    } as NodeJS.MemoryUsage);
    renderHook(() => useMemoryMonitor({ addItem }));
    vi.advanceTimersByTime(MEMORY_CHECK_INTERVAL_MS * 2);
    expect(addItem).not.toHaveBeenCalled();
  });

  it('emits a warning once when usage exceeds the threshold', () => {
    memoryUsageSpy.mockReturnValue({
      rss: MEMORY_WARNING_THRESHOLD_BYTES * 1.2,
    } as NodeJS.MemoryUsage);

    renderHook(() => useMemoryMonitor({ addItem }));
    vi.advanceTimersByTime(MEMORY_CHECK_INTERVAL_MS);
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.WARNING,
      }),
      expect.any(Number),
    );

    // Verify it does not warn again once cleared.
    vi.advanceTimersByTime(MEMORY_CHECK_INTERVAL_MS);
    expect(addItem).toHaveBeenCalledTimes(1);
  });
});
