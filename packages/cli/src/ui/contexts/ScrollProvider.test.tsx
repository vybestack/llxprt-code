/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useRef,
  forwardRef,
  useImperativeHandle,
  act,
  type RefObject,
} from 'react';
import { render } from 'ink-testing-library';
import { Box, type DOMElement } from 'ink';
import {
  ScrollProvider,
  useScrollable,
  type ScrollState,
} from './ScrollProvider.js';
import type { MouseEvent } from '../utils/mouse.js';

const mockUseMouseCallbacks = new Set<(event: MouseEvent) => void | boolean>();
vi.mock('../hooks/useMouse.js', async () => {
  const React = await import('react');
  return {
    useMouse: (callback: (event: MouseEvent) => void | boolean) => {
      React.useLayoutEffect(() => {
        mockUseMouseCallbacks.add(callback);
        return () => {
          mockUseMouseCallbacks.delete(callback);
        };
      }, [callback]);
    },
  };
});

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    getBoundingBox: vi.fn(() => ({ x: 0, y: 0, width: 10, height: 10 })),
  };
});

const TestScrollable = forwardRef(
  (
    props: {
      scrollBy: (delta: number) => void;
      scrollTo?: (scrollTop: number) => void;
      getScrollState: () => ScrollState;
    },
    ref,
  ) => {
    const elementRef = useRef<DOMElement | null>({} as DOMElement);
    useImperativeHandle(ref, () => elementRef.current);

    useScrollable(
      {
        ref: elementRef as RefObject<DOMElement | null>,
        getScrollState: props.getScrollState,
        scrollBy: props.scrollBy,
        scrollTo: props.scrollTo,
        hasFocus: () => true,
        flashScrollbar: () => {},
      },
      true,
    );

    return <Box ref={elementRef} />;
  },
);
TestScrollable.displayName = 'TestScrollable';

describe('ScrollProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseMouseCallbacks.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Event Handling Status', () => {
    it('returns true when scroll event is handled', () => {
      const scrollBy = vi.fn();
      const getScrollState = vi.fn(() => ({
        scrollTop: 0,
        scrollHeight: 100,
        innerHeight: 10,
      }));

      act(() => {
        render(
          <ScrollProvider>
            <TestScrollable
              scrollBy={scrollBy}
              getScrollState={getScrollState}
            />
          </ScrollProvider>,
        );
      });

      let handled = false;
      for (const callback of mockUseMouseCallbacks) {
        if (
          callback({
            name: 'scroll-down',
            col: 5,
            row: 5,
            shift: false,
            ctrl: false,
            meta: false,
            button: 'none',
          }) === true
        ) {
          handled = true;
        }
      }
      expect(handled).toBe(true);
    });

    it('returns false when scroll event is ignored (cannot scroll further)', () => {
      const scrollBy = vi.fn();
      const getScrollState = vi.fn(() => ({
        scrollTop: 90,
        scrollHeight: 100,
        innerHeight: 10,
      }));

      act(() => {
        render(
          <ScrollProvider>
            <TestScrollable
              scrollBy={scrollBy}
              getScrollState={getScrollState}
            />
          </ScrollProvider>,
        );
      });

      let handled = false;
      for (const callback of mockUseMouseCallbacks) {
        if (
          callback({
            name: 'scroll-down',
            col: 5,
            row: 5,
            shift: false,
            ctrl: false,
            meta: false,
            button: 'none',
          }) === true
        ) {
          handled = true;
        }
      }
      expect(handled).toBe(false);
    });
  });

  it('calls scrollTo when clicking scrollbar track if available', () => {
    const scrollBy = vi.fn();
    const scrollTo = vi.fn();
    const getScrollState = vi.fn(() => ({
      scrollTop: 0,
      scrollHeight: 100,
      innerHeight: 10,
    }));

    act(() => {
      render(
        <ScrollProvider>
          <TestScrollable
            scrollBy={scrollBy}
            scrollTo={scrollTo}
            getScrollState={getScrollState}
          />
        </ScrollProvider>,
      );
    });

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'left-press',
        col: 10,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'left',
      });
    }

    expect(scrollTo).toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('calls scrollBy when clicking scrollbar track if scrollTo is not available', () => {
    const scrollBy = vi.fn();
    const getScrollState = vi.fn(() => ({
      scrollTop: 0,
      scrollHeight: 100,
      innerHeight: 10,
    }));

    act(() => {
      render(
        <ScrollProvider>
          <TestScrollable scrollBy={scrollBy} getScrollState={getScrollState} />
        </ScrollProvider>,
      );
    });

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'left-press',
        col: 10,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'left',
      });
    }

    expect(scrollBy).toHaveBeenCalled();
  });

  it('batches multiple scroll events into a single update', async () => {
    const scrollBy = vi.fn();
    const getScrollState = vi.fn(() => ({
      scrollTop: 0,
      scrollHeight: 100,
      innerHeight: 10,
    }));

    act(() => {
      render(
        <ScrollProvider>
          <TestScrollable scrollBy={scrollBy} getScrollState={getScrollState} />
        </ScrollProvider>,
      );
    });

    const mouseEvent: MouseEvent = {
      name: 'scroll-down',
      col: 5,
      row: 5,
      shift: false,
      ctrl: false,
      meta: false,
      button: 'none',
    };

    for (const callback of mockUseMouseCallbacks) {
      callback(mouseEvent);
      callback(mouseEvent);
      callback(mouseEvent);
    }

    expect(scrollBy).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(3);
  });

  it('handles mixed direction scroll events in batch', async () => {
    const scrollBy = vi.fn();
    const getScrollState = vi.fn(() => ({
      scrollTop: 10,
      scrollHeight: 100,
      innerHeight: 10,
    }));

    act(() => {
      render(
        <ScrollProvider>
          <TestScrollable scrollBy={scrollBy} getScrollState={getScrollState} />
        </ScrollProvider>,
      );
    });

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'scroll-down',
        col: 5,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'none',
      });
      callback({
        name: 'scroll-down',
        col: 5,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'none',
      });
      callback({
        name: 'scroll-up',
        col: 5,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'none',
      });
    }

    expect(scrollBy).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(1);
  });

  it('respects scroll limits during batching', async () => {
    const scrollBy = vi.fn();
    const getScrollState = vi.fn(() => ({
      scrollTop: 89,
      scrollHeight: 100,
      innerHeight: 10,
    }));

    act(() => {
      render(
        <ScrollProvider>
          <TestScrollable scrollBy={scrollBy} getScrollState={getScrollState} />
        </ScrollProvider>,
      );
    });

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'scroll-down',
        col: 5,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'none',
      });
      callback({
        name: 'scroll-down',
        col: 5,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'none',
      });
      callback({
        name: 'scroll-down',
        col: 5,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'none',
      });
    }

    await vi.runAllTimersAsync();

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(1);
  });

  it('calls scrollTo when dragging scrollbar thumb if available', () => {
    const scrollBy = vi.fn();
    const scrollTo = vi.fn();
    const getScrollState = vi.fn(() => ({
      scrollTop: 0,
      scrollHeight: 100,
      innerHeight: 10,
    }));

    act(() => {
      render(
        <ScrollProvider>
          <TestScrollable
            scrollBy={scrollBy}
            scrollTo={scrollTo}
            getScrollState={getScrollState}
          />
        </ScrollProvider>,
      );
    });

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'left-press',
        col: 10,
        row: 0,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'left',
      });
    }

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'move',
        col: 10,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'left',
      });
    }

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'left-release',
        col: 10,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'left',
      });
    }

    expect(scrollTo).toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('calls scrollBy when dragging scrollbar thumb if scrollTo is not available', () => {
    const scrollBy = vi.fn();
    const getScrollState = vi.fn(() => ({
      scrollTop: 0,
      scrollHeight: 100,
      innerHeight: 10,
    }));

    act(() => {
      render(
        <ScrollProvider>
          <TestScrollable scrollBy={scrollBy} getScrollState={getScrollState} />
        </ScrollProvider>,
      );
    });

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'left-press',
        col: 10,
        row: 0,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'left',
      });
    }

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'move',
        col: 10,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'left',
      });
    }

    for (const callback of mockUseMouseCallbacks) {
      callback({
        name: 'left-release',
        col: 10,
        row: 5,
        shift: false,
        ctrl: false,
        meta: false,
        button: 'left',
      });
    }

    expect(scrollBy).toHaveBeenCalled();
  });
});
