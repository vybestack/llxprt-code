/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RenderOptions } from 'ink';
import { createInkStdio } from '@vybestack/llxprt-code-core';

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

// Create stdio streams once so they are reused across calls.
const sharedStdio = createInkStdio();

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
    stdout: sharedStdio.stdout,
    stderr: sharedStdio.stderr,
    exitOnCtrlC: false,
    patchConsole: false,
    isScreenReaderEnabled,
    alternateBuffer: useAlternateBuffer,
    incrementalRendering,
  };
};
