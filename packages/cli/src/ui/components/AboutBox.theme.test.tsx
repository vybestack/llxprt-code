/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
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
const { AboutBox } = await import('./AboutBox.js');

describe('AboutBox theming', () => {
  beforeEach(() => {
    recordedBoxProps.length = 0;
  });

  it('sets the background color from the active theme', () => {
    render(
      <AboutBox
        cliVersion="1.0.0"
        osVersion="test-os"
        sandboxEnv="test-sandbox"
        modelVersion="test-model"
        gcpProject=""
        keyfile=""
        key=""
        ideClient=""
        provider="test-provider"
        baseURL=""
      />,
    );

    const themedBox = recordedBoxProps.find(
      (entry) => entry.backgroundColor === Colors.Background,
    );

    expect(themedBox).toBeDefined();
  });
});
