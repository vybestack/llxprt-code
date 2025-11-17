/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { KeypressProvider } from '../ui/contexts/KeypressContext.js';

export const renderWithProviders = (
  component: React.ReactElement,
  {
    kittyProtocolEnabled = true,
  }: {
    kittyProtocolEnabled?: boolean;
  } = {},
): ReturnType<typeof render> =>
  render(
    <KeypressProvider kittyProtocolEnabled={kittyProtocolEnabled}>
      {component}
    </KeypressProvider>,
  );
