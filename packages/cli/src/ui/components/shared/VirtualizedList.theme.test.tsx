/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { BoxProps } from 'ink';

const items = [{ id: 'one' }];
const renderItem = () => <></>;
const estimatedItemHeight = () => 1;
const keyExtractor = (item: { id: string }) => item.id;

const recordedBoxProps: Array<{ scrollbarThumbColor?: string }> = [];

const recordScrollbarThumb = (props: BoxProps) => {
  if (props.scrollbarThumbColor) {
    recordedBoxProps.push({
      scrollbarThumbColor: props.scrollbarThumbColor,
    });
  }
};

const InstrumentedBox = (props: BoxProps & { children?: React.ReactNode }) => {
  recordScrollbarThumb(props);
  return React.createElement('ink-box', props, props.children);
};

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    Box: InstrumentedBox,
    measureElement: vi.fn(() => ({ width: 10, height: 10 })),
  };
});

vi.mock('../../hooks/useBatchedScroll.js', () => ({
  useBatchedScroll: () => ({
    getScrollTop: () => 0,
    setPendingScrollTop: vi.fn(),
  }),
}));

const { Colors } = await import('../../colors.js');
const { VirtualizedList } = await import('./VirtualizedList.js');

describe('VirtualizedList theming', () => {
  beforeEach(() => {
    recordedBoxProps.length = 0;
  });

  it('defaults the scrollbar thumb color to the theme gray', () => {
    render(
      <VirtualizedList
        data={items}
        renderItem={renderItem}
        estimatedItemHeight={estimatedItemHeight}
        keyExtractor={keyExtractor}
      />,
    );

    const thumbEntry = recordedBoxProps.find(
      (entry) => entry.scrollbarThumbColor === Colors.Gray,
    );

    expect(thumbEntry).toBeDefined();
  });
});
