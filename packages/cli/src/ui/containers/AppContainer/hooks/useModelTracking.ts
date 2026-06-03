/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { Config } from '@vybestack/llxprt-code-core';

interface RuntimeSettingsServiceBoundary {
  getDiagnosticsData?: () => Promise<{ model?: string | null } | null>;
  on?: (eventName: 'settings-changed', listener: () => void) => void;
  off?: (eventName: 'settings-changed', listener: () => void) => void;
}

interface RuntimeConfigBoundary {
  getSettingsService?: () => RuntimeSettingsServiceBoundary | null | undefined;
}

function getRuntimeSettingsService(
  config: Config,
): RuntimeSettingsServiceBoundary | null {
  return (config as RuntimeConfigBoundary).getSettingsService?.() ?? null;
}

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

    const isCurrentRequest = (seq: number) => !disposed && seq === requestSeq;

    const updateModel = async () => {
      requestSeq += 1;
      const seq = requestSeq;
      const settingsService = getRuntimeSettingsService(config);

      // Try to get from SettingsService first (same as diagnostics does)
      if (settingsService?.getDiagnosticsData) {
        try {
          const diagnosticsData = await settingsService.getDiagnosticsData();
          if (!isCurrentRequest(seq)) {
            return;
          }

          const model = diagnosticsData?.model;
          if (model !== undefined && model !== null && model !== '') {
            setCurrentModel(model);
            return;
          }
        } catch {
          // Fall through to config
        }
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

    // Also listen for any changes if SettingsService is available
    const settingsService = getRuntimeSettingsService(config);
    if (settingsService?.on && settingsService.off) {
      settingsService.on('settings-changed', handleSettingsChanged);
      return () => {
        disposed = true;
        settingsService.off?.('settings-changed', handleSettingsChanged);
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
