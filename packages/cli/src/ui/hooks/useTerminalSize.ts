/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export function useTerminalSize(): { columns: number; rows: number } {
  // Use Ink's useStdout hook to get access to the stdout that Ink is using
  // This ensures we're reading from the same source as Ink's layout engine
  const { stdout } = useStdout();

  const [size, setSize] = useState(() => ({
    columns: stdout?.columns || process.stdout.columns || 80,
    rows: stdout?.rows || process.stdout.rows || 24,
  }));

  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | undefined;

    function updateSize() {
      // Clear previous timeout
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      // Set new timeout to update size only after changes stop
      resizeTimeout = setTimeout(() => {
        const newSize = {
          columns: stdout?.columns || process.stdout.columns || 80,
          rows: stdout?.rows || process.stdout.rows || 24,
        };

        // Only update state if the size actually changed
        if (size.columns !== newSize.columns || size.rows !== newSize.rows) {
          setSize(newSize);
        }
      }, 150); // 150ms debounce delay
    }

    // Listen to resize events on process.stdout
    process.stdout.on('resize', updateSize);

    return () => {
      process.stdout.off('resize', updateSize);
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
    };
  }, [stdout, size.columns, size.rows]);

  return size;
}
