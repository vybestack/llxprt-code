/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { CliUiRuntime } from '../../../cliUiRuntime.js';

/**
 * @hook useModelTracking
 * @description Current model tracking from config
 * @inputs config
 * @outputs currentModel, setCurrentModel
 * @sideEffects Settings service subscription for model changes
 * @cleanup Unsubscribes from settings service on unmount
 * @strictMode Safe - subscription cleanup runs on both unmounts
 * @subscriptionStrategy Stable (subscription-based, not polling)
 */

export interface UseModelTrackingParams {
  config: CliUiRuntime;
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
  setCurrentModelLabel: (label: string) => void;
}

export function useModelTracking({
  config,
}: UseModelTrackingParams): UseModelTrackingResult {
  const [currentModel, setCurrentModel] = useState(config.getModel());
  // Seed the profile-aware label undefined so useModelRuntimeSync computes the
  // profile-qualified identity (e.g. `profileName:modelName`) on its initial
  // sync. Seeding it with the raw model would trip the hook's "already set"
  // guard and leave the footer showing the bare model until the next event.
  const [currentModelLabel, setCurrentModelLabel] = useState<
    string | undefined
  >(undefined);

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
          setCurrentModel(model);
          return;
        }
      } catch {
        // Fall through to config
      }

      // Otherwise use config (which is what diagnostics falls back to)
      if (isCurrentRequest(seq)) {
        setCurrentModel(config.getModel());
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
  }, [config]);

  return {
    currentModel,
    setCurrentModel,
    currentModelLabel,
    setCurrentModelLabel,
  };
}
