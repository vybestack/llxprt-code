/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getIdeInstaller } from '@vybestack/llxprt-code-core';
import { SettingScope, type LoadedSettings } from '../../config/settings.js';
import type {
  WorkspaceIdeConnection,
  IdeContext,
} from '@vybestack/llxprt-code-core';
import type { IdeCommandOperations } from './ideCommand.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
export function bindIdeCommand(
  readConnection: () => WorkspaceIdeConnection,
  readContext: () => IdeContext | undefined,
  setIdeMode: (enabled: boolean) => void,
  connect: () => Promise<void>,
  disconnect: () => Promise<void>,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
): IdeCommandOperations | null {
  const connection = readConnection();
  if (!connection.available) return null;
  return {
    readConnection,
    readContext,
    setIdeMode,
    connect,
    disconnect,
    persistMode: (value) =>
      settings.setValue(SettingScope.User, 'ui.ideMode', value),
    installCompanion: async (announce) => {
      const currentIDE = readConnection().currentIde;
      if (!currentIDE) return undefined;
      const installer = getIdeInstaller(currentIDE);
      if (!installer) return undefined;
      announce();
      return installer.install();
    },
    addItem,
  };
}
