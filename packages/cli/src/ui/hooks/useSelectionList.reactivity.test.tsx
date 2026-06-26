/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import {
  useSelectionList,
  type SelectionListItem,
} from './useSelectionList.js';
import { useKeypress } from './useKeypress.js';

import type { KeypressHandler, Key } from '../contexts/KeypressContext.js';

type UseKeypressMockOptions = { isActive: boolean };

vi.mock('./useKeypress.js');

let activeKeypressHandler: KeypressHandler | null = null;

describe('useSelectionList', () => {
  const mockOnSelect = vi.fn();
  const mockOnHighlight = vi.fn();

  const items: Array<SelectionListItem<string>> = [
    { value: 'A', key: 'A' },
    { value: 'B', disabled: true, key: 'B' },
    { value: 'C', key: 'C' },
    { value: 'D', key: 'D' },
  ];

  beforeEach(() => {
    activeKeypressHandler = null;
    vi.mocked(useKeypress).mockImplementation(
      (handler: KeypressHandler, options?: UseKeypressMockOptions) => {
        if (options?.isActive === true) {
          activeKeypressHandler = handler;
        } else {
          activeKeypressHandler = null;
        }
        return { refresh: vi.fn() };
      },
    );
    mockOnSelect.mockClear();
    mockOnHighlight.mockClear();
  });

  const pressKey = (
    name: string,
    sequence: string = name,
    options: { shift?: boolean; ctrl?: boolean } = {},
  ) => {
    act(() => {
      if (activeKeypressHandler) {
        const key: Key = {
          name,
          sequence,
          ctrl: options.ctrl ?? false,
          meta: false,
          shift: options.shift ?? false,
        };
        activeKeypressHandler(key);
      } else {
        throw new Error(
          `Test attempted to press key (${name}) but the keypress handler is not active. Ensure the hook is focused (isFocused=true) and the list is not empty.`,
        );
      }
    });
  };

  describe('Reactivity (Dynamic Updates)', () => {
    it('should update activeIndex when initialIndex prop changes', () => {
      const { result, rerender } = renderHook(
        ({ initialIndex }: { initialIndex: number }) =>
          useSelectionList({
            items,
            onSelect: mockOnSelect,
            initialIndex,
          }),
        { initialProps: { initialIndex: 0 } },
      );

      rerender({ initialIndex: 2 });
      expect(result.current.activeIndex).toBe(2);
    });

    it('should respect a new initialIndex even after user interaction', () => {
      const { result, rerender } = renderHook(
        ({ initialIndex }: { initialIndex: number }) =>
          useSelectionList({
            items,
            onSelect: mockOnSelect,
            initialIndex,
          }),
        { initialProps: { initialIndex: 0 } },
      );

      // User navigates, changing the active index
      pressKey('down');
      expect(result.current.activeIndex).toBe(2);

      // The component re-renders with a new initial index
      rerender({ initialIndex: 3 });

      // The hook should now respect the new initial index
      expect(result.current.activeIndex).toBe(3);
    });

    it('should validate index when initialIndex prop changes to a disabled item', () => {
      const { result, rerender } = renderHook(
        ({ initialIndex }: { initialIndex: number }) =>
          useSelectionList({
            items,
            onSelect: mockOnSelect,
            initialIndex,
          }),
        { initialProps: { initialIndex: 0 } },
      );

      rerender({ initialIndex: 1 });

      expect(result.current.activeIndex).toBe(2);
    });

    it('should adjust activeIndex if items change and the initialIndex is now out of bounds', () => {
      const { result, rerender } = renderHook(
        ({ items: testItems }: { items: Array<SelectionListItem<string>> }) =>
          useSelectionList({
            onSelect: mockOnSelect,
            initialIndex: 3,
            items: testItems,
          }),
        { initialProps: { items } },
      );

      expect(result.current.activeIndex).toBe(3);

      const shorterItems = [
        { value: 'X', key: 'X' },
        { value: 'Y', key: 'Y' },
      ];
      rerender({ items: shorterItems }); // Length 2

      // The useEffect syncs based on the initialIndex (3) which is now out of bounds. It defaults to 0.
      expect(result.current.activeIndex).toBe(0);
    });

    it('should adjust activeIndex if items change and the initialIndex becomes disabled', () => {
      const initialItems = [
        { value: 'A', key: 'A' },
        { value: 'B', key: 'B' },
        { value: 'C', key: 'C' },
      ];
      const { result, rerender } = renderHook(
        ({ items: testItems }: { items: Array<SelectionListItem<string>> }) =>
          useSelectionList({
            onSelect: mockOnSelect,
            initialIndex: 1,
            items: testItems,
          }),
        { initialProps: { items: initialItems } },
      );

      expect(result.current.activeIndex).toBe(1);

      const newItems = [
        { value: 'A', key: 'A' },
        { value: 'B', disabled: true, key: 'B' },
        { value: 'C', key: 'C' },
      ];
      rerender({ items: newItems });

      expect(result.current.activeIndex).toBe(2);
    });

    it('should reset to 0 if items change to an empty list', () => {
      const { result, rerender } = renderHook(
        ({ items: testItems }: { items: Array<SelectionListItem<string>> }) =>
          useSelectionList({
            onSelect: mockOnSelect,
            initialIndex: 2,
            items: testItems,
          }),
        { initialProps: { items } },
      );

      rerender({ items: [] });
      expect(result.current.activeIndex).toBe(0);
    });

    it('should not reset activeIndex when items are deeply equal', () => {
      const initialItems = [
        { value: 'A', key: 'A' },
        { value: 'B', disabled: true, key: 'B' },
        { value: 'C', key: 'C' },
        { value: 'D', key: 'D' },
      ];

      const { result, rerender } = renderHook(
        ({ items: testItems }: { items: Array<SelectionListItem<string>> }) =>
          useSelectionList({
            onSelect: mockOnSelect,
            onHighlight: mockOnHighlight,
            initialIndex: 2,
            items: testItems,
          }),
        { initialProps: { items: initialItems } },
      );

      expect(result.current.activeIndex).toBe(2);

      act(() => {
        result.current.setActiveIndex(3);
      });
      expect(result.current.activeIndex).toBe(3);

      mockOnHighlight.mockClear();

      // Create new array with same content (deeply equal but not identical)
      const newItems = [
        { value: 'A', key: 'A' },
        { value: 'B', disabled: true, key: 'B' },
        { value: 'C', key: 'C' },
        { value: 'D', key: 'D' },
      ];

      rerender({ items: newItems });

      // Active index should remain the same since items are deeply equal
      expect(result.current.activeIndex).toBe(3);
      // onHighlight should NOT be called since the index didn't change
      expect(mockOnHighlight).not.toHaveBeenCalled();
    });

    it('should update activeIndex when items change structurally', () => {
      const initialItems = [
        { value: 'A', key: 'A' },
        { value: 'B', disabled: true, key: 'B' },
        { value: 'C', key: 'C' },
        { value: 'D', key: 'D' },
      ];

      const { result, rerender } = renderHook(
        ({ items: testItems }: { items: Array<SelectionListItem<string>> }) =>
          useSelectionList({
            onSelect: mockOnSelect,
            onHighlight: mockOnHighlight,
            initialIndex: 3,
            items: testItems,
          }),
        { initialProps: { items: initialItems } },
      );

      expect(result.current.activeIndex).toBe(3);
      mockOnHighlight.mockClear();

      // Change item values (not deeply equal)
      const newItems = [
        { value: 'X', key: 'X' },
        { value: 'Y', key: 'Y' },
        { value: 'Z', key: 'Z' },
      ];

      rerender({ items: newItems });

      // Active index should update based on initialIndex and new items
      expect(result.current.activeIndex).toBe(0);
    });

    it('should handle partial changes in items array', () => {
      const initialItems = [
        { value: 'A', key: 'A' },
        { value: 'B', key: 'B' },
        { value: 'C', key: 'C' },
      ];

      const { result, rerender } = renderHook(
        ({ items: testItems }: { items: Array<SelectionListItem<string>> }) =>
          useSelectionList({
            onSelect: mockOnSelect,
            initialIndex: 1,
            items: testItems,
          }),
        { initialProps: { items: initialItems } },
      );

      expect(result.current.activeIndex).toBe(1);

      // Change only one item's disabled status
      const newItems = [
        { value: 'A', key: 'A' },
        { value: 'B', disabled: true, key: 'B' },
        { value: 'C', key: 'C' },
      ];

      rerender({ items: newItems });

      // Should find next valid index since current became disabled
      expect(result.current.activeIndex).toBe(2);
    });

    it('should update selection when a new item is added to the start of the list', () => {
      const initialItems = [
        { value: 'A', key: 'A' },
        { value: 'B', key: 'B' },
        { value: 'C', key: 'C' },
      ];

      const { result, rerender } = renderHook(
        ({ items: testItems }: { items: Array<SelectionListItem<string>> }) =>
          useSelectionList({
            onSelect: mockOnSelect,
            items: testItems,
          }),
        { initialProps: { items: initialItems } },
      );

      pressKey('down');
      expect(result.current.activeIndex).toBe(1);

      const newItems = [
        { value: 'D', key: 'D' },
        { value: 'A', key: 'A' },
        { value: 'B', key: 'B' },
        { value: 'C', key: 'C' },
      ];

      rerender({ items: newItems });

      expect(result.current.activeIndex).toBe(2);
    });

    it('should not re-initialize when items have identical keys but are different objects', () => {
      const initialItems = [
        { value: 'A', key: 'A' },
        { value: 'B', key: 'B' },
      ];

      let renderCount = 0;

      const { rerender } = renderHook(
        ({ items: testItems }: { items: Array<SelectionListItem<string>> }) => {
          renderCount++;
          return useSelectionList({
            onSelect: mockOnSelect,
            onHighlight: mockOnHighlight,
            items: testItems,
          });
        },
        { initialProps: { items: initialItems } },
      );

      // Initial render
      expect(renderCount).toBe(1);

      // Create new items with the same keys but different object references
      const newItems = [
        { value: 'A', key: 'A' },
        { value: 'B', key: 'B' },
      ];

      rerender({ items: newItems });
      expect(renderCount).toBe(2);
    });
  });
  describe('Manual Control', () => {
    it('should allow manual setting of active index via setActiveIndex', () => {
      const { result } = renderHook(() =>
        useSelectionList({ items, onSelect: mockOnSelect }),
      );

      act(() => {
        result.current.setActiveIndex(3);
      });
      expect(result.current.activeIndex).toBe(3);

      act(() => {
        result.current.setActiveIndex(1);
      });
      expect(result.current.activeIndex).toBe(1);
    });
  });
  describe('Cleanup', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should clear timeout on unmount when timer is active', () => {
      const longList: Array<SelectionListItem<string>> = Array.from(
        { length: 15 },
        (_, i) => ({ value: `Item ${i + 1}`, key: `Item ${i + 1}` }),
      );

      const { unmount } = renderHook(() =>
        useSelectionList({
          items: longList,
          onSelect: mockOnSelect,
          showNumbers: true,
        }),
      );

      pressKey('1', '1');

      expect(vi.getTimerCount()).toBe(1);

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(mockOnSelect).not.toHaveBeenCalled();

      unmount();

      expect(vi.getTimerCount()).toBe(0);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mockOnSelect).not.toHaveBeenCalled();
    });
  });
});
