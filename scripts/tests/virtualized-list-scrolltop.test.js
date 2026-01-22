import { describe, it, expect } from 'vitest';
import React, { createRef } from 'react';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { act } from 'react';
import {
  VirtualizedList,
  SCROLL_TO_ITEM_END,
} from '../../packages/cli/src/ui/components/shared/VirtualizedList.js';

describe('VirtualizedList scrollTop', () => {
  it('clamps negative scrollTop when content fits', () => {
    const listRef = createRef();

    act(() => {
      render(
        React.createElement(
          Box,
          { height: 20, width: 40 },
          React.createElement(VirtualizedList, {
            ref: listRef,
            data: ['one'],
            renderItem: ({ item }) => React.createElement(Text, null, item),
            estimatedItemHeight: () => 1,
            keyExtractor: (item) => item,
            initialScrollIndex: SCROLL_TO_ITEM_END,
            initialScrollOffsetInIndex: SCROLL_TO_ITEM_END,
          }),
        ),
      );
    });

    expect(listRef.current).not.toBeNull();
    expect(listRef.current.getScrollState().scrollTop).toBe(0);
  });
});
