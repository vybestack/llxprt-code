/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import type { CliUiRuntime } from '../../../cliUiRuntime.js';
import type { SettingsProfileStore } from '../../../stores/settings/settingsStore.js';
import { useStoreSelector } from '../../../stores/useStoreSelector.js';

/**
 * @hook useModelTracking
 * @description Current model tracking from config, mirrored into the
 * settings/profile store
 * @inputs config, settingsStore
 * @outputs currentModel, setCurrentModel, currentModelLabel, setCurrentModelLabel
 * @sideEffects Settings service subscription for model changes
 * @cleanup Unsubscribes from settings service on unmount
 * @strictMode Safe - subscription cleanup runs on both unmounts
 * @subscriptionStrategy Stable (subscription-based, not polling)
 */

export interface UseModelTrackingParams {
  config: CliUiRuntime;
  settingsStore: SettingsProfileStore;
}

export interface UseModelTrackingResult {
  currentModel: string;
  setCurrentModel: (model: string) => void;
  /**
   * Profile-aware display label for the footer. Reflects profile/provider/model
   * identity so the footer updates even when the raw model string is unchanged.
   * `undefined` until useModelRuntimeSync computes the first identity.
   */
  currentModelLabel: string | undefined;
  setCurrentModelLabel: (label: string | undefined) => void;
}

export function useModelTracking({
  config,
  settingsStore,
}: UseModelTrackingParams): UseModelTrackingResult {
  const currentModel = useStoreSelector(
    settingsStore.store,
    (s) => s.currentModel,
  );
  const currentModelLabel = useStoreSelector(
    settingsStore.store,
    (s) => s.currentModelLabel,
  );

  // Update currentModel when settings change - get it from the SAME place as diagnostics
  useEffect(() => {
    let disposed = false;
    let requestSeq = 0;
    const settingsService = config.getSettingsService();

    const isCurrentRequest = (seq: number) => !disposed && seq === requestSeq;

    const updateModel = async () => {
      requestSeq += 1;
      const seq = requestSeq;

      // Try to get from SettingsService first (same as diagnostics does)
      try {
        const diagnosticsData = await settingsService.getDiagnosticsData();
        if (!isCurrentRequest(seq)) {
          return;
        }

        const model = diagnosticsData.model;
        if (typeof model === 'string' && model !== '') {
          settingsStore.commands.setCurrentModel(model);
          return;
        }
      } catch {
        // Fall through to config
      }

      // Otherwise use config (which is what diagnostics falls back to)
      if (isCurrentRequest(seq)) {
        settingsStore.commands.setCurrentModel(config.getModel());
      }
    };

    const handleSettingsChanged = () => {
      void updateModel();
    };

    // Update immediately
    void updateModel();

    // Also listen for settings changes.
    settingsService.on('settings-changed', handleSettingsChanged);
    return () => {
      disposed = true;
      settingsService.off('settings-changed', handleSettingsChanged);
    };
  }, [config, settingsStore]);

  return {
    currentModel,
    setCurrentModel: settingsStore.commands.setCurrentModel,
    currentModelLabel,
    setCurrentModelLabel: settingsStore.commands.setCurrentModelLabel,
  };
}
