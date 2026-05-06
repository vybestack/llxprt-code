/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getBoundingBox, type DOMElement } from 'ink';
import { useMouse } from '../hooks/useMouse.js';
import type { MouseEvent } from '../utils/mouse.js';

export interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  innerHeight: number;
}

export interface ScrollableEntry {
  id: string;
  ref: React.RefObject<DOMElement | null>;
  getScrollState: () => ScrollState;
  scrollBy: (delta: number) => void;
  scrollTo?: (scrollTop: number, duration?: number) => void;
  hasFocus: () => boolean;
  flashScrollbar: () => void;
}

interface ScrollContextType {
  register: (entry: ScrollableEntry) => void;
  unregister: (id: string) => void;
  getScrollables: () => readonly ScrollableEntry[];
}

const ScrollContext = createContext<ScrollContextType | null>(null);

const getOptionalBoundingBox = (element: DOMElement) =>
  getBoundingBox(element) as ReturnType<typeof getBoundingBox> | undefined;

const findScrollableCandidates = (
  mouseEvent: MouseEvent,
  scrollables: Map<string, ScrollableEntry>,
) => {
  const candidates: Array<ScrollableEntry & { area: number }> = [];

  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure preserved
  for (const entry of scrollables.values()) {
    if (!entry.ref.current || !entry.hasFocus()) {
      continue;
    }

    const boundingBox = getOptionalBoundingBox(entry.ref.current);
    if (!boundingBox) continue;

    const { x, y, width, height } = boundingBox;

    const isInside =
      mouseEvent.col >= x &&
      mouseEvent.col < x + width + 1 &&
      mouseEvent.row >= y &&
      mouseEvent.row < y + height;

    if (isInside) {
      candidates.push({ ...entry, area: width * height });
    }
  }

  candidates.sort((a, b) => a.area - b.area);
  return candidates;
};

/**
 * Calculate thumb geometry for scrollbar.
 */
function calculateThumbGeometry(
  scrollHeight: number,
  innerHeight: number,
  scrollTop: number,
) {
  const thumbHeight = Math.max(
    1,
    Math.floor((innerHeight / scrollHeight) * innerHeight),
  );
  const maxScrollTop = scrollHeight - innerHeight;
  const maxThumbY = innerHeight - thumbHeight;
  const currentThumbY = Math.round((scrollTop / maxScrollTop) * maxThumbY);

  return { thumbHeight, maxScrollTop, maxThumbY, currentThumbY };
}

/**
 * Handle scrollbar thumb click and drag initiation.
 * Returns true if handled, false otherwise.
 */
function handleThumbClick(
  entry: ScrollableEntry,
  mouseEvent: MouseEvent,
  boundingBox: { x: number; y: number; width: number; height: number },
  dragStateRef: React.MutableRefObject<{
    active: boolean;
    id: string | null;
    offset: number;
  }>,
): boolean {
  const { x, y, width, height } = boundingBox;

  // Check if click is on scrollbar track
  if (
    mouseEvent.col !== x + width ||
    mouseEvent.row < y ||
    mouseEvent.row >= y + height
  ) {
    return false;
  }

  const { scrollTop, scrollHeight, innerHeight } = entry.getScrollState();

  if (scrollHeight <= innerHeight) return false;

  const { thumbHeight, maxScrollTop, maxThumbY, currentThumbY } =
    calculateThumbGeometry(scrollHeight, innerHeight, scrollTop);

  if (maxThumbY <= 0) return false;

  const absoluteThumbTop = y + currentThumbY;
  const absoluteThumbBottom = absoluteThumbTop + thumbHeight;

  const isTop = mouseEvent.row === y;
  const isBottom = mouseEvent.row === y + height - 1;

  const hitTop = isTop ? absoluteThumbTop : absoluteThumbTop - 1;
  const hitBottom = isBottom ? absoluteThumbBottom : absoluteThumbBottom + 1;

  const isThumbClick = mouseEvent.row >= hitTop && mouseEvent.row < hitBottom;

  let offset = 0;
  const relativeMouseY = mouseEvent.row - y;

  if (isThumbClick) {
    offset = relativeMouseY - currentThumbY;
  } else {
    const targetThumbY = Math.max(
      0,
      Math.min(maxThumbY, relativeMouseY - Math.floor(thumbHeight / 2)),
    );

    const newScrollTop = Math.round((targetThumbY / maxThumbY) * maxScrollTop);
    if (entry.scrollTo) {
      entry.scrollTo(newScrollTop);
    } else {
      entry.scrollBy(newScrollTop - scrollTop);
    }

    offset = relativeMouseY - targetThumbY;
  }

  dragStateRef.current = {
    active: true,
    id: entry.id,
    offset,
  };
  return true;
}

/**
 * Custom hook for scroll state management.
 */
function useScrollState() {
  const [scrollables, setScrollables] = useState(
    new Map<string, ScrollableEntry>(),
  );

  const register = useCallback((entry: ScrollableEntry) => {
    setScrollables((prev) => new Map(prev).set(entry.id, entry));
  }, []);

  const unregister = useCallback((id: string) => {
    setScrollables((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const scrollablesRef = useRef(scrollables);
  useEffect(() => {
    scrollablesRef.current = scrollables;
  }, [scrollables]);

  const getScrollables = useCallback(
    () => Array.from(scrollablesRef.current.values()),
    [],
  );

  return { scrollablesRef, register, unregister, getScrollables };
}

/**
 * Custom hook for scroll flush management.
 */
function useScrollFlush(
  scrollablesRef: React.MutableRefObject<Map<string, ScrollableEntry>>,
) {
  const pendingScrollsRef = useRef(new Map<string, number>());
  const flushScheduledRef = useRef(false);

  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) {
      return;
    }

    flushScheduledRef.current = true;
    setTimeout(() => {
      flushScheduledRef.current = false;
      for (const [id, delta] of pendingScrollsRef.current.entries()) {
        const entry = scrollablesRef.current.get(id);
        if (entry) {
          entry.scrollBy(delta);
        }
      }
      pendingScrollsRef.current.clear();
    }, 0);
  }, [scrollablesRef]);

  return { pendingScrollsRef, scheduleFlush };
}

/**
 * Custom hook for scroll wheel handling.
 */
function useScrollWheelHandler(
  scrollablesRef: React.MutableRefObject<Map<string, ScrollableEntry>>,
  pendingScrollsRef: React.MutableRefObject<Map<string, number>>,
  scheduleFlush: () => void,
) {
  const handleScroll = useCallback(
    (direction: 'up' | 'down', mouseEvent: MouseEvent) => {
      const delta = direction === 'up' ? -1 : 1;
      const candidates = findScrollableCandidates(
        mouseEvent,
        scrollablesRef.current,
      );

      for (const candidate of candidates) {
        const { scrollTop, scrollHeight, innerHeight } =
          candidate.getScrollState();
        const pendingDelta = pendingScrollsRef.current.get(candidate.id) ?? 0;
        const effectiveScrollTop = scrollTop + pendingDelta;

        const canScrollUp = effectiveScrollTop > 0.001;
        const canScrollDown =
          effectiveScrollTop < scrollHeight - innerHeight - 0.001;

        if (direction === 'up' && canScrollUp) {
          pendingScrollsRef.current.set(candidate.id, pendingDelta + delta);
          scheduleFlush();
          return true;
        }

        if (direction === 'down' && canScrollDown) {
          pendingScrollsRef.current.set(candidate.id, pendingDelta + delta);
          scheduleFlush();
          return true;
        }
      }

      return false;
    },
    [scrollablesRef, pendingScrollsRef, scheduleFlush],
  );

  return handleScroll;
}

/**
 * Process drag move for scrollbar thumb dragging.
 * Returns true if handled, false otherwise.
 */
function processDragMove(
  entry: ScrollableEntry,
  state: { active: boolean; id: string | null; offset: number },
  mouseEvent: MouseEvent,
): boolean {
  const boundingBox = getOptionalBoundingBox(entry.ref.current!);
  if (!boundingBox) return false;

  const { y } = boundingBox;
  const { scrollTop, scrollHeight, innerHeight } = entry.getScrollState();

  const { maxScrollTop, maxThumbY } = calculateThumbGeometry(
    scrollHeight,
    innerHeight,
    scrollTop,
  );

  if (maxThumbY <= 0) return false;

  const relativeMouseY = mouseEvent.row - y;
  const targetThumbY = Math.max(
    0,
    Math.min(maxThumbY, relativeMouseY - state.offset),
  );

  const targetScrollTop = Math.round((targetThumbY / maxThumbY) * maxScrollTop);

  if (entry.scrollTo) {
    entry.scrollTo(targetScrollTop, 0);
  } else {
    entry.scrollBy(targetScrollTop - scrollTop);
  }

  return true;
}

/**
 * Custom hook for drag state management.
 */
function useDragState(
  scrollablesRef: React.MutableRefObject<Map<string, ScrollableEntry>>,
) {
  const dragStateRef = useRef<{
    active: boolean;
    id: string | null;
    offset: number;
  }>({
    active: false,
    id: null,
    offset: 0,
  });

  const handleLeftPress = useCallback(
    (mouseEvent: MouseEvent) => {
      // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure preserved
      for (const entry of scrollablesRef.current.values()) {
        if (!entry.ref.current || !entry.hasFocus()) {
          continue;
        }

        const boundingBox = getOptionalBoundingBox(entry.ref.current);
        if (!boundingBox) continue;

        if (handleThumbClick(entry, mouseEvent, boundingBox, dragStateRef)) {
          return true;
        }
      }

      const candidates = findScrollableCandidates(
        mouseEvent,
        scrollablesRef.current,
      );

      if (candidates.length > 0) {
        candidates[0].flashScrollbar();
      }

      return false;
    },
    [scrollablesRef],
  );

  const handleMove = useCallback(
    (mouseEvent: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state.active || !state.id) return false;

      const entry = scrollablesRef.current.get(state.id);
      if (!entry || !entry.ref.current) {
        state.active = false;
        return false;
      }

      return processDragMove(entry, state, mouseEvent);
    },
    [scrollablesRef],
  );

  const handleLeftRelease = useCallback(() => {
    if (!dragStateRef.current.active) {
      return false;
    }

    dragStateRef.current = { active: false, id: null, offset: 0 };
    return true;
  }, []);

  return { handleLeftPress, handleMove, handleLeftRelease };
}

/**
 * Custom hook for mouse event handling.
 */
function useScrollMouseHandler(
  scrollablesRef: React.MutableRefObject<Map<string, ScrollableEntry>>,
  pendingScrollsRef: React.MutableRefObject<Map<string, number>>,
  scheduleFlush: () => void,
) {
  const handleScroll = useScrollWheelHandler(
    scrollablesRef,
    pendingScrollsRef,
    scheduleFlush,
  );
  const { handleLeftPress, handleMove, handleLeftRelease } =
    useDragState(scrollablesRef);

  const handleMouseEvent = useCallback(
    (event: MouseEvent): boolean => {
      if (event.name === 'scroll-up') {
        return handleScroll('up', event);
      }
      if (event.name === 'scroll-down') {
        return handleScroll('down', event);
      }
      if (event.name === 'left-press') {
        return handleLeftPress(event);
      }
      if (event.name === 'move') {
        return handleMove(event);
      }
      if (event.name === 'left-release') {
        return handleLeftRelease();
      }
      return false;
    },
    [handleScroll, handleLeftPress, handleMove, handleLeftRelease],
  );

  useMouse(handleMouseEvent, { isActive: true });
}

/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P05
 * @requirement REQ-456.4
 */
export const ScrollProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { scrollablesRef, register, unregister, getScrollables } =
    useScrollState();
  const { pendingScrollsRef, scheduleFlush } = useScrollFlush(scrollablesRef);

  useScrollMouseHandler(scrollablesRef, pendingScrollsRef, scheduleFlush);

  const contextValue = useMemo(
    () => ({ register, unregister, getScrollables }),
    [register, unregister, getScrollables],
  );

  return (
    <ScrollContext.Provider value={contextValue}>
      {children}
    </ScrollContext.Provider>
  );
};

let nextId = 0;

/**
 * @plan PLAN-20251215-OLDUI-SCROLL.P05
 * @requirement REQ-456.4
 */
export const useScrollable = (
  entry: Omit<ScrollableEntry, 'id'>,
  isActive: boolean,
) => {
  const context = useScrollProvider();

  const [id] = useState(() => {
    const currentId = nextId;
    nextId += 1;
    return `scrollable-${currentId}`;
  });

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    context.register({ ...entry, id });
    return () => {
      context.unregister(id);
    };
  }, [context, entry, id, isActive]);
};

export function useScrollProvider(): ScrollContextType {
  const context = useContext(ScrollContext);
  if (!context) {
    throw new Error('useScrollProvider must be used within a ScrollProvider');
  }
  return context;
}
