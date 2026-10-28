/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  useClearActiveModelParam,
  useGetActiveModelParams,
  useGetEphemeralSettings,
  useSetActiveModelParam,
  useSetEphemeralSetting,
} from '../contexts/RuntimeContext.js';

import { useMemo } from 'react';
import type { LoadedSettings } from '../../config/settings.js';
import type { SlashCommand } from '../commands/types.js';
import { createSetCommand } from '../commands/setCommand.js';

export function useSetCommand(settings: LoadedSettings): SlashCommand {
  const apiClearActiveModelParam = useClearActiveModelParam();
  const apiGetActiveModelParams = useGetActiveModelParams();
  const apiGetEphemeralSettings = useGetEphemeralSettings();
  const apiSetActiveModelParam = useSetActiveModelParam();
  const apiSetEphemeralSetting = useSetEphemeralSetting();
  const enableFuzzyFiltering = settings.merged.enableFuzzyFiltering ?? true;
  return useMemo(
    () =>
      createSetCommand({
        getEphemeralSettings: () => apiGetEphemeralSettings(),
        setEphemeralSetting: (key, value) => apiSetEphemeralSetting(key, value),
        getActiveModelParams: () => apiGetActiveModelParams(),
        setActiveModelParam: (key, value) => apiSetActiveModelParam(key, value),
        clearActiveModelParam: (key) => apiClearActiveModelParam(key),
        isFuzzyFilteringEnabled: () => enableFuzzyFiltering,
      }),
    [
      apiClearActiveModelParam,
      apiGetActiveModelParams,
      apiGetEphemeralSettings,
      apiSetActiveModelParam,
      apiSetEphemeralSetting,
      enableFuzzyFiltering,
    ],
  );
}
