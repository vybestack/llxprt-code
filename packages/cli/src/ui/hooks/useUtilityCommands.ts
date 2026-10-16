/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useQuotaReader } from './useQuotaReader.js';

import { useCallback, useMemo } from 'react';
import { ConfigurationManager } from '@vybestack/llxprt-code-telemetry';
import { createDocsCommand } from '../commands/docsCommand.js';
import { createHelpCommand } from '../commands/helpCommand.js';
import { createQuitCommand } from '../commands/quitCommand.js';
import { createDebugCommand } from '../commands/debugCommands.js';
import { bindDebugCommand } from '../commands/debugCommandHost.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
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
): Pick<
  BuiltinCommandOwners,
  | 'statsCommand'
  | 'loggingCommand'
  | 'debugCommand'
  | 'docsCommand'
  | 'helpCommand'
  | 'quitCommand'
> {
  const readQuota = useQuotaReader();
  const oauth = useOAuthControl();
  const { stats } = useSessionStats();
  const startTime = stats.sessionStartTime;
  const readStartTime = useCallback(() => startTime, [startTime]);
  const statsCommand = useMemo(
    () =>
      createStatsCommand(
        bindStatsCommand(
          readQuota,
          () => oauth.isAvailable(),
          (logger) => oauth.discoverBuckets(logger),
          readStartTime,
          addItem,
        ),
      ),
    [readQuota, oauth, readStartTime, addItem],
  );
  const loggingCommand = useMemo(
    () => createLoggingCommand(bindLoggingCommand(config, settings, addItem)),
    [config, settings, addItem],
  );
  const debugCommand = useMemo(
    () =>
      createDebugCommand(bindDebugCommand(ConfigurationManager.getInstance())),
    [],
  );
  const docsCommand = useMemo(() => createDocsCommand(addItem), [addItem]);
  const helpCommand = useMemo(() => createHelpCommand(addItem), [addItem]);
  const quitCommand = useMemo(() => createQuitCommand(() => stats), [stats]);
  return useMemo(
    () => ({
      statsCommand,
      loggingCommand,
      debugCommand,
      docsCommand,
      helpCommand,
      quitCommand,
    }),
    [
      statsCommand,
      loggingCommand,
      debugCommand,
      docsCommand,
      helpCommand,
      quitCommand,
    ],
  );
}
