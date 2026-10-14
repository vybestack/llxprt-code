/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getIdeInstaller } from '@vybestack/llxprt-code-core';
import { SettingScope, type LoadedSettings } from '../../config/settings.js';
import type { IdeState } from '../cliUiRuntime.js';
import type { IdeCommandOperations } from './ideCommand.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
export function bindIdeCommand(
  config: IdeState | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
): IdeCommandOperations | null {
  const client = config?.getIdeClient();
  if (!config || !client) return null;
  const currentIDE = client.getCurrentIde();
  return {
    currentIDE,
    getConnectionStatus: () => client.getConnectionStatus(),
    getDetectedIdeDisplayName: () => client.getDetectedIdeDisplayName(),
    getIdeContext: () => client.getIdeContext(),
    connect: () => client.connect(),
    setIdeMode: (value) => config.setIdeMode(value),
    setConnected: async () => {
      await config.setIdeClientConnected();
    },
    setDisconnected: async () => {
      await config.setIdeClientDisconnected();
    },
    persistMode: (value) =>
      settings.setValue(SettingScope.User, 'ui.ideMode', value),
    installCompanion: async (announce) => {
      if (!currentIDE) return undefined;
      const installer = getIdeInstaller(currentIDE);
      if (!installer) return undefined;
      announce();
      return installer.install();
    },
    addItem,
  };
}
