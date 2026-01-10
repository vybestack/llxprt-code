/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ScrollProvider } from '../../contexts/ScrollProvider.js';

const items = [{ id: 'one' }];
const renderItem = () => <></>;
const estimatedItemHeight = () => 1;
const keyExtractor = (item: { id: string }) => item.id;

const recordedVirtualizedListProps: Array<{ scrollbarThumbColor?: string }> =
  [];

const mockVirtualizedList = React.forwardRef(
  (props: { scrollbarThumbColor?: string }) => {
    recordedVirtualizedListProps.push({
      scrollbarThumbColor: props.scrollbarThumbColor,
    });
    return null;
  },
);

mockVirtualizedList.displayName = 'VirtualizedList';

vi.mock('./VirtualizedList.js', () => ({
  VirtualizedList: mockVirtualizedList,
  SCROLL_TO_ITEM_END: Number.MAX_SAFE_INTEGER,
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    measureElement: vi.fn(() => ({ width: 10, height: 10 })),
  };
});

const { Colors } = await import('../../colors.js');
const { ScrollableList } = await import('./ScrollableList.js');

describe('ScrollableList theming', () => {
  it('uses theme colors for the scrollbar thumb based on focus', () => {
    recordedVirtualizedListProps.length = 0;

    const renderList = (hasFocus: boolean) =>
      render(
        <ScrollProvider>
          <ScrollableList
            hasFocus={hasFocus}
            data={items}
            renderItem={renderItem}
            estimatedItemHeight={estimatedItemHeight}
            keyExtractor={keyExtractor}
          />
        </ScrollProvider>,
      );

    renderList(true);
    renderList(false);

    expect(recordedVirtualizedListProps).toContainEqual({
      scrollbarThumbColor: Colors.Foreground,
    });
    expect(recordedVirtualizedListProps).toContainEqual({
      scrollbarThumbColor: Colors.Gray,
    });
  });
});
