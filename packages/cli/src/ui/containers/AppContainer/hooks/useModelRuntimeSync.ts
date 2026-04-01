/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { debugLogger, type Config } from '@vybestack/llxprt-code-core';

interface UseModelRuntimeSyncParams {
  config: Config;
  currentModel: string;
  setCurrentModel: (model: string) => void;
  getActiveModelName: () => string | undefined;
  contextLimit?: number;
  setContextLimit: (limit: number | undefined) => void;
}

export function useModelRuntimeSync({
  config,
  currentModel,
  setCurrentModel,
  getActiveModelName,
  contextLimit,
  setContextLimit,
}: UseModelRuntimeSyncParams): void {
  const contextLimitRef = useRef(contextLimit);
  contextLimitRef.current = contextLimit;

  useEffect(() => {
    const checkModelChange = () => {
      const configModel = config.getModel();
      const providerModel = getActiveModelName();
      const trimmed = providerModel?.trim();
      const effectiveModel = trimmed && trimmed !== '' ? trimmed : configModel;

      if (effectiveModel !== currentModel) {
        debugLogger.debug(
          `[Model Update] Updating footer from ${currentModel} to ${effectiveModel}`,
        );
        setCurrentModel(effectiveModel);
      }

      const currentContextLimit = config.getEphemeralSetting(
        'context-limit',
      ) as number | undefined;
      if (currentContextLimit !== contextLimitRef.current) {
        setContextLimit(currentContextLimit);
      }
    };

    checkModelChange();
    const interval = setInterval(checkModelChange, 500);

    return () => clearInterval(interval);
  }, [
    config,
    currentModel,
    getActiveModelName,
    setCurrentModel,
    setContextLimit,
  ]);
}
