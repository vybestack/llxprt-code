/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';

interface UsePowerShellPlaceholderParams {
  vimModeEnabled: boolean;
}

function isPowerShellEnvironment(): boolean {
  return (
    process.env.PSModulePath !== undefined ||
    process.env.PSVERSION !== undefined
  );
}

export function usePowerShellPlaceholder({
  vimModeEnabled,
}: UsePowerShellPlaceholderParams): string {
  return useMemo(() => {
    if (vimModeEnabled) {
      return "  Press 'i' for INSERT mode and 'Esc' for NORMAL mode.";
    }

    if (isPowerShellEnvironment()) {
      return '  Type your message, @path/to/file or +path/to/file';
    }

    return '  Type your message or @path/to/file';
  }, [vimModeEnabled]);
}
