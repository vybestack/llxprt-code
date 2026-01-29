/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../../test-utils/render.js';
import { InfoMessage } from './InfoMessage.js';
import { describe, it, expect } from 'vitest';

describe('InfoMessage', () => {
  it('renders with the correct default prefix and text', () => {
    const { lastFrame } = renderWithProviders(
      <InfoMessage text="Just so you know" />,
    );
    const output = lastFrame();

    expect(output).toMatchSnapshot();
  });

  it('renders with a custom icon', () => {
    const { lastFrame } = renderWithProviders(
      <InfoMessage text="Custom icon test" icon="*" />,
    );
    const output = lastFrame();

    expect(output).toMatchSnapshot();
  });

  it('renders multiline info messages', () => {
    const message = 'Info line 1\nInfo line 2';
    const { lastFrame } = renderWithProviders(<InfoMessage text={message} />);
    const output = lastFrame();

    expect(output).toMatchSnapshot();
  });
});
