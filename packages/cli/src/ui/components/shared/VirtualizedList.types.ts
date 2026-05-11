/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';

export const SCROLL_TO_ITEM_END = Number.MAX_SAFE_INTEGER;

export type VirtualizedListProps<T> = {
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

import type { DOMElement } from 'ink';

export type VirtualizedListState = {
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
