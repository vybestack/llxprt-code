/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GetSessionSettingOperation,
  type SetSessionSettingOperation,
} from '../contexts/RuntimeContext.js';

import { useHistoryCommandOwners } from './useHistoryCommandOwners.js';

import type { DumpcontextOwnerBindings } from '../commands/dumpcontextCommandHost.js';
import type { DiagnosticsCommandReads } from '../commands/diagnosticsCommand.js';
import { bindDumpcontextCommand } from '../commands/dumpcontextCommandHost.js';
import { bindRestoreCommand } from '../commands/restoreCommandHost.js';
import {
  bindCopyCommandHistoryRead,
  bindCopyCommandClipboard,
} from '../commands/copyCommandHost.js';

import type { CliUiRuntime } from '../cliUiRuntime.js';
import { useMemo } from 'react';

import { join } from 'node:path';

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

import type { LoadedSettings } from '../../config/settings.js';

export function useHistoryRegistration(
  diagnostics: DiagnosticsCommandReads,
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  addItem: UseHistoryManagerReturn['addItem'],
  compress: Agent['compress'] | null,
  readRawHistory: Parameters<typeof useHistoryCommandOwners>[3],
  hasChatInitialized: () => boolean,
  readHistory: Parameters<typeof bindCopyCommandHistoryRead>[1],
  setHistory: Agent['setHistory'],
  readSetting: GetSessionSettingOperation,
  writeSetting: SetSessionSettingOperation,
  readDumpHistory: DumpcontextOwnerBindings['readHistory'],
  readDumpProvider: DumpcontextOwnerBindings['readProvider'],
) {
  const dumpcontext = useMemo(
    () =>
      bindDumpcontextCommand({
        readMode: () => readSetting('dumpcontext'),
        writeMode: (mode) => writeSetting('dumpcontext', mode),
        readHistory: readDumpHistory,
        readProvider: readDumpProvider,
        readOutputSettings: () => config?.getEphemeralSettings() ?? {},
        readRuntimeConfig: () => config,
      }),
    [readSetting, writeSetting, readDumpHistory, readDumpProvider, config],
  );
  return useHistoryCommandOwners(
    diagnostics,
    config?.getPerfSnapshotCapability?.() ?? null,
    config ? join(config.getProjectTempDir(), 'token-usage') : undefined,
    readRawHistory,
    useMemo(
      () => bindCopyCommandHistoryRead(hasChatInitialized, readHistory),
      [hasChatInitialized, readHistory],
    ),
    useMemo(() => bindCopyCommandClipboard(), []),
    compress,
    dumpcontext,
    useMemo(
      () =>
        bindRestoreCommand(
          config,
          setHistory,
          config?.getCheckpointingEnabled() === true
            ? config.checkpoints
            : undefined,
          () => settings.merged.enableFuzzyFiltering ?? true,
          loadHistory,
          addItem,
        ),
      [setHistory, config, settings, loadHistory, addItem],
    ),
  );
}

export interface RegisteredHistoryReads {
  compressHistory: Agent['compress'] | null;
  readRawHistory: Parameters<typeof useHistoryCommandOwners>[3];
  isHistoryInitialized: () => boolean;
  readHistory: Parameters<typeof bindCopyCommandHistoryRead>[1];
  replaceHistory: Agent['setHistory'];
  readDumpHistory: DumpcontextOwnerBindings['readHistory'];
}
