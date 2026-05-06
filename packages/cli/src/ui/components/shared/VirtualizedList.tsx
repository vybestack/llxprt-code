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
import { Colors } from '../../colors.js';

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
    // eslint-disable-next-line no-extra-boolean-cast -- Preserve old JS truthiness for predicate return values
    if (Boolean(predicate(array[i], i, array))) {
      return i;
    }
  }
  return -1;
}

function getOffsetAt(offsets: number[], index: number): number | undefined {
  return offsets[index];
}

function clampScrollTop(
  scrollTop: number,
  totalHeight: number,
  scrollableContainerHeight: number,
): number {
  return Math.max(
    0,
    Math.min(totalHeight - scrollableContainerHeight, scrollTop),
  );
}

function isScrollToEndConfig(
  initialScrollIndex: number | undefined,
  initialScrollOffsetInIndex: number | undefined,
  dataLength: number,
): boolean {
  return (
    initialScrollIndex === SCROLL_TO_ITEM_END ||
    (typeof initialScrollIndex === 'number' &&
      initialScrollIndex >= dataLength - 1 &&
      initialScrollOffsetInIndex === SCROLL_TO_ITEM_END)
  );
}

function useScrollAnchor<T>(
  data: T[],
  initialScrollIndex: number | undefined,
  initialScrollOffsetInIndex: number | undefined,
) {
  const [scrollAnchor, setScrollAnchor] = useState(() => {
    if (
      isScrollToEndConfig(
        initialScrollIndex,
        initialScrollOffsetInIndex,
        data.length,
      )
    ) {
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

  const [isStickingToBottom, setIsStickingToBottom] = useState(() =>
    isScrollToEndConfig(
      initialScrollIndex,
      initialScrollOffsetInIndex,
      data.length,
    ),
  );

  return {
    scrollAnchor,
    setScrollAnchor,
    isStickingToBottom,
    setIsStickingToBottom,
  };
}

function useItemHeights<T>(
  data: T[],
  estimatedItemHeight: (index: number) => number,
) {
  const [heights, setHeights] = useState<number[]>([]);

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

  return { heights, setHeights };
}

function useComputedLayout<T>(
  data: T[],
  heights: number[],
  estimatedItemHeight: (index: number) => number,
) {
  return useMemo(() => {
    const offsets: number[] = [0];
    let totalHeight = 0;
    for (let i = 0; i < data.length; i++) {
      const height = heights[i] ?? estimatedItemHeight(i);
      totalHeight += height;
      offsets.push(totalHeight);
    }
    return { totalHeight, offsets };
  }, [heights, data, estimatedItemHeight]);
}

function computeScrollTop(
  scrollAnchor: { index: number; offset: number },
  offsets: number[],
  heights: number[],
  scrollableContainerHeight: number,
  totalHeight: number,
): number {
  const offset = offsets[scrollAnchor.index];
  if (typeof offset !== 'number') {
    return 0;
  }

  const maxScrollTop = Math.max(0, totalHeight - scrollableContainerHeight);
  if (scrollAnchor.offset === SCROLL_TO_ITEM_END) {
    const itemHeight = heights[scrollAnchor.index] ?? 0;
    const scrollToEnd = offset + itemHeight - scrollableContainerHeight;
    return Math.max(0, Math.min(maxScrollTop, scrollToEnd));
  }

  const absolute = offset + scrollAnchor.offset;
  return Math.max(0, Math.min(maxScrollTop, absolute));
}

function useStickToBottom(
  data: { length: number },
  scrollTop: number,
  totalHeight: number,
  scrollableContainerHeight: number,
  scrollAnchor: { index: number; offset: number },
  isStickingToBottom: boolean,
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>,
  setScrollAnchor: React.Dispatch<
    React.SetStateAction<{ index: number; offset: number }>
  >,
  getAnchorForScrollTop: (
    scrollTop: number,
    offsets: number[],
  ) => { index: number; offset: number },
  offsets: number[],
) {
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

    const shouldStickToBottom = isStickingToBottom || wasAtBottom;
    const shouldScrollToBottom =
      (listGrew && shouldStickToBottom) ||
      (isStickingToBottom && containerChanged);

    if (shouldScrollToBottom) {
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
    } else if (data.length === 0) {
      setScrollAnchor({ index: 0, offset: 0 });
    }

    prevDataLength.current = data.length;
    prevTotalHeight.current = totalHeight;
    prevScrollTop.current = scrollTop;
    prevContainerHeight.current = scrollableContainerHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setScrollAnchor and setIsStickingToBottom are stable React state dispatchers
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
}

function useInitialScroll<T>(
  initialScrollIndex: number | undefined,
  initialScrollOffsetInIndex: number | undefined,
  data: T[],
  offsets: number[],
  totalHeight: number,
  containerHeight: number,
  scrollableContainerHeight: number,
  heights: number[],
  setScrollAnchor: React.Dispatch<
    React.SetStateAction<{ index: number; offset: number }>
  >,
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>,
  getAnchorForScrollTop: (
    scrollTop: number,
    offsets: number[],
  ) => { index: number; offset: number },
) {
  const isInitialScrollSet = useRef(false);

  useLayoutEffect(() => {
    if (
      isInitialScrollSet.current ||
      offsets.length <= 1 ||
      totalHeight <= 0 ||
      containerHeight <= 0
    ) {
      return;
    }

    if (typeof initialScrollIndex === 'number') {
      const scrollToEnd =
        initialScrollIndex === SCROLL_TO_ITEM_END ||
        (initialScrollIndex >= data.length - 1 &&
          initialScrollOffsetInIndex === SCROLL_TO_ITEM_END);

      if (scrollToEnd) {
        setScrollAnchor({
          index: data.length - 1,
          offset: SCROLL_TO_ITEM_END,
        });
        setIsStickingToBottom(true);
        isInitialScrollSet.current = true;
        return;
      }

      const index = Math.max(0, Math.min(data.length - 1, initialScrollIndex));
      const offset = initialScrollOffsetInIndex ?? 0;
      const newScrollTop = (offsets[index] ?? 0) + offset;
      const clampedScrollTop = clampScrollTop(
        newScrollTop,
        totalHeight,
        scrollableContainerHeight,
      );

      setScrollAnchor(getAnchorForScrollTop(clampedScrollTop, offsets));
      isInitialScrollSet.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setScrollAnchor and setIsStickingToBottom are stable React state dispatchers
  }, [
    initialScrollIndex,
    initialScrollOffsetInIndex,
    offsets,
    totalHeight,
    containerHeight,
    getAnchorForScrollTop,
    data.length,
    heights,
    scrollableContainerHeight,
  ]);
}

function useMeasureItems(
  containerRef: React.RefObject<DOMElement | null>,
  containerHeight: number,
  setContainerHeight: (h: number) => void,
  itemRefs: React.RefObject<Array<DOMElement | null>>,
  heights: number[],
  setHeights: (h: number[] | ((prev: number[]) => number[])) => void,
  startIndex: number,
  endIndex: number,
) {
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
          newHeights ??= [...heights];
          newHeights[i] = height;
        }
      }
    }
    if (newHeights) {
      setHeights(newHeights);
    }
  });
}

function useRenderedItems<T>(
  data: T[],
  startIndex: number,
  endIndex: number,
  keyExtractor: (item: T, index: number) => string,
  renderItem: (info: { item: T; index: number }) => React.ReactElement,
  itemRefs: React.RefObject<Array<DOMElement | null>>,
): React.ReactElement[] {
  const renderedItems: React.ReactElement[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const item = data[i];
    if (item === undefined) {
      continue;
    }
    renderedItems.push(
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
  return renderedItems;
}

function applyScrollToOffset(
  offset: number,
  viewPosition: number,
  viewOffset: number,
  totalHeight: number,
  scrollableContainerHeight: number,
  setPendingScrollTop: (v: number) => void,
  setScrollAnchor: React.Dispatch<
    React.SetStateAction<{ index: number; offset: number }>
  >,
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>,
  getAnchorForScrollTop: (
    scrollTop: number,
    offsets: number[],
  ) => { index: number; offset: number },
  offsets: number[],
) {
  setIsStickingToBottom(false);
  const newScrollTop = clampScrollTop(
    offset - viewPosition * scrollableContainerHeight + viewOffset,
    totalHeight,
    scrollableContainerHeight,
  );
  setPendingScrollTop(newScrollTop);
  setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
}

function buildScrollMethods<T>(
  ctx: {
    offsets: number[];
    scrollAnchor: { index: number; offset: number };
    totalHeight: number;
    scrollableContainerHeight: number;
    data: T[];
    getScrollTop: () => number;
    setPendingScrollTop: (v: number) => void;
  },
  setScrollAnchor: React.Dispatch<
    React.SetStateAction<{ index: number; offset: number }>
  >,
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>,
  getAnchorForScrollTop: (
    scrollTop: number,
    offsets: number[],
  ) => { index: number; offset: number },
) {
  const {
    offsets,
    totalHeight,
    scrollableContainerHeight,
    getScrollTop,
    setPendingScrollTop,
    data,
  } = ctx;

  const scrollBy = (delta: number) => {
    if (delta < 0) {
      setIsStickingToBottom(false);
    }
    const newScrollTop = clampScrollTop(
      getScrollTop() + delta,
      totalHeight,
      scrollableContainerHeight,
    );
    setPendingScrollTop(newScrollTop);
    setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
  };

  const scrollTo = (offset: number) => {
    setIsStickingToBottom(false);
    const newScrollTop = clampScrollTop(
      offset,
      totalHeight,
      scrollableContainerHeight,
    );
    setPendingScrollTop(newScrollTop);
    setScrollAnchor(getAnchorForScrollTop(newScrollTop, offsets));
  };

  const scrollToEnd = () => {
    setIsStickingToBottom(true);
    if (data.length > 0) {
      setScrollAnchor({
        index: data.length - 1,
        offset: SCROLL_TO_ITEM_END,
      });
    }
  };

  return { scrollBy, scrollTo, scrollToEnd };
}

function buildIndexScrollMethods<T>(
  ctx: {
    offsets: number[];
    totalHeight: number;
    scrollableContainerHeight: number;
    data: T[];
    setPendingScrollTop: (v: number) => void;
  },
  setScrollAnchor: React.Dispatch<
    React.SetStateAction<{ index: number; offset: number }>
  >,
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>,
  getAnchorForScrollTop: (
    scrollTop: number,
    offsets: number[],
  ) => { index: number; offset: number },
) {
  const doScrollToOffset = (
    offset: number,
    viewPosition: number,
    viewOffset: number,
  ) => {
    applyScrollToOffset(
      offset,
      viewPosition,
      viewOffset,
      ctx.totalHeight,
      ctx.scrollableContainerHeight,
      ctx.setPendingScrollTop,
      setScrollAnchor,
      setIsStickingToBottom,
      getAnchorForScrollTop,
      ctx.offsets,
    );
  };

  const scrollToIndex = ({
    index,
    viewOffset = 0,
    viewPosition = 0,
  }: {
    index: number;
    viewOffset?: number;
    viewPosition?: number;
  }) => {
    const offset = getOffsetAt(ctx.offsets, index);
    if (offset !== undefined) {
      doScrollToOffset(offset, viewPosition, viewOffset);
    }
  };

  const scrollToItem = ({
    item,
    viewOffset = 0,
    viewPosition = 0,
  }: {
    item: T;
    viewOffset?: number;
    viewPosition?: number;
  }) => {
    const index = ctx.data.indexOf(item);
    if (index !== -1) {
      const offset = getOffsetAt(ctx.offsets, index);
      if (offset !== undefined) {
        doScrollToOffset(offset, viewPosition, viewOffset);
      }
    }
  };

  return { scrollToIndex, scrollToItem };
}

function buildImperativeHandle<T>(
  ctx: {
    offsets: number[];
    scrollAnchor: { index: number; offset: number };
    totalHeight: number;
    scrollableContainerHeight: number;
    data: T[];
    getScrollTop: () => number;
    setPendingScrollTop: (v: number) => void;
  },
  setScrollAnchor: React.Dispatch<
    React.SetStateAction<{ index: number; offset: number }>
  >,
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>,
  getAnchorForScrollTop: (
    scrollTop: number,
    offsets: number[],
  ) => { index: number; offset: number },
): VirtualizedListRef<T> {
  const { scrollBy, scrollTo, scrollToEnd } = buildScrollMethods(
    ctx,
    setScrollAnchor,
    setIsStickingToBottom,
    getAnchorForScrollTop,
  );

  const { scrollToIndex, scrollToItem } = buildIndexScrollMethods(
    ctx,
    setScrollAnchor,
    setIsStickingToBottom,
    getAnchorForScrollTop,
  );

  return {
    scrollBy,
    scrollTo,
    scrollToEnd,
    scrollToIndex,
    scrollToItem,
    getScrollIndex: () => ctx.scrollAnchor.index,
    getScrollState: () => ({
      scrollTop: ctx.getScrollTop(),
      scrollHeight: ctx.totalHeight,
      innerHeight: ctx.scrollableContainerHeight,
    }),
  };
}

/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P05
 * @requirement REQ-456.4
 */
function useViewportRange(
  scrollTop: number,
  offsets: number[],
  scrollableContainerHeight: number,
  dataLength: number,
): { startIndex: number; endIndex: number } {
  const startIndex = Math.max(
    0,
    findLastIndex(offsets, (offset) => offset <= scrollTop) - 1,
  );
  const endIndexOffset = offsets.findIndex(
    (offset) => offset > scrollTop + scrollableContainerHeight,
  );
  const endIndex =
    endIndexOffset === -1
      ? dataLength - 1
      : Math.min(dataLength - 1, endIndexOffset);
  return { startIndex, endIndex };
}

type VirtualizedListState = {
  scrollAnchor: { index: number; offset: number };
  setScrollAnchor: React.Dispatch<
    React.SetStateAction<{ index: number; offset: number }>
  >;
  isStickingToBottom: boolean;
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>;
  containerRef: React.RefObject<DOMElement | null>;
  containerHeight: number;
  setContainerHeight: (h: number) => void;
  itemRefs: React.RefObject<Array<DOMElement | null>>;
  heights: number[];
  setHeights: (h: number[] | ((prev: number[]) => number[])) => void;
  totalHeight: number;
  offsets: number[];
  scrollableContainerHeight: number;
  getAnchorForScrollTop: (
    scrollTop: number,
    offsets: number[],
  ) => { index: number; offset: number };
  scrollTop: number;
};

function useVirtualizedListState<T>(
  data: T[],
  estimatedItemHeight: (index: number) => number,
  initialScrollIndex: number | undefined,
  initialScrollOffsetInIndex: number | undefined,
): VirtualizedListState {
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const {
    scrollAnchor,
    setScrollAnchor,
    isStickingToBottom,
    setIsStickingToBottom,
  } = useScrollAnchor(data, initialScrollIndex, initialScrollOffsetInIndex);

  const containerRef = useRef<DOMElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const itemRefs = useRef<Array<DOMElement | null>>([]);

  const { heights, setHeights } = useItemHeights(data, estimatedItemHeight);

  const { totalHeight, offsets } = useComputedLayout(
    data,
    heights,
    estimatedItemHeight,
  );

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

  const scrollTop = useMemo(
    () =>
      computeScrollTop(
        scrollAnchor,
        offsets,
        heights,
        scrollableContainerHeight,
        totalHeight,
      ),
    [scrollAnchor, offsets, heights, scrollableContainerHeight, totalHeight],
  );

  return {
    scrollAnchor,
    setScrollAnchor,
    isStickingToBottom,
    setIsStickingToBottom,
    containerRef,
    containerHeight,
    setContainerHeight,
    itemRefs,
    heights,
    setHeights,
    totalHeight,
    offsets,
    scrollableContainerHeight,
    getAnchorForScrollTop,
    scrollTop,
  };
}

function useVirtualizedListEffects(
  data: unknown[],
  scrollTop: number,
  totalHeight: number,
  scrollableContainerHeight: number,
  scrollAnchor: { index: number; offset: number },
  isStickingToBottom: boolean,
  setIsStickingToBottom: React.Dispatch<React.SetStateAction<boolean>>,
  setScrollAnchor: React.Dispatch<
    React.SetStateAction<{ index: number; offset: number }>
  >,
  getAnchorForScrollTop: (
    scrollTop: number,
    offsets: number[],
  ) => { index: number; offset: number },
  offsets: number[],
  initialScrollIndex: number | undefined,
  initialScrollOffsetInIndex: number | undefined,
  containerHeight: number,
  scrollableContainerHeight2: number,
  heights: number[],
) {
  useStickToBottom(
    data,
    scrollTop,
    totalHeight,
    scrollableContainerHeight,
    scrollAnchor,
    isStickingToBottom,
    setIsStickingToBottom,
    setScrollAnchor,
    getAnchorForScrollTop,
    offsets,
  );

  const { getScrollTop, setPendingScrollTop } = useBatchedScroll(scrollTop);

  useInitialScroll(
    initialScrollIndex,
    initialScrollOffsetInIndex,
    data,
    offsets,
    totalHeight,
    containerHeight,
    scrollableContainerHeight2,
    heights,
    setScrollAnchor,
    setIsStickingToBottom,
    getAnchorForScrollTop,
  );

  return { getScrollTop, setPendingScrollTop };
}

function useImperativeCtx(
  state: ReturnType<typeof useVirtualizedListState>,
  data: unknown[],
  getScrollTop: () => number,
  setPendingScrollTop: (v: number) => void,
) {
  return useMemo(
    () => ({
      offsets: state.offsets,
      scrollAnchor: state.scrollAnchor,
      totalHeight: state.totalHeight,
      scrollableContainerHeight: state.scrollableContainerHeight,
      data,
      getScrollTop,
      setPendingScrollTop,
    }),
    [
      state.offsets,
      state.scrollAnchor,
      state.totalHeight,
      state.scrollableContainerHeight,
      data,
      getScrollTop,
      setPendingScrollTop,
    ],
  );
}

function useViewportAndRender<T>(
  state: ReturnType<typeof useVirtualizedListState>,
  data: T[],
  keyExtractor: (item: T, index: number) => string,
  renderItem: (info: { item: T; index: number }) => React.ReactElement,
) {
  const { startIndex, endIndex } = useViewportRange(
    state.scrollTop,
    state.offsets,
    state.scrollableContainerHeight,
    data.length,
  );

  useMeasureItems(
    state.containerRef,
    state.containerHeight,
    state.setContainerHeight,
    state.itemRefs,
    state.heights,
    state.setHeights,
    startIndex,
    endIndex,
  );

  const renderedItems = useRenderedItems(
    data,
    startIndex,
    endIndex,
    keyExtractor,
    renderItem,
    state.itemRefs,
  );

  const topSpacerHeight = state.offsets[startIndex] ?? 0;
  const bottomSpacerHeight =
    state.totalHeight - (state.offsets[endIndex + 1] ?? state.totalHeight);

  return { renderedItems, topSpacerHeight, bottomSpacerHeight };
}

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
