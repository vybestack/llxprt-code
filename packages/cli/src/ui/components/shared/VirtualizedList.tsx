/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  useState,
  useRef,
  useLayoutEffect,
  forwardRef,
  useImperativeHandle,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import type React from 'react';
import { useBatchedScroll } from '../../hooks/useBatchedScroll.js';
import { type DOMElement, measureElement, Box } from 'ink';

export const SCROLL_TO_ITEM_END = Number.MAX_SAFE_INTEGER;

type VirtualizedListProps<T> = {
  data: T[];
  renderItem: (info: { item: T; index: number }) => React.ReactElement;
  estimatedItemHeight: (index: number) => number;
  keyExtractor: (item: T, index: number) => string;
  initialScrollIndex?: number;
  initialScrollOffsetInIndex?: number;
  scrollbarThumbColor?: string;
};

export type VirtualizedListRef<T> = {
  scrollBy: (delta: number) => void;
  scrollTo: (offset: number) => void;
  scrollToEnd: () => void;
  scrollToIndex: (params: {
    index: number;
    viewOffset?: number;
    viewPosition?: number;
  }) => void;
  scrollToItem: (params: {
    item: T;
    viewOffset?: number;
    viewPosition?: number;
  }) => void;
  getScrollIndex: () => number;
  getScrollState: () => {
    scrollTop: number;
    scrollHeight: number;
    innerHeight: number;
  };
};

function findLastIndex<T>(
  array: T[],
  predicate: (value: T, index: number, obj: T[]) => unknown,
): number {
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i], i, array)) {
      return i;
    }
  }
  return -1;
}

/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P05
 * @requirement REQ-456.4
 */
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
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const [scrollAnchor, setScrollAnchor] = useState(() => {
    const scrollToEnd =
      initialScrollIndex === SCROLL_TO_ITEM_END ||
      (typeof initialScrollIndex === 'number' &&
        initialScrollIndex >= data.length - 1 &&
        initialScrollOffsetInIndex === SCROLL_TO_ITEM_END);

    if (scrollToEnd) {
      return {
        index: data.length > 0 ? data.length - 1 : 0,
        offset: SCROLL_TO_ITEM_END,
      };
    }

    if (typeof initialScrollIndex === 'number') {
      return {
        index: Math.max(0, Math.min(data.length - 1, initialScrollIndex)),
        offset: initialScrollOffsetInIndex ?? 0,
      };
    }

    return { index: 0, offset: 0 };
  });
  const [isStickingToBottom, setIsStickingToBottom] = useState(() => {
    const scrollToEnd =
      initialScrollIndex === SCROLL_TO_ITEM_END ||
      (typeof initialScrollIndex === 'number' &&
        initialScrollIndex >= data.length - 1 &&
        initialScrollOffsetInIndex === SCROLL_TO_ITEM_END);
    return scrollToEnd;
  });
  const containerRef = useRef<DOMElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const itemRefs = useRef<Array<DOMElement | null>>([]);
  const [heights, setHeights] = useState<number[]>([]);
  const isInitialScrollSet = useRef(false);

  const { totalHeight, offsets } = useMemo(() => {
    const offsets: number[] = [0];
    let totalHeight = 0;
    for (let i = 0; i < data.length; i++) {
      const height = heights[i] ?? estimatedItemHeight(i);
      totalHeight += height;
      offsets.push(totalHeight);
    }
    return { totalHeight, offsets };
  }, [heights, data, estimatedItemHeight]);

  useEffect(() => {
    setHeights((prevHeights) => {
      if (data.length === prevHeights.length) {
        return prevHeights;
      }

      const newHeights = [...prevHeights];
      if (data.length < prevHeights.length) {
        newHeights.length = data.length;
      } else {
        for (let i = prevHeights.length; i < data.length; i++) {
          newHeights[i] = estimatedItemHeight(i);
        }
      }
      return newHeights;
    });
  }, [data, estimatedItemHeight]);

  const startIndex = useMemo(() => {
    if (scrollAnchor.offset === SCROLL_TO_ITEM_END) {
      return data.length > 0 ? data.length - 1 : 0;
    }

    const offset = offsets[scrollAnchor.index];
    if (offset === undefined) {
      return 0;
    }

    const scrollTop = offset + scrollAnchor.offset;

    const index = findLastIndex(offsets, (offset) => offset <= scrollTop);
    return Math.max(0, index);
  }, [scrollAnchor, offsets, data.length]);

  const endIndex = useMemo(() => {
    const viewPortHeight = containerHeight;
    if (viewPortHeight <= 0) {
      return startIndex;
    }

    const scrollTop = offsets[startIndex] ?? 0;
    const visibleBottom = scrollTop + viewPortHeight;
    const index = findLastIndex(offsets, (offset) => offset <= visibleBottom);
    return Math.max(startIndex, Math.min(index, data.length - 1));
  }, [containerHeight, offsets, startIndex, data.length]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (containerRef.current) {
      const height = Math.round(measureElement(containerRef.current).height);
      if (containerHeight !== height) {
        setContainerHeight(height);
      }
    }

    let newHeights: number[] | null = null;
    for (let i = startIndex; i <= endIndex; i++) {
      const itemRef = itemRefs.current[i];
      if (itemRef) {
        const height = Math.round(measureElement(itemRef).height);
        if (height !== heights[i]) {
          if (!newHeights) {
            newHeights = [...heights];
          }
          newHeights[i] = height;
        }
      }
    }
    if (newHeights) {
      setHeights(newHeights);
    }
  });

  const scrollableContainerHeight = containerRef.current
    ? Math.round(measureElement(containerRef.current).height)
    : containerHeight;

  const getAnchorForScrollTop = useCallback(
    (
      scrollTop: number,
      offsets: number[],
    ): { index: number; offset: number } => {
      const index = findLastIndex(offsets, (offset) => offset <= scrollTop);
      if (index === -1) {
        return { index: 0, offset: 0 };
      }

      return { index, offset: scrollTop - offsets[index] };
    },
    [],
  );

  const scrollTop = useMemo(() => {
    const offset = offsets[scrollAnchor.index];
    if (typeof offset !== 'number') {
      return 0;
    }

    if (scrollAnchor.offset === SCROLL_TO_ITEM_END) {
      const itemHeight = heights[scrollAnchor.index] ?? 0;
      return offset + itemHeight - scrollableContainerHeight;
    }

    return offset + scrollAnchor.offset;
  }, [scrollAnchor, offsets, heights, scrollableContainerHeight]);

  const prevDataLength = useRef(data.length);
  const prevTotalHeight = useRef(totalHeight);
  const prevScrollTop = useRef(scrollTop);
  const prevContainerHeight = useRef(scrollableContainerHeight);

  useLayoutEffect(() => {
    const contentPreviouslyFit =
      prevTotalHeight.current <= prevContainerHeight.current;
    const wasScrolledToBottomPixels =
      prevScrollTop.current >=
      prevTotalHeight.current - prevContainerHeight.current - 1;
    const wasAtBottom = contentPreviouslyFit || wasScrolledToBottomPixels;

    if (wasAtBottom && scrollTop >= prevScrollTop.current) {
      setIsStickingToBottom(true);
    }

    const listGrew = data.length > prevDataLength.current;
    const containerChanged =
      prevContainerHeight.current !== scrollableContainerHeight;

    if (
      (listGrew && (isStickingToBottom || wasAtBottom)) ||
      (isStickingToBottom && containerChanged)
    ) {
      setScrollAnchor({
        index: data.length > 0 ? data.length - 1 : 0,
        offset: SCROLL_TO_ITEM_END,
      });
      if (!isStickingToBottom) {
        setIsStickingToBottom(true);
      }
    } else if (
      (scrollAnchor.index >= data.length ||
        scrollTop > totalHeight - scrollableContainerHeight) &&
      data.length > 0
    ) {
      const newScrollTop = Math.max(0, totalHeight - scrollableContainerHeight);
      setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
      setIsStickingToBottom(true);
    }

    prevDataLength.current = data.length;
    prevTotalHeight.current = totalHeight;
    prevScrollTop.current = scrollTop;
    prevContainerHeight.current = scrollableContainerHeight;
  }, [
    data.length,
    scrollTop,
    totalHeight,
    scrollableContainerHeight,
    isStickingToBottom,
    scrollAnchor.index,
    getAnchorForScrollTop,
    offsets,
  ]);

  const { getScrollTop, setPendingScrollTop } = useBatchedScroll(scrollTop);

  const overscan = useMemo(() => {
    const viewportHeight = containerHeight;
    if (viewportHeight <= 0) {
      return 0;
    }
    return Math.max(10, viewportHeight);
  }, [containerHeight]);

  const overscannedStartIndex = Math.max(
    0,
    findLastIndex(offsets, (offset) => offset <= scrollTop - overscan),
  );

  const overscannedEndIndex = Math.min(
    data.length - 1,
    findLastIndex(
      offsets,
      (offset) => offset <= scrollTop + containerHeight + overscan,
    ),
  );

  const renderedItems = useMemo(() => {
    const items: React.ReactElement[] = [];
    for (let i = overscannedStartIndex; i <= overscannedEndIndex; i++) {
      const item = data[i];
      if (item === undefined) {
        continue;
      }
      items.push(
        <Box
          key={keyExtractor(item, i)}
          ref={(ref) => {
            itemRefs.current[i] = ref;
          }}
          flexShrink={0}
          flexDirection="column"
          width="100%"
        >
          {renderItem({ item, index: i })}
        </Box>,
      );
    }
    return items;
  }, [
    data,
    overscannedStartIndex,
    overscannedEndIndex,
    keyExtractor,
    renderItem,
  ]);

  const topSpacerHeight = offsets[overscannedStartIndex] ?? 0;
  const bottomSpacerHeight =
    totalHeight - (offsets[overscannedEndIndex + 1] ?? totalHeight);

  useLayoutEffect(() => {
    if (isInitialScrollSet.current) {
      return;
    }
    isInitialScrollSet.current = true;
    if (scrollAnchor.offset === SCROLL_TO_ITEM_END) {
      setScrollAnchor({
        index: data.length > 0 ? data.length - 1 : 0,
        offset: SCROLL_TO_ITEM_END,
      });
    }
  }, [scrollAnchor.offset, data.length]);

  useImperativeHandle(
    ref,
    () => ({
      scrollBy: (delta: number) => {
        setIsStickingToBottom(false);
        const newScrollTop = Math.max(
          0,
          Math.min(
            totalHeight - scrollableContainerHeight,
            getScrollTop() + delta,
          ),
        );
        setPendingScrollTop(newScrollTop);
        setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
      },
      scrollTo: (offset: number) => {
        setIsStickingToBottom(false);
        if (offset === SCROLL_TO_ITEM_END) {
          setScrollAnchor({
            index: data.length > 0 ? data.length - 1 : 0,
            offset: SCROLL_TO_ITEM_END,
          });
          setIsStickingToBottom(true);
          return;
        }

        const newScrollTop = Math.max(
          0,
          Math.min(totalHeight - scrollableContainerHeight, offset),
        );
        setPendingScrollTop(newScrollTop);
        setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
      },
      scrollToEnd: () => {
        setScrollAnchor({
          index: data.length > 0 ? data.length - 1 : 0,
          offset: SCROLL_TO_ITEM_END,
        });
        setIsStickingToBottom(true);
      },
      scrollToIndex: ({
        index,
        viewOffset = 0,
        viewPosition = 0,
      }: {
        index: number;
        viewOffset?: number;
        viewPosition?: number;
      }) => {
        setIsStickingToBottom(false);
        const offset = offsets[index];
        if (offset !== undefined) {
          const newScrollTop = Math.max(
            0,
            Math.min(
              totalHeight - scrollableContainerHeight,
              offset - viewPosition * scrollableContainerHeight + viewOffset,
            ),
          );
          setPendingScrollTop(newScrollTop);
          setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
        }
      },
      scrollToItem: ({
        item,
        viewOffset = 0,
        viewPosition = 0,
      }: {
        item: T;
        viewOffset?: number;
        viewPosition?: number;
      }) => {
        setIsStickingToBottom(false);
        const index = data.indexOf(item);
        if (index !== -1) {
          const offset = offsets[index];
          if (offset !== undefined) {
            const newScrollTop = Math.max(
              0,
              Math.min(
                totalHeight - scrollableContainerHeight,
                offset - viewPosition * scrollableContainerHeight + viewOffset,
              ),
            );
            setPendingScrollTop(newScrollTop);
            setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
          }
        }
      },
      getScrollIndex: () => scrollAnchor.index,
      getScrollState: () => ({
        scrollTop: getScrollTop(),
        scrollHeight: totalHeight,
        innerHeight: containerHeight,
      }),
    }),
    [
      offsets,
      scrollAnchor,
      totalHeight,
      getAnchorForScrollTop,
      data,
      scrollableContainerHeight,
      getScrollTop,
      setPendingScrollTop,
      containerHeight,
    ],
  );

  return (
    <Box
      ref={containerRef}
      overflowY="scroll"
      overflowX="hidden"
      scrollTop={scrollTop}
      scrollbarThumbColor={props.scrollbarThumbColor ?? 'gray'}
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

VirtualizedList.displayName = 'VirtualizedList';
