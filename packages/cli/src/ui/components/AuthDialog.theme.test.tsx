/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { LoadedSettings } from '../../config/settings.js';
import type { BoxProps } from 'ink';

const recordedBoxProps: Array<{ backgroundColor?: string }> = [];

const InstrumentedBox = (props: BoxProps & { children?: React.ReactNode }) => {
  recordedBoxProps.push({
    backgroundColor: props.backgroundColor,
  });
  return React.createElement('ink-box', props, props.children);
};

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    Box: InstrumentedBox,
  };
});

const { Colors } = await import('../colors.js');
const { AuthDialog } = await import('./AuthDialog.js');

describe('AuthDialog theming', () => {
  beforeEach(() => {
    recordedBoxProps.length = 0;
  });

  it('sets the background color from the active theme', () => {
    const settings = new LoadedSettings(
      { settings: { ui: { customThemes: {} }, mcpServers: {} }, path: '' },
      { settings: {}, path: '' },
      { settings: {}, path: '' },
      { settings: { ui: { customThemes: {} }, mcpServers: {} }, path: '' },
      true,
    );

    render(<AuthDialog onSelect={vi.fn()} settings={settings} />);

    const themedBox = recordedBoxProps.find(
      (entry) => entry.backgroundColor === Colors.Background,
    );

    expect(themedBox).toBeDefined();
  });
});
