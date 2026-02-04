/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import type React from 'react';
import { useKeypress } from '../hooks/useKeypress.js';
import { ShellExecutionService } from '@vybestack/llxprt-code-core';
import { keyToAnsi, type Key } from '../hooks/keyToAnsi.js';

export interface ShellInputPromptProps {
  activeShellPtyId: number | null;
  focus?: boolean;
}

export const ShellInputPrompt: React.FC<ShellInputPromptProps> = ({
  activeShellPtyId,
  focus = true,
}) => {
  const handleInput = useCallback(
    (key: Key) => {
      if (!focus) {
        return;
      }
      const targetPtyId =
        activeShellPtyId ?? ShellExecutionService.getLastActivePtyId();
      if (!targetPtyId) {
        return;
      }
      if (key.ctrl && key.shift && key.name === 'up') {
        ShellExecutionService.scrollPty(targetPtyId, -1);
        return;
      }

      if (key.ctrl && key.shift && key.name === 'down') {
        ShellExecutionService.scrollPty(targetPtyId, 1);
        return;
      }

      const ansiSequence = keyToAnsi(key);
      if (ansiSequence) {
        ShellExecutionService.writeToPty(targetPtyId, ansiSequence);
      }
    },
    [focus, activeShellPtyId],
  );

  useKeypress(handleInput, { isActive: focus });

  return null;
};
