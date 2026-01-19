/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { useResponsive } from './useResponsive.js';
import { useTerminalSize } from './useTerminalSize.js';

vi.mock('./useTerminalSize');

describe('useResponsive', () => {
  let mockUseTerminalSize: MockedFunction<typeof useTerminalSize>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockUseTerminalSize = useTerminalSize as MockedFunction<
      typeof useTerminalSize
    >;
  });

  it('should return NARROW breakpoint for narrow widths', () => {
    mockUseTerminalSize.mockReturnValue({ columns: 60, rows: 20 });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.width).toBe(60);
    expect(result.current.breakpoint).toBe('NARROW');
    expect(result.current.isNarrow).toBe(true);
    expect(result.current.isStandard).toBe(false);
    expect(result.current.isWide).toBe(false);
  });

  it('should return STANDARD breakpoint for width at narrow threshold', () => {
    mockUseTerminalSize.mockReturnValue({ columns: 80, rows: 20 });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.width).toBe(80);
    expect(result.current.breakpoint).toBe('STANDARD');
    expect(result.current.isNarrow).toBe(false);
    expect(result.current.isStandard).toBe(true);
    expect(result.current.isWide).toBe(false);
  });

  it('should return STANDARD breakpoint for standard widths', () => {
    mockUseTerminalSize.mockReturnValue({ columns: 100, rows: 20 });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.width).toBe(100);
    expect(result.current.breakpoint).toBe('STANDARD');
    expect(result.current.isNarrow).toBe(false);
    expect(result.current.isStandard).toBe(true);
    expect(result.current.isWide).toBe(false);
  });

  it('should return STANDARD breakpoint for width at standard threshold', () => {
    mockUseTerminalSize.mockReturnValue({ columns: 120, rows: 20 });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.width).toBe(120);
    expect(result.current.breakpoint).toBe('STANDARD');
    expect(result.current.isNarrow).toBe(false);
    expect(result.current.isStandard).toBe(true);
    expect(result.current.isWide).toBe(false);
  });

  it('should return WIDE breakpoint for wide widths', () => {
    mockUseTerminalSize.mockReturnValue({ columns: 200, rows: 20 });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.width).toBe(200);
    expect(result.current.breakpoint).toBe('WIDE');
    expect(result.current.isNarrow).toBe(false);
    expect(result.current.isStandard).toBe(false);
    expect(result.current.isWide).toBe(true);
  });

  it('should return WIDE breakpoint for width at wide threshold', () => {
    mockUseTerminalSize.mockReturnValue({ columns: 160, rows: 20 });

    const { result } = renderHook(() => useResponsive());

    expect(result.current.width).toBe(160);
    expect(result.current.breakpoint).toBe('WIDE');
    expect(result.current.isNarrow).toBe(false);
    expect(result.current.isStandard).toBe(false);
    expect(result.current.isWide).toBe(true);
  });

  it('should update when terminal size changes', () => {
    mockUseTerminalSize.mockReturnValue({ columns: 60, rows: 20 });

    const { result, rerender } = renderHook(() => useResponsive());

    expect(result.current.breakpoint).toBe('NARROW');

    // Simulate terminal size change
    mockUseTerminalSize.mockReturnValue({ columns: 150, rows: 20 });
    rerender();

    expect(result.current.width).toBe(150);
    expect(result.current.breakpoint).toBe('WIDE');
    expect(result.current.isWide).toBe(true);
  });

  it('should provide consistent boolean flags for each breakpoint', () => {
    const testCases = [
      {
        width: 50,
        expectedNarrow: true,
        expectedStandard: false,
        expectedWide: false,
      },
      {
        width: 80,
        expectedNarrow: false,
        expectedStandard: true,
        expectedWide: false,
      },
      {
        width: 100,
        expectedNarrow: false,
        expectedStandard: true,
        expectedWide: false,
      },
      {
        width: 120,
        expectedNarrow: false,
        expectedStandard: true,
        expectedWide: false,
      },
      {
        width: 180,
        expectedNarrow: false,
        expectedStandard: false,
        expectedWide: true,
      },
    ];

    testCases.forEach(
      ({ width, expectedNarrow, expectedStandard, expectedWide }) => {
        mockUseTerminalSize.mockReturnValue({ columns: width, rows: 20 });

        const { result } = renderHook(() => useResponsive());

        expect(result.current.isNarrow).toBe(expectedNarrow);
        expect(result.current.isStandard).toBe(expectedStandard);
        expect(result.current.isWide).toBe(expectedWide);
      },
    );
  });
});
