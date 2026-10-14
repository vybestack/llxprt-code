/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { LoadedSettings } from '../../config/settings.js';
import type { SlashCommand } from '../commands/types.js';
import { createSetCommand } from '../commands/setCommand.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

export function useSetCommand(settings: LoadedSettings): SlashCommand {
  const api = useRuntimeApi();
  const enableFuzzyFiltering = settings.merged.enableFuzzyFiltering ?? true;
  return useMemo(
    () =>
      createSetCommand({
        getEphemeralSettings: () => api.getEphemeralSettings(),
        setEphemeralSetting: (key, value) =>
          api.setEphemeralSetting(key, value),
        getActiveModelParams: () => api.getActiveModelParams(),
        setActiveModelParam: (key, value) =>
          api.setActiveModelParam(key, value),
        clearActiveModelParam: (key) => api.clearActiveModelParam(key),
        isFuzzyFilteringEnabled: () => enableFuzzyFiltering,
      }),
    [api, enableFuzzyFiltering],
  );
}
