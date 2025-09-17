/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { renderWithProviders } from '../../../test-utils/render.js';
import { WarningMessage } from './WarningMessage.js';

describe('WarningMessage', () => {
  it('renders the provided text', () => {
    const { getByText } = renderWithProviders(
      <WarningMessage text="memory warning" />,
    );
    expect(getByText('memory warning')).toBeTruthy();
  });
});
