/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { getSettingsService, type Config } from '@vybestack/llxprt-code-core';

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
  config: Config;
}

export interface UseModelTrackingResult {
  currentModel: string;
  setCurrentModel: (model: string) => void;
}

export function useModelTracking({
  config,
}: UseModelTrackingParams): UseModelTrackingResult {
  const [currentModel, setCurrentModel] = useState(config.getModel());

  // Update currentModel when settings change - get it from the SAME place as diagnostics
  useEffect(() => {
    let disposed = false;
    let requestSeq = 0;

    const updateModel = async () => {
      const seq = ++requestSeq;
      const settingsService = getSettingsService();

      // Try to get from SettingsService first (same as diagnostics does)
      if (settingsService?.getDiagnosticsData) {
        try {
          const diagnosticsData = await settingsService.getDiagnosticsData();
          if (!disposed && seq === requestSeq) {
            if (diagnosticsData?.model) {
              setCurrentModel(diagnosticsData.model);
              return;
            }
          } else {
            return;
          }
        } catch {
          // Fall through to config
        }
      }

      // Otherwise use config (which is what diagnostics falls back to)
      if (!disposed && seq === requestSeq) {
        setCurrentModel(config.getModel());
      }
    };

    // Update immediately
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    updateModel();

    // Also listen for any changes if SettingsService is available
    const settingsService = getSettingsService();
    if (settingsService) {
      settingsService.on('settings-changed', updateModel);
      return () => {
        disposed = true;
        settingsService.off('settings-changed', updateModel);
      };
    }

    return () => {
      disposed = true;
    };
  }, [config]);

  return {
    currentModel,
    setCurrentModel,
  };
}
