/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useTerminalSize } from './useTerminalSize.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const realInk = { ...(await import('ink')) };
let inkStdout: NodeJS.WriteStream = process.stderr;

void vi.mock('ink', () => ({
  ...realInk,
  useStdout: () => ({ stdout: inkStdout }),
}));

type Dimension = 'columns' | 'rows';

function setDimension(
  stream: NodeJS.WriteStream,
  dimension: Dimension,
  value: number | undefined,
): void {
  Object.defineProperty(stream, dimension, {
    configurable: true,
    value,
    writable: true,
  });
}

function restoreDimension(
  stream: NodeJS.WriteStream,
  dimension: Dimension,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(stream, dimension);
    return;
  }

  Object.defineProperty(stream, dimension, descriptor);
}

describe('useTerminalSize', () => {
  let stdoutColumns: PropertyDescriptor | undefined;
  let stdoutRows: PropertyDescriptor | undefined;
  let stderrColumns: PropertyDescriptor | undefined;
  let stderrRows: PropertyDescriptor | undefined;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    stdoutColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    stdoutRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    stderrColumns = Object.getOwnPropertyDescriptor(process.stderr, 'columns');
    stderrRows = Object.getOwnPropertyDescriptor(process.stderr, 'rows');
    inkStdout = process.stderr;
    unmount = undefined;
    vi.useFakeTimers();
  });

  afterEach(() => {
    unmount?.();
    vi.useRealTimers();
    restoreDimension(process.stdout, 'columns', stdoutColumns);
    restoreDimension(process.stdout, 'rows', stdoutRows);
    restoreDimension(process.stderr, 'columns', stderrColumns);
    restoreDimension(process.stderr, 'rows', stderrRows);
  });

  it('returns the dimensions of the stream used by Ink', () => {
    setDimension(process.stderr, 'columns', 132);
    setDimension(process.stderr, 'rows', 41);
    setDimension(process.stdout, 'columns', 90);
    setDimension(process.stdout, 'rows', 30);

    const hook = renderHook(() => useTerminalSize());
    unmount = hook.unmount;

    expect(hook.result.current).toEqual({ columns: 132, rows: 41 });
  });

  it('falls back to process stdout for missing or zero Ink dimensions', () => {
    setDimension(process.stderr, 'columns', 0);
    setDimension(process.stderr, 'rows', undefined);
    setDimension(process.stdout, 'columns', 101);
    setDimension(process.stdout, 'rows', 37);

    const hook = renderHook(() => useTerminalSize());
    unmount = hook.unmount;

    expect(hook.result.current).toEqual({ columns: 101, rows: 37 });
  });

  it('uses standard terminal defaults when neither stream reports a size', () => {
    setDimension(process.stderr, 'columns', undefined);
    setDimension(process.stderr, 'rows', 0);
    setDimension(process.stdout, 'columns', 0);
    setDimension(process.stdout, 'rows', undefined);

    const hook = renderHook(() => useTerminalSize());
    unmount = hook.unmount;

    expect(hook.result.current).toEqual({ columns: 80, rows: 24 });
  });

  it('debounces resize events and publishes the latest measured size', () => {
    setDimension(process.stderr, 'columns', 80);
    setDimension(process.stderr, 'rows', 24);

    const hook = renderHook(() => useTerminalSize());
    unmount = hook.unmount;

    setDimension(process.stderr, 'columns', 100);
    setDimension(process.stderr, 'rows', 30);
    act(() => {
      process.stdout.emit('resize');
      vi.advanceTimersByTime(149);
    });
    expect(hook.result.current).toEqual({ columns: 80, rows: 24 });

    setDimension(process.stderr, 'columns', 120);
    setDimension(process.stderr, 'rows', 40);
    act(() => {
      process.stdout.emit('resize');
      vi.advanceTimersByTime(149);
    });
    expect(hook.result.current).toEqual({ columns: 80, rows: 24 });

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hook.result.current).toEqual({ columns: 120, rows: 40 });
  });

  it('removes its resize listener and cancels pending measurement on unmount', () => {
    const priorResizeListeners = new Set(process.stdout.listeners('resize'));
    setDimension(process.stderr, 'columns', 80);
    setDimension(process.stderr, 'rows', 24);

    const hook = renderHook(() => useTerminalSize());
    unmount = hook.unmount;
    const resizeListener = process.stdout
      .listeners('resize')
      .find((listener) => !priorResizeListeners.has(listener));
    if (resizeListener === undefined) {
      throw new Error('Expected useTerminalSize to register a resize listener');
    }

    setDimension(process.stderr, 'columns', 140);
    setDimension(process.stderr, 'rows', 50);
    act(() => {
      process.stdout.emit('resize');
    });

    hook.unmount();
    unmount = undefined;
    expect(process.stdout.listeners('resize')).not.toContain(resizeListener);

    act(() => {
      vi.advanceTimersByTime(150);
      process.stdout.emit('resize');
      vi.advanceTimersByTime(150);
    });
    expect(hook.result.current).toEqual({ columns: 80, rows: 24 });
  });
});
