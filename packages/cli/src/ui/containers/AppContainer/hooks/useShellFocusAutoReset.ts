/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo } from 'react';
import { ToolCallStatus, type HistoryItemWithoutId } from '../../../types.js';
import { SHELL_COMMAND_NAME, SHELL_NAME } from '../../../constants.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const debug = new DebugLogger('llxprt:ui:appcontainer');

interface UseShellFocusAutoResetParams {
  pendingHistoryItems: HistoryItemWithoutId[];
  embeddedShellFocused: boolean;
  setEmbeddedShellFocused: (value: boolean) => void;
}

/**
 * @hook useShellFocusAutoReset
 * @description Resets embedded shell focus when no shell tool is executing
 * @inputs pendingHistoryItems, embeddedShellFocused, setEmbeddedShellFocused
 * @outputs activeShellExecuting flag
 * @sideEffects Updates focus state when execution ends
 */
export function useShellFocusAutoReset({
  pendingHistoryItems,
  embeddedShellFocused,
  setEmbeddedShellFocused,
}: UseShellFocusAutoResetParams): { anyShellExecuting: boolean } {
  const anyShellExecuting = useMemo(
    () =>
      pendingHistoryItems.some(
        (item) =>
          item.type === 'tool_group' &&
          item.tools.some(
            (tool) =>
              (tool.name === SHELL_COMMAND_NAME || tool.name === SHELL_NAME) &&
              tool.status === ToolCallStatus.Executing,
          ),
      ),
    [pendingHistoryItems],
  );

  useEffect(() => {
    if (embeddedShellFocused && !anyShellExecuting) {
      debug.log('Auto-resetting embeddedShellFocused: no shell executing');
      setEmbeddedShellFocused(false);
    }
  }, [embeddedShellFocused, anyShellExecuting, setEmbeddedShellFocused]);

  return { anyShellExecuting };
}
