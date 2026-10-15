/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../../config/settings.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { useOAuthControl } from '../contexts/OAuthControlContext.js';
import { createDiagnosticsCommand } from '../commands/diagnosticsCommand.js';
import { bindDiagnosticsReads } from '../commands/diagnosticsCommandHost.js';
import { createPerfCommand } from '../commands/perfCommand.js';
import { createCopyCommand } from '../commands/copyCommand.js';
import { createCompressCommand } from '../commands/compressCommand.js';
import { bindCompressCommand } from '../commands/compressCommandHost.js';
import { createDumpcontextCommand } from '../commands/dumpcontextCommand.js';
import { bindDumpcontextCommand } from '../commands/dumpcontextCommandHost.js';
import { bindRestoreCommand } from '../commands/restoreCommandHost.js';
import {
  bindCopyCommandClipboard,
  bindCopyCommandHistoryRead,
} from '../commands/copyCommandHost.js';

export function useHistoryCommandOwners(
  agent: Agent | null,
  config: CliUiRuntime | null,
  runtimeApi: ReturnType<typeof useRuntimeApi>,
  settings: LoadedSettings,
  oauthControl: ReturnType<typeof useOAuthControl>,
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  addItem: UseHistoryManagerReturn['addItem'],
): Pick<
  BuiltinCommandOwners,
  | 'copyCommand'
  | 'compressCommand'
  | 'dumpcontextCommand'
  | 'restoreCommand'
  | 'perfCommand'
  | 'diagnosticsCommand'
> {
  return useMemo(
    () => ({
      diagnosticsCommand: createDiagnosticsCommand(
        bindDiagnosticsReads(config, settings, agent, runtimeApi, oauthControl),
      ),
      perfCommand: createPerfCommand({
        snapshotCapability: config?.getPerfSnapshotCapability?.() ?? null,
        tokenUsageDir: config
          ? join(config.getProjectTempDir(), 'token-usage')
          : undefined,
        readHistory: () =>
          agent?.agentClient.getHistoryService()?.getRawHistory() ?? null,
      }),
      copyCommand: createCopyCommand(
        bindCopyCommandHistoryRead(
          () => agent?.agentClient.hasChatInitialized() ?? false,
          () => agent?.getHistory() ?? Promise.resolve([]),
        ),
        bindCopyCommandClipboard(),
      ),
      compressCommand: createCompressCommand(bindCompressCommand(agent)),
      dumpcontextCommand: createDumpcontextCommand(
        bindDumpcontextCommand({
          readMode: () => runtimeApi.getSessionSetting('dumpcontext'),
          writeMode: (mode) =>
            runtimeApi.setSessionSetting('dumpcontext', mode),
          readHistory: () => {
            const history = agent?.agentClient.getHistoryService();
            return history === undefined || history === null
              ? null
              : {
                  messages: history.getAll(),
                  chronology: history.getChronologyTrace(),
                };
          },
          readProvider: () => runtimeApi.getProviderDumpMetadata(),
          readOutputSettings: () => config?.getEphemeralSettings() ?? {},
          readRuntimeConfig: () => config,
        }),
      ),
      restoreCommand: bindRestoreCommand(
        config,
        agent,
        config?.getCheckpointingEnabled() === true
          ? config.checkpoints
          : undefined,
        () => settings.merged.enableFuzzyFiltering ?? true,
        loadHistory,
        addItem,
      ),
    }),
    [agent, config, runtimeApi, settings, oauthControl, loadHistory, addItem],
  );
}
