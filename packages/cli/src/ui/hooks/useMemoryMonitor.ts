/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import process from 'node:process';
import { MessageType, type HistoryItemWithoutId } from '../types.js';

export const MEMORY_WARNING_THRESHOLD_BYTES = 7 * 1024 * 1024 * 1024; // 7GB
export const MEMORY_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

interface UseMemoryMonitorOptions {
  addItem: (item: HistoryItemWithoutId, timestamp: number) => void;
}

export function useMemoryMonitor({ addItem }: UseMemoryMonitorOptions): void {
  useEffect(() => {
    const intervalId = setInterval(() => {
      const rssUsage = process.memoryUsage().rss;
      if (rssUsage > MEMORY_WARNING_THRESHOLD_BYTES) {
        addItem(
          {
            type: MessageType.WARNING,
            text:
              `High memory usage detected: ${(
                rssUsage /
                (1024 * 1024 * 1024)
              ).toFixed(2)} GB. ` +
              'If the CLI exits unexpectedly, please run `/bug` to report it.',
          },
          Date.now(),
        );
        clearInterval(intervalId);
      }
    }, MEMORY_CHECK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [addItem]);
}
