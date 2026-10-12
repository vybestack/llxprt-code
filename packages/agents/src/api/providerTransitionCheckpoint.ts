/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

export function checkpointProviderTransition(
  settingsOwner: SessionSettingsOwner,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  restoreRetryHandlers: () => void,
): () => void {
  const state = settings.exportForStateSnapshot();
  const restoreOwnership = settingsOwner.checkpointDefaults();
  const restoreProviders = manager.checkpointProviderRegistry();
  return () => {
    restoreProviders();
    settings.restoreFromStateSnapshot(state);
    restoreRetryHandlers();
    restoreOwnership();
  };
}
