/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

const FALLBACK_COLUMNS = 80;
const FALLBACK_ROWS = 24;

type TerminalSize = { columns: number; rows: number };

function resolveTerminalDimension(
  primaryDimension: number | undefined,
  fallbackDimension: number | undefined,
  defaultDimension: number,
): number {
  if (primaryDimension !== undefined && primaryDimension !== 0) {
    return primaryDimension;
  }

  if (fallbackDimension !== undefined && fallbackDimension !== 0) {
    return fallbackDimension;
  }

  return defaultDimension;
}

function getTerminalSize(stdout: NodeJS.WriteStream): TerminalSize {
  return {
    columns: resolveTerminalDimension(
      stdout.columns,
      process.stdout.columns,
      FALLBACK_COLUMNS,
    ),
    rows: resolveTerminalDimension(
      stdout.rows,
      process.stdout.rows,
      FALLBACK_ROWS,
    ),
  };
}

export function useTerminalSize(): TerminalSize {
  // Use Ink's useStdout hook to get access to the stdout that Ink is using
  // This ensures we're reading from the same source as Ink's layout engine
  const { stdout } = useStdout();

  const [size, setSize] = useState(() => getTerminalSize(stdout));

  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | undefined;

    function updateSize() {
      // Clear previous timeout
      if (resizeTimeout !== undefined) {
        clearTimeout(resizeTimeout);
      }

      // Set new timeout to update size only after changes stop
      resizeTimeout = setTimeout(() => {
        const newSize = getTerminalSize(stdout);

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
      if (resizeTimeout !== undefined) {
        clearTimeout(resizeTimeout);
      }
    };
  }, [stdout, size.columns, size.rows]);

  return size;
}
