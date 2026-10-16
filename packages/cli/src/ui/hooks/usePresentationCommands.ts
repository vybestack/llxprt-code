/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useMemo } from 'react';
import type { AboutDetails } from '../commands/aboutCommand.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import { createAboutCommand } from '../commands/aboutCommand.js';
import { createClearCommand } from '../commands/clearCommand.js';
import { bindClearSession } from '../commands/simpleCommandHost.js';
import { createInitCommand } from '../commands/initCommand.js';
import { createVimCommand } from '../commands/vimCommand.js';
import { createUiProfileCommand } from '../commands/uiprofileCommand.js';
import type { CommandContext } from '../commands/types.js';

type PresentationCommands = Pick<
  BuiltinCommandOwners,
  | 'aboutCommand'
  | 'clearCommand'
  | 'initCommand'
  | 'vimCommand'
  | 'uiProfileCommand'
>;

export function usePresentationCommands(
  readAbout: () => Promise<AboutDetails>,
  targetDirectory: string | undefined,
  endSession: Parameters<typeof bindClearSession>[0],
  startNewSession: Parameters<typeof bindClearSession>[1],
  startSession: Parameters<typeof bindClearSession>[2],
  addItem: CommandContext['ui']['addItem'],
  setDebugMessage: CommandContext['ui']['setDebugMessage'],
  updateHistoryTokenCount: CommandContext['ui']['updateHistoryTokenCount'],
  clearItems: () => void,
  refreshStatic: () => void,
  alternateBuffer: boolean,
  toggleVimEnabled: CommandContext['ui']['toggleVimEnabled'],
  toggleDebugProfiler: CommandContext['ui']['toggleDebugProfiler'],
): PresentationCommands {
  const clear = useCallback(() => {
    clearItems();
    if (!alternateBuffer) globalThis.console.clear();
    refreshStatic();
  }, [clearItems, refreshStatic, alternateBuffer]);
  return useMemo(
    () => ({
      aboutCommand: createAboutCommand(readAbout, addItem),
      clearCommand: createClearCommand(
        bindClearSession(endSession, startNewSession, startSession),
        setDebugMessage,
        addItem,
        updateHistoryTokenCount,
        clear,
      ),
      initCommand: createInitCommand(targetDirectory, addItem),
      vimCommand: createVimCommand(toggleVimEnabled),
      uiProfileCommand: createUiProfileCommand(toggleDebugProfiler),
    }),
    [
      readAbout,
      targetDirectory,
      endSession,
      startNewSession,
      startSession,
      addItem,
      setDebugMessage,
      updateHistoryTokenCount,
      clear,
      toggleVimEnabled,
      toggleDebugProfiler,
    ],
  );
}
