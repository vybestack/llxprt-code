/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import type React from 'react';
import { VirtualizedList, type VirtualizedListRef } from './VirtualizedList.js';
import { useScrollable } from '../../contexts/ScrollProvider.js';
import { Box, type DOMElement } from 'ink';
import { useKeypress, type Key } from '../../hooks/useKeypress.js';
import { keyMatchers, Command } from '../../keyMatchers.js';
import { useAnimatedScrollbar } from '../../hooks/useAnimatedScrollbar.js';

const ANIMATION_FRAME_DURATION_MS = 33;

type VirtualizedListProps<T> = {
  data: T[];
  renderItem: (info: { item: T; index: number }) => React.ReactElement;
  estimatedItemHeight: (index: number) => number;
  keyExtractor: (item: T, index: number) => string;
  initialScrollIndex?: number;
  initialScrollOffsetInIndex?: number;
};

interface ScrollableListProps<T> extends VirtualizedListProps<T> {
  hasFocus: boolean;
}

export type ScrollableListRef<T> = VirtualizedListRef<T>;

/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P05
 * @requirement REQ-456.4
 */
function ScrollableList<T>(
  props: ScrollableListProps<T>,
  ref: React.Ref<ScrollableListRef<T>>,
) {
  const { hasFocus } = props;
  const virtualizedListRef = useRef<VirtualizedListRef<T>>(null);
  const containerRef = useRef<DOMElement>(null);

  const smoothScrollState = useRef<{
    intervalId: NodeJS.Timeout | null;
    targetScrollTop: number;
  }>({
    intervalId: null,
    targetScrollTop: 0,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollBy: (delta) => virtualizedListRef.current?.scrollBy(delta),
      scrollTo: (offset) => virtualizedListRef.current?.scrollTo(offset),
      scrollToEnd: () => virtualizedListRef.current?.scrollToEnd(),
      scrollToIndex: (params) =>
        virtualizedListRef.current?.scrollToIndex(params),
      scrollToItem: (params) =>
        virtualizedListRef.current?.scrollToItem(params),
      getScrollIndex: () => virtualizedListRef.current?.getScrollIndex() ?? 0,
      getScrollState: () =>
        virtualizedListRef.current?.getScrollState() ?? {
          scrollTop: 0,
          scrollHeight: 0,
          innerHeight: 0,
        },
    }),
    [],
  );

  const getScrollState = useCallback(
    () =>
      virtualizedListRef.current?.getScrollState() ?? {
        scrollTop: 0,
        scrollHeight: 0,
        innerHeight: 0,
      },
    [],
  );

  const scrollBy = useCallback((delta: number) => {
    virtualizedListRef.current?.scrollBy(delta);
  }, []);

  const stopSmoothScroll = useCallback(() => {
    if (smoothScrollState.current.intervalId !== null) {
      clearInterval(smoothScrollState.current.intervalId);
      smoothScrollState.current.intervalId = null;
    }
  }, []);

  const smoothScrollTo = useCallback(
    (targetScrollTop: number) => {
      stopSmoothScroll();

      const scrollState = getScrollState();
      const startScrollTop = scrollState.scrollTop;
      const distance = targetScrollTop - startScrollTop;

      if (distance === 0) {
        return;
      }

      const duration = 200;
      const startTime = Date.now();

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease-in-out
        const easeProgress =
          progress < 0.5
            ? 2 * progress * progress
            : -1 + (4 - 2 * progress) * progress;

        const newScrollTop = startScrollTop + distance * easeProgress;
        virtualizedListRef.current?.scrollTo(newScrollTop);

        if (progress < 1) {
          smoothScrollState.current.intervalId = setTimeout(
            animate,
            ANIMATION_FRAME_DURATION_MS,
          );
        } else {
          smoothScrollState.current.intervalId = null;
        }
      };

      animate();
      smoothScrollState.current.targetScrollTop = targetScrollTop;
    },
    [getScrollState, stopSmoothScroll],
  );

  useEffect(() => () => stopSmoothScroll(), [stopSmoothScroll]);

  const { scrollbarColor, flashScrollbar, scrollByWithAnimation } =
    useAnimatedScrollbar(hasFocus, scrollBy);

  useKeypress(
    (key: Key) => {
      if (keyMatchers[Command.SCROLL_UP](key)) {
        stopSmoothScroll();
        scrollByWithAnimation(-1);
      } else if (keyMatchers[Command.SCROLL_DOWN](key)) {
        stopSmoothScroll();
        scrollByWithAnimation(1);
      } else if (
        keyMatchers[Command.PAGE_UP](key) ||
        keyMatchers[Command.PAGE_DOWN](key)
      ) {
        const direction = keyMatchers[Command.PAGE_UP](key) ? -1 : 1;
        const scrollState = getScrollState();
        const current =
          smoothScrollState.current.intervalId !== null
            ? smoothScrollState.current.targetScrollTop
            : scrollState.scrollTop;
        const innerHeight = scrollState.innerHeight;
        smoothScrollTo(current + direction * innerHeight);
        flashScrollbar();
      } else if (keyMatchers[Command.SCROLL_HOME](key)) {
        smoothScrollTo(0);
        flashScrollbar();
      } else if (keyMatchers[Command.SCROLL_END](key)) {
        // Resolve SCROLL_TO_ITEM_END to actual max scrollTop for animation
        const scrollState = getScrollState();
        const maxScrollTop = Math.max(
          scrollState.scrollHeight - scrollState.innerHeight,
          0,
        );
        smoothScrollTo(maxScrollTop);
        flashScrollbar();
      }
    },
    { isActive: hasFocus },
  );

  const hasFocusCallback = useCallback(() => hasFocus, [hasFocus]);

  const scrollableEntry = useMemo(
    () => ({
      ref: containerRef,
      getScrollState,
      scrollBy,
      scrollTo: (scrollTop: number) =>
        virtualizedListRef.current?.scrollTo(scrollTop),
      hasFocus: hasFocusCallback,
      flashScrollbar,
    }),
    [getScrollState, hasFocusCallback, flashScrollbar, scrollBy],
  );

  useScrollable(scrollableEntry, hasFocus);

  return (
    <Box
      ref={containerRef}
      flexGrow={1}
      flexShrink={1}
      flexDirection="column"
      overflow="hidden"
    >
      <VirtualizedList
        ref={virtualizedListRef}
        {...props}
        scrollbarThumbColor={scrollbarColor}
      />
    </Box>
  );
}

const ScrollableListWithForwardRef = forwardRef(ScrollableList) as <T>(
  props: ScrollableListProps<T> & { ref?: React.Ref<ScrollableListRef<T>> },
) => React.ReactElement;

export { ScrollableListWithForwardRef as ScrollableList };
