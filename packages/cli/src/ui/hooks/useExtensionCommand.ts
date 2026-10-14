/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { HistoryItemWithoutId } from '../types.js';
import type { ExtensionUpdateAction } from '../state/extensions.js';
import { createExtensionsCommand } from '../commands/extensionsCommand.js';
import { bindExtensionsCommand } from '../commands/extensionsCommandHost.js';

export function useExtensionCommand(
  config: CliUiRuntime | null,
  addItem: UseHistoryManagerReturn['addItem'],
  setPendingItem: (item: HistoryItemWithoutId | null) => void,
  dispatchUpdate: (action: ExtensionUpdateAction) => void,
) {
  return useMemo(
    () =>
      createExtensionsCommand(
        bindExtensionsCommand(config, addItem, setPendingItem, dispatchUpdate),
      ),
    [config, addItem, setPendingItem, dispatchUpdate],
  );
}
