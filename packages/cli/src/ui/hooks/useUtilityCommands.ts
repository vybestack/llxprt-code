/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useMemo } from 'react';
import type { LoadedSettings } from '../../config/settings.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { useOAuthControl } from '../contexts/OAuthControlContext.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { createStatsCommand } from '../commands/statsCommand.js';
import { bindStatsCommand } from '../commands/statsCommandHost.js';
import { createLoggingCommand } from '../commands/loggingCommand.js';
import { bindLoggingCommand } from '../commands/loggingCommandHost.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
export function useUtilityCommands(
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
): Pick<BuiltinCommandOwners, 'statsCommand' | 'loggingCommand'> {
  const api = useRuntimeApi();
  const oauth = useOAuthControl();
  const startTime = useSessionStats().stats.sessionStartTime;
  const readStartTime = useCallback(() => startTime, [startTime]);
  const statsCommand = useMemo(
    () =>
      createStatsCommand(bindStatsCommand(api, oauth, readStartTime, addItem)),
    [api, oauth, readStartTime, addItem],
  );
  const loggingCommand = useMemo(
    () => createLoggingCommand(bindLoggingCommand(config, settings, addItem)),
    [config, settings, addItem],
  );
  return useMemo(
    () => ({ statsCommand, loggingCommand }),
    [statsCommand, loggingCommand],
  );
}
