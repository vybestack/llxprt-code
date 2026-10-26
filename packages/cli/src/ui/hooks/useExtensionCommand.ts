/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { HistoryItemWithoutId } from '../types.js';
import type { ExtensionUpdateAction } from '../state/extensions.js';
import { createExtensionsCommand } from '../commands/extensionsCommand.js';
import {
  bindExtensionsCommand,
  type ExtensionsCommandRuntime,
} from '../commands/extensionsCommandHost.js';

export function useExtensionCommand(
  runtime: ExtensionsCommandRuntime | null,
  addItem: UseHistoryManagerReturn['addItem'],
  setPendingItem: (item: HistoryItemWithoutId | null) => void,
  dispatchUpdate: (action: ExtensionUpdateAction) => void,
) {
  return useMemo(
    () =>
      createExtensionsCommand(
        bindExtensionsCommand(runtime, addItem, setPendingItem, dispatchUpdate),
      ),
    [runtime, addItem, setPendingItem, dispatchUpdate],
  );
}
