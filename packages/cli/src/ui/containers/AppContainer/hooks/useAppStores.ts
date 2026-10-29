/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef } from 'react';
import { useHasActiveProvider } from '../../../contexts/RuntimeContext.js';
import { useUnconfiguredProviderGuidance } from '../../../hooks/useUnconfiguredProviderGuidance.js';
import {
  createDialogStore,
  type DialogStore,
} from '../../../stores/dialog/dialogStore.js';
import {
  createDialogOpeners,
  type DialogOpeners,
} from '../../../stores/dialog/dialogOpeners.js';
import {
  createTerminalStore,
  type TerminalStore,
} from '../../../stores/terminal/terminalStore.js';
import {
  createTurnStore,
  type TurnStore,
} from '../../../stores/turn/turnStore.js';
import {
  createSettingsProfileStore,
  type SettingsProfileStore,
} from '../../../stores/settings/settingsStore.js';
import type { ContainerRuntimeReads } from '../../../cliCommandPorts.js';

export interface AppStores {
  dialogStore: DialogStore;
  terminalStore: TerminalStore;
  turnStore: TurnStore;
  settingsStore: SettingsProfileStore;
  dialogOpeners: DialogOpeners;
}

/** Stores retain identity across renders and StrictMode effect replay. */
export function useAppStores(
  runtime: Pick<ContainerRuntimeReads, 'getModel'>,
): AppStores {
  const storesRef = useRef<Omit<AppStores, 'dialogOpeners'> | null>(null);
  storesRef.current ??= {
    dialogStore: createDialogStore(),
    terminalStore: createTerminalStore(),
    turnStore: createTurnStore(),
    settingsStore: createSettingsProfileStore({
      currentModel: runtime.getModel(),
    }),
  };
  const stores = storesRef.current;
  const dialogOpeners = useMemo(
    () => createDialogOpeners(stores.dialogStore),
    [stores],
  );
  return { ...stores, dialogOpeners };
}

/** Guidance nudge for sessions without an active provider configured. */
export function useUnconfiguredGuidance(
  turnStore: TurnStore,
  dialogStore: DialogStore,
): void {
  const hasActiveProvider = useHasActiveProvider();
  useUnconfiguredProviderGuidance({
    hasActiveProvider: hasActiveProvider(),
    addItem: turnStore.commands.addItem,
    store: dialogStore,
  });
}
