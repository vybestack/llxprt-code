/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useMemo } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../../config/settings.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';
import { createAboutCommand } from '../commands/aboutCommand.js';
import { bindAboutDetails } from '../commands/aboutCommandHost.js';
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
  agent: Agent | null,
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  api: RuntimeApi,
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
      aboutCommand: createAboutCommand(
        bindAboutDetails(api, config, settings),
        addItem,
      ),
      clearCommand: createClearCommand(
        bindClearSession(
          agent === null
            ? null
            : agent.hooks.triggerSessionEnd.bind(agent.hooks),
          async () => {
            if (agent === null) throw new Error('Session agent is unavailable');
            await agent.session.startNewSession();
          },
          async (reason) => {
            if (agent === null) throw new Error('Session agent is unavailable');
            return agent.hooks.triggerSessionStart(reason);
          },
        ),
        setDebugMessage,
        addItem,
        updateHistoryTokenCount,
        clear,
      ),
      initCommand: createInitCommand(config?.getTargetDir(), addItem),
      vimCommand: createVimCommand(toggleVimEnabled),
      uiProfileCommand: createUiProfileCommand(toggleDebugProfiler),
    }),
    [
      agent,
      config,
      settings,
      api,
      addItem,
      setDebugMessage,
      updateHistoryTokenCount,
      clear,
      toggleVimEnabled,
      toggleDebugProfiler,
    ],
  );
}
