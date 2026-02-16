/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MouseEvent } from '../contexts/MouseContext.js';

// Capture the handler passed to useMouse so we can call it in tests
let capturedMouseHandler: ((event: MouseEvent) => void) | null = null;
let capturedIsActive = true;

vi.mock('../contexts/MouseContext.js', () => ({
  useMouse: (
    handler: (event: MouseEvent) => void,
    opts: { isActive?: boolean },
  ) => {
    capturedMouseHandler = handler;
    capturedIsActive = opts?.isActive ?? true;
  },
}));

vi.mock('ink', () => ({
  getBoundingBox: vi.fn(() => ({ x: 10, y: 5, width: 40, height: 10 })),
}));

import { getBoundingBox } from 'ink';
import { useMouseClick } from './useMouseClick.js';
import { renderHook } from '../../test-utils/render.js';

describe('useMouseClick', () => {
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedMouseHandler = null;
    capturedIsActive = true;
    handler = vi.fn();
    (getBoundingBox as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 10,
      y: 5,
      width: 40,
      height: 10,
    });
  });

  const fakeRef = {
    current: {},
  } as Parameters<typeof useMouseClick>[0];

  it('registers a mouse handler via useMouse', () => {
    renderHook(() => useMouseClick(fakeRef, handler));
    expect(capturedMouseHandler).not.toBeNull();
  });

  it('calls handler when left-press is inside bounding box', () => {
    renderHook(() => useMouseClick(fakeRef, handler));

    // Simulate mouse event inside the bounding box (1-based terminal coords)
    const event: MouseEvent = {
      name: 'left-press',
      col: 15, // 15-1=14, relative to x=10 → relativeX=4 (inside width=40)
      row: 8, // 8-1=7, relative to y=5 → relativeY=2 (inside height=10)
      button: 'left',
      shift: false,
      meta: false,
      ctrl: false,
    };
    capturedMouseHandler!(event);

    expect(handler).toHaveBeenCalledWith(event, 4, 2);
  });

  it('does not call handler when click is outside bounding box', () => {
    renderHook(() => useMouseClick(fakeRef, handler));

    const event: MouseEvent = {
      name: 'left-press',
      col: 1, // Way outside x=10 bounds
      row: 1,
      button: 'left',
      shift: false,
      meta: false,
      ctrl: false,
    };
    capturedMouseHandler!(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores right-press when button is left (default)', () => {
    renderHook(() => useMouseClick(fakeRef, handler));

    const event: MouseEvent = {
      name: 'right-release',
      col: 15,
      row: 8,
      button: 'right',
      shift: false,
      meta: false,
      ctrl: false,
    };
    capturedMouseHandler!(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it('responds to right-release when button option is right', () => {
    renderHook(() =>
      useMouseClick(fakeRef, handler, {
        button: 'right',
      }),
    );

    const event: MouseEvent = {
      name: 'right-release',
      col: 15,
      row: 8,
      button: 'right',
      shift: false,
      meta: false,
      ctrl: false,
    };
    capturedMouseHandler!(event);

    expect(handler).toHaveBeenCalled();
  });

  it('passes isActive option through to useMouse', () => {
    renderHook(() =>
      useMouseClick(fakeRef, handler, {
        isActive: false,
      }),
    );

    expect(capturedIsActive).toBe(false);
  });

  it('does not call handler when containerRef.current is null', () => {
    const nullRef = { current: null } as React.RefObject<null>;
    renderHook(() =>
      useMouseClick(nullRef as Parameters<typeof useMouseClick>[0], handler),
    );

    const event: MouseEvent = {
      name: 'left-press',
      col: 15,
      row: 8,
      button: 'left',
      shift: false,
      meta: false,
      ctrl: false,
    };
    capturedMouseHandler!(event);

    expect(handler).not.toHaveBeenCalled();
  });
});
