/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import { loadSettings } from '../../config/settings.js';
import type { ExtensionCommandOperations } from './extensionsCommand.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { HistoryItemWithoutId } from '../types.js';
import type { ExtensionUpdateAction } from '../state/extensions.js';

/**
 * The extension state and restart hook /extensions needs.
 */
export interface ExtensionsCommandRuntime {
  getExtensions(): LlxprtExtension[];
  readonly restartExtension?: (extension: LlxprtExtension) => Promise<void>;
}

export function bindExtensionsCommand(
  runtime: ExtensionsCommandRuntime | null,
  addItem: UseHistoryManagerReturn['addItem'],
  setPendingItem: (item: HistoryItemWithoutId | null) => void,
  dispatchUpdate: (action: ExtensionUpdateAction) => void,
): ExtensionCommandOperations {
  const restartExtension = runtime?.restartExtension;
  return {
    list: () => runtime?.getExtensions() ?? [],
    isAdminDisabled: () =>
      loadSettings().merged.admin?.extensions?.enabled === false,
    restart:
      restartExtension === undefined
        ? undefined
        : (extension) => restartExtension(extension),
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
