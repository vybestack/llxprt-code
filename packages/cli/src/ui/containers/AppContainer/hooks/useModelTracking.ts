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
    const updateModel = (): void => {
      if (!disposed) settingsStore.commands.setCurrentModel(config.getModel());
    };
    updateModel();
    const stop = config.subscribeModelSelection(updateModel);
    return () => {
      disposed = true;
      stop();
    };
  }, [config, settingsStore]);

  return {
    currentModel,
    setCurrentModel: settingsStore.commands.setCurrentModel,
    currentModelLabel,
    setCurrentModelLabel: settingsStore.commands.setCurrentModelLabel,
  };
}
