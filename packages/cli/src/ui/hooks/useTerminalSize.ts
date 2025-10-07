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
    function updateSize() {
      setSize({
        columns: stdout?.columns || process.stdout.columns || 80,
        rows: stdout?.rows || process.stdout.rows || 24,
      });
    }

    // Listen to resize events on process.stdout
    process.stdout.on('resize', updateSize);

    // Also check size periodically in case resize event doesn't fire
    const interval = setInterval(updateSize, 100);

    return () => {
      process.stdout.off('resize', updateSize);
      clearInterval(interval);
    };
  }, [stdout]);

  return size;
}
