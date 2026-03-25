/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { debugLogger, type Config } from '@vybestack/llxprt-code-core';

interface UseModelRuntimeSyncParams {
  config: Config;
  currentModel: string;
  setCurrentModel: (model: string) => void;
  getActiveModelName: () => string | undefined;
}

/**
 * @hook useModelRuntimeSync
 * @description Syncs UI model label with provider/runtime effective model
 * @inputs config, currentModel, setCurrentModel, getActiveModelName
 * @outputs void
 * @sideEffects 500ms polling interval while mounted
 * @cleanup Clears interval on unmount
 */
export function useModelRuntimeSync({
  config,
  currentModel,
  setCurrentModel,
  getActiveModelName,
}: UseModelRuntimeSyncParams): void {
  useEffect(() => {
    const checkModelChange = () => {
      const configModel = config.getModel();
      const providerModel = getActiveModelName();
      const effectiveModel =
        providerModel && providerModel.trim() !== ''
          ? providerModel
          : configModel;

      if (effectiveModel !== currentModel) {
        debugLogger.debug(
          `[Model Update] Updating footer from ${currentModel} to ${effectiveModel}`,
        );
        setCurrentModel(effectiveModel);
      }
    };

    checkModelChange();
    const interval = setInterval(checkModelChange, 500);

    return () => clearInterval(interval);
  }, [config, currentModel, getActiveModelName, setCurrentModel]);
}
