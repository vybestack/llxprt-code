/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { loadSettings } from '../../config/settings.js';
import type { ExtensionCommandOperations } from './extensionsCommand.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { HistoryItemWithoutId } from '../types.js';
import type { ExtensionUpdateAction } from '../state/extensions.js';

export function bindExtensionsCommand(
  config: CliUiRuntime | null,
  addItem: UseHistoryManagerReturn['addItem'],
  setPendingItem: (item: HistoryItemWithoutId | null) => void,
  dispatchUpdate: (action: ExtensionUpdateAction) => void,
): ExtensionCommandOperations {
  return {
    list: () => config?.getExtensions() ?? [],
    isAdminDisabled: () =>
      loadSettings().merged.admin?.extensions?.enabled === false,
    restart:
      config?.restartExtension === undefined
        ? undefined
        : (extension) => config.restartExtension!(extension),
    install: async (source) => {
      const {
        inferInstallMetadata,
        installOrUpdateExtension,
        requestConsentNonInteractive,
      } = await import('../../config/extension.js');
      await installOrUpdateExtension(
        await inferInstallMetadata(source),
        requestConsentNonInteractive,
      );
    },
    uninstall: async (name) => {
      const { uninstallExtension } = await import('../../config/extension.js');
      await uninstallExtension(name, false);
    },
    addItem,
    setPendingItem,
    dispatchUpdate,
  };
}
