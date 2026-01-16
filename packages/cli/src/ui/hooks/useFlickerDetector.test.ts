/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { useFlickerDetector } from './useFlickerDetector.js';
import { measureElement, type DOMElement } from 'ink';
import { appEvents, AppEvent } from '../../utils/events.js';

// Mock ink's measureElement
vi.mock('ink', async () => {
  const actualInk = (await vi.importActual('ink')) as Record<string, unknown>;
  return {
    ...actualInk,
    measureElement: vi.fn(),
  };
});

describe('useFlickerDetector', () => {
  const mockMeasureElement = measureElement as ReturnType<typeof vi.fn>;
  let flickerEventSpy: ReturnType<typeof vi.fn>;
  let mockRef: React.RefObject<DOMElement | null>;

  beforeEach(() => {
    vi.resetAllMocks();
    flickerEventSpy = vi.fn();
    appEvents.on(AppEvent.Flicker, flickerEventSpy);

    // Create a mock ref with a current value
    mockRef = {
      current: {} as DOMElement,
    };
  });

  afterEach(() => {
    appEvents.off(AppEvent.Flicker, flickerEventSpy);
  });

  describe('flicker event emission', () => {
    it('should emit Flicker event when content height exceeds terminal height and constrainHeight is true', () => {
      mockMeasureElement.mockReturnValue({ height: 50, width: 100 });

      renderHook(() => useFlickerDetector(mockRef, 24, true));

      expect(flickerEventSpy).toHaveBeenCalledTimes(1);
      expect(flickerEventSpy).toHaveBeenCalledWith({
        contentHeight: 50,
        terminalHeight: 24,
        overflow: 26,
      });
    });

    it('should not emit Flicker event when content fits in terminal', () => {
      mockMeasureElement.mockReturnValue({ height: 20, width: 100 });

      renderHook(() => useFlickerDetector(mockRef, 24, true));

      expect(flickerEventSpy).not.toHaveBeenCalled();
    });

    it('should not emit Flicker event when content height equals terminal height', () => {
      mockMeasureElement.mockReturnValue({ height: 24, width: 100 });

      renderHook(() => useFlickerDetector(mockRef, 24, true));

      expect(flickerEventSpy).not.toHaveBeenCalled();
    });

    it('should not emit Flicker event when constrainHeight is false', () => {
      mockMeasureElement.mockReturnValue({ height: 50, width: 100 });

      renderHook(() => useFlickerDetector(mockRef, 24, false));

      expect(flickerEventSpy).not.toHaveBeenCalled();
    });
  });

  describe('ref handling', () => {
    it('should not measure when ref is null', () => {
      const nullRef: React.RefObject<DOMElement | null> = { current: null };

      renderHook(() => useFlickerDetector(nullRef, 24, true));

      expect(mockMeasureElement).not.toHaveBeenCalled();
      expect(flickerEventSpy).not.toHaveBeenCalled();
    });

    it('should measure when ref becomes available', () => {
      const dynamicRef: React.RefObject<DOMElement | null> = { current: null };
      mockMeasureElement.mockReturnValue({ height: 50, width: 100 });

      const { rerender } = renderHook(() =>
        useFlickerDetector(dynamicRef, 24, true),
      );

      expect(mockMeasureElement).not.toHaveBeenCalled();

      // Simulate ref becoming available
      (dynamicRef as { current: DOMElement | null }).current = {} as DOMElement;
      rerender();

      expect(mockMeasureElement).toHaveBeenCalled();
      expect(flickerEventSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('multiple renders', () => {
    it('should emit Flicker event on every render when overflowing', () => {
      mockMeasureElement.mockReturnValue({ height: 50, width: 100 });

      const { rerender } = renderHook(() =>
        useFlickerDetector(mockRef, 24, true),
      );

      expect(flickerEventSpy).toHaveBeenCalledTimes(1);

      // Re-render should emit again (no dependency array means it runs every render)
      rerender();
      expect(flickerEventSpy).toHaveBeenCalledTimes(2);

      rerender();
      expect(flickerEventSpy).toHaveBeenCalledTimes(3);
    });

    it('should emit Flicker event with updated overflow when terminal height changes', () => {
      mockMeasureElement.mockReturnValue({ height: 50, width: 100 });

      const { rerender } = renderHook(
        ({ terminalHeight }) =>
          useFlickerDetector(mockRef, terminalHeight, true),
        {
          initialProps: { terminalHeight: 24 },
        },
      );

      expect(flickerEventSpy).toHaveBeenCalledTimes(1);
      expect(flickerEventSpy).toHaveBeenCalledWith({
        contentHeight: 50,
        terminalHeight: 24,
        overflow: 26,
      });

      // Change terminal height
      rerender({ terminalHeight: 20 });

      expect(flickerEventSpy).toHaveBeenCalledTimes(2);
      expect(flickerEventSpy).toHaveBeenLastCalledWith({
        contentHeight: 50,
        terminalHeight: 20,
        overflow: 30,
      });
    });
  });

  describe('constrainHeight toggle', () => {
    it('should start emitting when constrainHeight changes to true', () => {
      mockMeasureElement.mockReturnValue({ height: 50, width: 100 });

      const { rerender } = renderHook(
        ({ constrainHeight }) =>
          useFlickerDetector(mockRef, 24, constrainHeight),
        {
          initialProps: { constrainHeight: false },
        },
      );

      expect(flickerEventSpy).not.toHaveBeenCalled();

      rerender({ constrainHeight: true });

      expect(flickerEventSpy).toHaveBeenCalledTimes(1);
    });

    it('should stop emitting when constrainHeight changes to false', () => {
      mockMeasureElement.mockReturnValue({ height: 50, width: 100 });

      const { rerender } = renderHook(
        ({ constrainHeight }) =>
          useFlickerDetector(mockRef, 24, constrainHeight),
        {
          initialProps: { constrainHeight: true },
        },
      );

      expect(flickerEventSpy).toHaveBeenCalledTimes(1);

      rerender({ constrainHeight: false });

      // Should not emit a second time
      expect(flickerEventSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('return value', () => {
    it('should return void (no state management)', () => {
      mockMeasureElement.mockReturnValue({ height: 50, width: 100 });

      const { result } = renderHook(() =>
        useFlickerDetector(mockRef, 24, true),
      );

      expect(result.current).toBeUndefined();
    });
  });
});
