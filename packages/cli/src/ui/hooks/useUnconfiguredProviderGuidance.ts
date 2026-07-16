/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { MessageType, type HistoryItemWithoutId } from '../types.js';

export interface UnconfiguredProviderGuidanceOptions {
  hasActiveProvider: boolean;
  addItem: (item: HistoryItemWithoutId, timestamp?: number) => number;
  isWelcomeDialogOpen: boolean;
}

const UNCONFIGURED_GUIDANCE =
  'No provider is configured. Run /setup to choose a hosted provider, configure a local model, set up a custom compatible endpoint, or select an existing profile.';

export function useUnconfiguredProviderGuidance({
  hasActiveProvider,
  addItem,
  isWelcomeDialogOpen,
}: UnconfiguredProviderGuidanceOptions): void {
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
