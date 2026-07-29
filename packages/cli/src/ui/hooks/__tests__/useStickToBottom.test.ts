/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../test-utils/render.js';
import {
  useStickToBottom,
  findLastIndex,
} from '../../components/shared/VirtualizedList.hooks.js';
import { SCROLL_TO_ITEM_END } from '../../components/shared/VirtualizedList.types.js';

interface TestProps {
  data: { length: number };
  scrollTop: number;
  totalHeight: number;
  scrollableContainerHeight: number;
  scrollAnchor: { index: number; offset: number };
  isStickingToBottom: boolean;
  setIsStickingToBottom: ReturnType<typeof vi.fn>;
  setScrollAnchor: ReturnType<typeof vi.fn>;
  getAnchorForScrollTop: ReturnType<typeof vi.fn>;
  offsets: number[];
}

function setupTest(): {
  makeProps: (overrides?: Partial<TestProps>) => TestProps;
  useTestHook: (props: TestProps) => null;
  setScrollAnchor: ReturnType<typeof vi.fn>;
  setIsStickingToBottom: ReturnType<typeof vi.fn>;
  getAnchorForScrollTop: ReturnType<typeof vi.fn>;
} {
  const setScrollAnchor = vi.fn();
  const setIsStickingToBottom = vi.fn();
  const getAnchorForScrollTop = vi.fn(
    (scrollTop: number, offsets: number[]) => {
      const index = findLastIndex(offsets, (offset) => offset <= scrollTop);
      if (index === -1) {
        return { index: 0, offset: 0 };
      }
      return { index, offset: scrollTop - offsets[index] };
    },
  );
  const offsets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  function makeProps(overrides: Partial<TestProps> = {}): TestProps {
    return {
      data: { length: 10 },
      scrollTop: 90,
      totalHeight: 100,
      scrollableContainerHeight: 10,
      scrollAnchor: { index: 9, offset: 0 },
      isStickingToBottom: true,
      setScrollAnchor,
      setIsStickingToBottom,
      getAnchorForScrollTop,
      offsets,
      ...overrides,
    };
  }

  function useTestHook(props: TestProps): null {
    useStickToBottom(
      props.data,
      props.scrollTop,
      props.totalHeight,
      props.scrollableContainerHeight,
      props.scrollAnchor,
      props.isStickingToBottom,
      props.setIsStickingToBottom,
      props.setScrollAnchor,
      props.getAnchorForScrollTop,
      props.offsets,
    );
    return null;
  }

  return {
    makeProps,
    useTestHook,
    setScrollAnchor,
    setIsStickingToBottom,
    getAnchorForScrollTop,
  };
}

function isEndAnchor(call: unknown): call is { index: number; offset: number } {
  return (
    typeof call === 'object' &&
    call !== null &&
    'offset' in call &&
    (call as { offset: number }).offset === SCROLL_TO_ITEM_END
  );
}

describe('useStickToBottom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not re-arm isStickingToBottom when content grows after user scrolled up 1px (the bounce-back bug)', () => {
    const { makeProps, useTestHook, setIsStickingToBottom } = setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 90,
        totalHeight: 100,
        data: { length: 10 },
        isStickingToBottom: true,
      }),
    });

    act(() => {
      rerender(
        makeProps({
          scrollTop: 89,
          totalHeight: 100,
          data: { length: 10 },
          isStickingToBottom: false,
        }),
      );
    });

    setIsStickingToBottom.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 89,
          totalHeight: 110,
          data: { length: 11 },
          isStickingToBottom: false,
        }),
      );
    });

    const trueCalls = setIsStickingToBottom.mock.calls.filter(
      ([val]) => val === true,
    );
    expect(trueCalls).toHaveLength(0);
  });

  it('does not scroll to bottom when content grows after user scrolled up 1px', () => {
    const { makeProps, useTestHook, setScrollAnchor } = setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 90,
        totalHeight: 100,
        data: { length: 10 },
        isStickingToBottom: true,
      }),
    });

    act(() => {
      rerender(
        makeProps({
          scrollTop: 89,
          totalHeight: 100,
          data: { length: 10 },
          isStickingToBottom: false,
        }),
      );
    });

    setScrollAnchor.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 89,
          totalHeight: 110,
          data: { length: 11 },
          isStickingToBottom: false,
        }),
      );
    });

    const endAnchorCalls = setScrollAnchor.mock.calls.filter(([val]) =>
      isEndAnchor(val),
    );
    expect(endAnchorCalls).toHaveLength(0);
  });

  it('does not scroll to bottom when container shrinks and user scrolled up', () => {
    const { makeProps, useTestHook, setScrollAnchor } = setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 89,
        totalHeight: 100,
        scrollableContainerHeight: 10,
        isStickingToBottom: false,
      }),
    });

    setScrollAnchor.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 89,
          totalHeight: 100,
          scrollableContainerHeight: 6,
          isStickingToBottom: false,
        }),
      );
    });

    const endAnchorCalls = setScrollAnchor.mock.calls.filter(([val]) =>
      isEndAnchor(val),
    );
    expect(endAnchorCalls).toHaveLength(0);
  });

  it('scrolls to bottom when content grows and sticking is true', () => {
    const { makeProps, useTestHook, setScrollAnchor } = setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 90,
        totalHeight: 100,
        data: { length: 10 },
        isStickingToBottom: true,
      }),
    });

    setScrollAnchor.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 90,
          totalHeight: 110,
          data: { length: 11 },
          isStickingToBottom: true,
        }),
      );
    });

    expect(setScrollAnchor).toHaveBeenCalledWith({
      index: 10,
      offset: SCROLL_TO_ITEM_END,
    });
  });

  it('stays at bottom when container changes and sticking is true', () => {
    const { makeProps, useTestHook, setScrollAnchor } = setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 90,
        totalHeight: 100,
        scrollableContainerHeight: 10,
        isStickingToBottom: true,
      }),
    });

    setScrollAnchor.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 90,
          totalHeight: 100,
          scrollableContainerHeight: 6,
          isStickingToBottom: true,
        }),
      );
    });

    expect(setScrollAnchor).toHaveBeenCalledWith({
      index: 9,
      offset: SCROLL_TO_ITEM_END,
    });
  });

  it('sticks to bottom when content previously fit and then grows', () => {
    const { makeProps, useTestHook, setIsStickingToBottom, setScrollAnchor } =
      setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 0,
        totalHeight: 8,
        scrollableContainerHeight: 10,
        data: { length: 2 },
        isStickingToBottom: false,
      }),
    });

    setIsStickingToBottom.mockClear();
    setScrollAnchor.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 0,
          totalHeight: 120,
          scrollableContainerHeight: 10,
          data: { length: 12 },
          isStickingToBottom: false,
        }),
      );
    });

    expect(setIsStickingToBottom).toHaveBeenCalledWith(true);
    expect(setScrollAnchor).toHaveBeenCalledWith({
      index: 11,
      offset: SCROLL_TO_ITEM_END,
    });
  });

  it('clamps scroll anchor when anchor index exceeds data length', () => {
    const { makeProps, useTestHook, setScrollAnchor, getAnchorForScrollTop } =
      setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        data: { length: 10 },
        scrollAnchor: { index: 8, offset: 5 },
        scrollTop: 85,
        totalHeight: 100,
        isStickingToBottom: false,
      }),
    });

    setScrollAnchor.mockClear();
    getAnchorForScrollTop.mockClear();

    act(() => {
      rerender(
        makeProps({
          data: { length: 5 },
          scrollAnchor: { index: 8, offset: 5 },
          scrollTop: 85,
          totalHeight: 100,
          isStickingToBottom: false,
        }),
      );
    });

    expect(getAnchorForScrollTop).toHaveBeenCalledWith(
      Math.max(0, 100 - 10),
      expect.any(Array),
    );
    const lastCall = getAnchorForScrollTop.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(90);
  });

  it('does not re-arm when user scrolls up a larger amount and content then grows', () => {
    const { makeProps, useTestHook, setIsStickingToBottom } = setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 90,
        totalHeight: 100,
        data: { length: 10 },
        isStickingToBottom: true,
      }),
    });

    act(() => {
      rerender(
        makeProps({
          scrollTop: 50,
          totalHeight: 100,
          data: { length: 10 },
          isStickingToBottom: false,
        }),
      );
    });

    setIsStickingToBottom.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 50,
          totalHeight: 110,
          data: { length: 11 },
          isStickingToBottom: false,
        }),
      );
    });

    const trueCalls = setIsStickingToBottom.mock.calls.filter(
      ([val]) => val === true,
    );
    expect(trueCalls).toHaveLength(0);
  });

  it('does not re-arm on a stationary rerender after scrolling up one row', () => {
    const { makeProps, useTestHook, setIsStickingToBottom } = setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 90,
        totalHeight: 100,
        data: { length: 10 },
        isStickingToBottom: true,
      }),
    });

    act(() => {
      rerender(
        makeProps({
          scrollTop: 89,
          totalHeight: 100,
          data: { length: 10 },
          isStickingToBottom: false,
        }),
      );
    });

    setIsStickingToBottom.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 89,
          totalHeight: 100,
          data: { length: 10 },
          isStickingToBottom: false,
        }),
      );
    });

    const trueCalls = setIsStickingToBottom.mock.calls.filter(
      ([val]) => val === true,
    );
    expect(trueCalls).toHaveLength(0);
  });

  it('does not re-arm when totalHeight changes via height-only measurement (data length unchanged) after scroll up', () => {
    const { makeProps, useTestHook, setIsStickingToBottom } = setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 90,
        totalHeight: 100,
        data: { length: 10 },
        isStickingToBottom: true,
      }),
    });

    act(() => {
      rerender(
        makeProps({
          scrollTop: 89,
          totalHeight: 100,
          data: { length: 10 },
          isStickingToBottom: false,
        }),
      );
    });

    setIsStickingToBottom.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 89,
          totalHeight: 98,
          data: { length: 10 },
          isStickingToBottom: false,
        }),
      );
    });

    const trueCalls = setIsStickingToBottom.mock.calls.filter(
      ([val]) => val === true,
    );
    expect(trueCalls).toHaveLength(0);
  });

  it('re-arms when user explicitly scrolls back down to bottom', () => {
    const { makeProps, useTestHook, setIsStickingToBottom } = setupTest();

    const { rerender } = renderHook(useTestHook, {
      initialProps: makeProps({
        scrollTop: 90,
        totalHeight: 100,
        data: { length: 10 },
        isStickingToBottom: true,
      }),
    });

    act(() => {
      rerender(
        makeProps({
          scrollTop: 50,
          totalHeight: 100,
          data: { length: 10 },
          isStickingToBottom: false,
        }),
      );
    });

    setIsStickingToBottom.mockClear();

    act(() => {
      rerender(
        makeProps({
          scrollTop: 90,
          totalHeight: 100,
          data: { length: 10 },
          isStickingToBottom: false,
        }),
      );
    });

    expect(setIsStickingToBottom).toHaveBeenCalledWith(true);
  });
});
