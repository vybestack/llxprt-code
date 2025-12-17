/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RenderOptions } from 'ink';

type InkRenderOptionsConfig = {
  getScreenReader(): boolean;
};

type InkRenderOptionsSettings = {
  merged: {
    ui?: {
      useAlternateBuffer?: boolean;
      incrementalRendering?: boolean;
    };
  };
};

/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P04
 * @requirement REQ-456.4
 */
export const inkRenderOptions = (
  config: InkRenderOptionsConfig,
  settings: InkRenderOptionsSettings,
): RenderOptions => {
  const isScreenReaderEnabled = config.getScreenReader();
  const useAlternateBuffer =
    settings.merged.ui?.useAlternateBuffer === true && !isScreenReaderEnabled;
  const incrementalRendering =
    useAlternateBuffer && settings.merged.ui?.incrementalRendering !== false;

  return {
    exitOnCtrlC: false,
    patchConsole: false,
    isScreenReaderEnabled,
    alternateBuffer: useAlternateBuffer,
    incrementalRendering,
  };
};
