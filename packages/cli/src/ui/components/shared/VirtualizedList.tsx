/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { forwardRef, useImperativeHandle } from 'react';
import type React from 'react';
import { Box } from 'ink';
import { Colors } from '../../colors.js';

import {
  useVirtualizedListState,
  useVirtualizedListEffects,
  useImperativeCtx,
  useViewportAndRender,
  buildImperativeHandle,
} from './VirtualizedList.hooks.js';

import {
  type VirtualizedListProps,
  type VirtualizedListRef,
} from './VirtualizedList.types.js';

export { SCROLL_TO_ITEM_END } from './VirtualizedList.types.js';
export type { VirtualizedListRef } from './VirtualizedList.types.js';

function VirtualizedList<T>(
  props: VirtualizedListProps<T>,
  ref: React.Ref<VirtualizedListRef<T>>,
) {
  const {
    data,
    renderItem,
    estimatedItemHeight,
    keyExtractor,
    initialScrollIndex,
    initialScrollOffsetInIndex,
  } = props;

  const state = useVirtualizedListState(
    data,
    estimatedItemHeight,
    initialScrollIndex,
    initialScrollOffsetInIndex,
  );

  const { getScrollTop, setPendingScrollTop } = useVirtualizedListEffects(
    data,
    state.scrollTop,
    state.totalHeight,
    state.scrollableContainerHeight,
    state.scrollAnchor,
    state.isStickingToBottom,
    state.setIsStickingToBottom,
    state.setScrollAnchor,
    state.getAnchorForScrollTop,
    state.offsets,
    initialScrollIndex,
    initialScrollOffsetInIndex,
    state.containerHeight,
    state.scrollableContainerHeight,
    state.heights,
  );

  const { renderedItems, topSpacerHeight, bottomSpacerHeight } =
    useViewportAndRender(state, data, keyExtractor, renderItem);

  const imperativeCtx = useImperativeCtx(
    state,
    data,
    getScrollTop,
    setPendingScrollTop,
  );

  useImperativeHandle(
    ref,
    () =>
      buildImperativeHandle(
        imperativeCtx,
        state.setScrollAnchor,
        state.setIsStickingToBottom,
        state.getAnchorForScrollTop,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setScrollAnchor and setIsStickingToBottom are stable React state dispatchers
    [imperativeCtx, state.getAnchorForScrollTop],
  );

  return (
    <Box
      ref={state.containerRef}
      overflowY="scroll"
      overflowX="hidden"
      scrollTop={state.scrollTop}
      scrollbarThumbColor={props.scrollbarThumbColor ?? Colors.Gray}
      width="100%"
      height="100%"
      flexDirection="column"
      paddingRight={1}
    >
      <Box flexShrink={0} width="100%" flexDirection="column">
        <Box height={topSpacerHeight} flexShrink={0} />
        {renderedItems}
        <Box height={bottomSpacerHeight} flexShrink={0} />
      </Box>
    </Box>
  );
}

const VirtualizedListWithForwardRef = forwardRef(VirtualizedList) as <T>(
  props: VirtualizedListProps<T> & { ref?: React.Ref<VirtualizedListRef<T>> },
) => React.ReactElement;

export { VirtualizedListWithForwardRef as VirtualizedList };

(
  VirtualizedListWithForwardRef as unknown as { displayName?: string }
).displayName = 'VirtualizedList';
