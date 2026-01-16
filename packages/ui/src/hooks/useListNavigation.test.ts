import { describe, expect, it } from 'vitest';
import React from 'react';
import { act } from 'react';
import { useListNavigation, useFilteredList } from './useListNavigation';

/**
 * Proper renderHook implementation that wraps the hook in a React component
 * to ensure React context is properly initialized.
 */
interface RenderHookResult<T, P> {
  result: { current: T };
  rerender: (newProps: P) => void;
}

function renderHook<T, P = undefined>(
  hook: (props: P) => T,
  options?: { initialProps: P },
): RenderHookResult<T, P> {
  let currentProps = options?.initialProps as P;
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent(): null {
    result.current = hook(currentProps);
    return null;
  }

  const executeRender = () => {
    void act(() => {
      const element = React.createElement(TestComponent);
      const component = element.type as React.FC;
      component(element.props);
    });
  };

  executeRender();

  const rerender = (newProps: P) => {
    currentProps = newProps;
    executeRender();
  };

  return { result: result as { current: T }, rerender };
}

describe('useListNavigation', () => {
  it('initializes with selectedIndex 0', () => {
    const { result } = renderHook(() => useListNavigation(5));
    expect(result.current.selectedIndex).toBe(0);
  });

  it('moves selection down within bounds', () => {
    const { result } = renderHook(() => useListNavigation(5));
    act(() => {
      result.current.moveSelection(1);
    });
    expect(result.current.selectedIndex).toBe(1);
  });

  it('moves selection up within bounds', () => {
    const { result } = renderHook(() => useListNavigation(5));
    act(() => {
      result.current.setSelectedIndex(3);
    });
    act(() => {
      result.current.moveSelection(-1);
    });
    expect(result.current.selectedIndex).toBe(2);
  });

  it('clamps selection to 0 when moving below minimum', () => {
    const { result } = renderHook(() => useListNavigation(5));
    act(() => {
      result.current.moveSelection(-5);
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('clamps selection to length-1 when moving above maximum', () => {
    const { result } = renderHook(() => useListNavigation(5));
    act(() => {
      result.current.moveSelection(10);
    });
    expect(result.current.selectedIndex).toBe(4);
  });

  it('handles empty list by clamping to 0', () => {
    const { result } = renderHook(() => useListNavigation(0));
    act(() => {
      result.current.moveSelection(5);
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('allows direct setting of selectedIndex', () => {
    const { result } = renderHook(() => useListNavigation(5));
    act(() => {
      result.current.setSelectedIndex(3);
    });
    expect(result.current.selectedIndex).toBe(3);
  });

  it('updates when length changes', () => {
    const { result, rerender } = renderHook(
      ({ length }) => useListNavigation(length),
      {
        initialProps: { length: 5 },
      },
    );
    act(() => {
      result.current.setSelectedIndex(4);
    });
    expect(result.current.selectedIndex).toBe(4);

    rerender({ length: 3 });
    act(() => {
      result.current.moveSelection(0);
    });
    expect(result.current.selectedIndex).toBe(2);
  });
});

describe('useFilteredList', () => {
  interface TestItem {
    readonly id: string;
    readonly name: string;
  }

  const items: TestItem[] = [
    { id: '1', name: 'Apple' },
    { id: '2', name: 'Banana' },
    { id: '3', name: 'Cherry' },
    { id: '4', name: 'Apricot' },
  ];

  const filterFn = (item: TestItem, query: string): boolean => {
    return item.name.toLowerCase().includes(query.toLowerCase());
  };

  it('returns all items when query is empty', () => {
    const { result } = renderHook(() => useFilteredList(items, '', filterFn));
    expect(result.current.filteredItems).toHaveLength(4);
    expect(result.current.filteredItems).toStrictEqual(items);
  });

  it('filters items based on query', () => {
    const { result } = renderHook(() => useFilteredList(items, 'ap', filterFn));
    expect(result.current.filteredItems).toHaveLength(2);
    expect(result.current.filteredItems.map((item) => item.id)).toStrictEqual([
      '1',
      '4',
    ]);
  });

  it('resets selectedIndex to 0 when query changes', () => {
    const { result, rerender } = renderHook(
      ({ query }) => useFilteredList(items, query, filterFn),
      { initialProps: { query: '' } },
    );

    act(() => {
      result.current.setSelectedIndex(2);
    });
    expect(result.current.selectedIndex).toBe(2);

    rerender({ query: 'ban' });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('exposes moveSelection from useListNavigation', () => {
    const { result } = renderHook(() => useFilteredList(items, 'ap', filterFn));
    expect(result.current.selectedIndex).toBe(0);

    act(() => {
      result.current.moveSelection(1);
    });
    expect(result.current.selectedIndex).toBe(1);
  });

  it('clamps selection when filtered list shrinks', () => {
    const { result, rerender } = renderHook(
      ({ query }) => useFilteredList(items, query, filterFn),
      { initialProps: { query: '' } },
    );

    act(() => {
      result.current.setSelectedIndex(3);
    });
    expect(result.current.selectedIndex).toBe(3);

    rerender({ query: 'ban' });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('memoizes filtered items', () => {
    const { result, rerender } = renderHook(
      ({ query }) => useFilteredList(items, query, filterFn),
      { initialProps: { query: 'ap' } },
    );

    const firstResult = result.current.filteredItems;
    rerender({ query: 'ap' });
    const secondResult = result.current.filteredItems;

    expect(firstResult).toBe(secondResult);
  });
});
