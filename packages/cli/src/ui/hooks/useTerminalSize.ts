/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { execSync } from 'child_process';

const TERMINAL_PADDING_X = 8;

// Get terminal dimensions using child_process to run tput command
// as process.stdout.columns and process.stdout.rows aren't reliable in our environment
function getTerminalDimensions() {
  try {
    const cols = parseInt(execSync('tput cols').toString().trim(), 10);
    const rows = parseInt(execSync('tput lines').toString().trim(), 10);
    return {
      columns: cols || 80,
      rows: rows || 24,
    };
  } catch (_error) {
    // Fallback to process.stdout if tput doesn't work
    return {
      columns: (process.stdout.columns || 80) - TERMINAL_PADDING_X,
      rows: process.stdout.rows || 24,
    };
  }
}

export function useTerminalSize(): { columns: number; rows: number } {
  const [size, setSize] = useState(getTerminalDimensions());

  useEffect(() => {
    function updateSize() {
      setSize(getTerminalDimensions());
    }

    process.stdout.on('resize', updateSize);
    return () => {
      process.stdout.off('resize', updateSize);
    };
  }, []);

  return size;
}
