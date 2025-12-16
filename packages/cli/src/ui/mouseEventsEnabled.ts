/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RenderOptions } from 'ink';

type MouseEventsEnabledSettings = {
  merged: {
    ui?: {
      enableMouseEvents?: boolean;
    };
  };
};

export const isMouseEventsEnabled = (
  renderOptions: Pick<RenderOptions, 'alternateBuffer'>,
  settings: MouseEventsEnabledSettings,
): boolean =>
  renderOptions.alternateBuffer === true &&
  settings.merged.ui?.enableMouseEvents === true;
