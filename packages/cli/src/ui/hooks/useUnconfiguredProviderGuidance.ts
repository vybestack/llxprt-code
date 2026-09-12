/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { selectDialogOpen } from '../stores/dialog/dialogStore.js';
import { useEffect, useRef } from 'react';
import { MessageType, type HistoryItemWithoutId } from '../types.js';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';

export interface UnconfiguredProviderGuidanceOptions {
  hasActiveProvider: boolean;
  addItem: (item: HistoryItemWithoutId, timestamp?: number) => number;
  store: DialogStore;
}

const UNCONFIGURED_GUIDANCE =
  'No provider is configured. Run /setup to choose a hosted provider, configure a local model, set up a custom compatible endpoint, or select an existing profile.';

export function useUnconfiguredProviderGuidance({
  hasActiveProvider,
  addItem,
  store,
}: UnconfiguredProviderGuidanceOptions): void {
  const isWelcomeDialogOpen = useStoreSelector(store.store, (state) =>
    selectDialogOpen(state, 'welcome'),
  );
  const guidanceShown = useRef(false);

  useEffect(() => {
    if (guidanceShown.current) {
      return;
    }
    if (isWelcomeDialogOpen) {
      return;
    }
    if (hasActiveProvider) {
      return;
    }
    guidanceShown.current = true;
    addItem(
      { type: MessageType.INFO, text: UNCONFIGURED_GUIDANCE },
      Date.now(),
    );
  }, [hasActiveProvider, addItem, isWelcomeDialogOpen]);
}
