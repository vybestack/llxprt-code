/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import { useKeypress } from '../../../hooks/useKeypress.js';

interface UseIdeRestartHotkeyParams {
  isActive: boolean;
}

/**
 * @hook useIdeRestartHotkey
 * @description Exits process when restart prompt is active and user presses R
 * @inputs isActive
 * @outputs void
 * @sideEffects Registers keypress handler
 * @cleanup useKeypress handles cleanup
 */
export function useIdeRestartHotkey({
  isActive,
}: UseIdeRestartHotkeyParams): void {
  useKeypress(
    (key) => {
      if (key.name === 'r' || key.name === 'R') {
        process.exit(0);
      }
    },
    { isActive },
  );
}
