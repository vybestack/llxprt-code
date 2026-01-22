/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { renderAtWidth, testResponsiveBehavior } from './responsive-testing.js';
import { useResponsive } from '../ui/hooks/useResponsive.js';

type RenderResult = ReturnType<typeof render>;

// Mock the useTerminalSize hook
vi.mock('../ui/hooks/useTerminalSize');

// Test component to verify the responsive testing utilities
function TestComponent(): React.ReactElement {
  const { breakpoint, width } = useResponsive();
  return (
    <div>
      <span data-testid="breakpoint">{breakpoint}</span>
      <span data-testid="width">{width}</span>
    </div>
  );
}

describe('responsive testing utilities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('renderAtWidth', () => {
    it('should render component with mocked terminal width', () => {
      const result = renderAtWidth(<TestComponent />, 100);
      const output = result.lastFrame();

      expect(output).toContain('100');
      expect(output).toContain('STANDARD');
    });

    it('should render component at narrow width', () => {
      const result = renderAtWidth(<TestComponent />, 60);
      const output = result.lastFrame();

      expect(output).toContain('60');
      expect(output).toContain('NARROW');
    });

    it('should render component at wide width', () => {
      const result = renderAtWidth(<TestComponent />, 200);
      const output = result.lastFrame();

      expect(output).toContain('200');
      expect(output).toContain('WIDE');
    });
  });

  describe('testResponsiveBehavior', () => {
    it('should run assertions for specified breakpoints', () => {
      const narrowAssertionSpy = vi.fn();
      const standardAssertionSpy = vi.fn();
      const wideAssertionSpy = vi.fn();

      testResponsiveBehavior(
        'TestComponent responsive behavior',
        <TestComponent />,
        {
          narrow: (result: RenderResult) => {
            const output = result.lastFrame();
            expect(output).toContain('NARROW');
            narrowAssertionSpy();
          },
          standard: (result: RenderResult) => {
            const output = result.lastFrame();
            expect(output).toContain('STANDARD');
            standardAssertionSpy();
          },
          wide: (result: RenderResult) => {
            const output = result.lastFrame();
            expect(output).toContain('WIDE');
            wideAssertionSpy();
          },
        },
      );

      expect(narrowAssertionSpy).toHaveBeenCalledTimes(1);
      expect(standardAssertionSpy).toHaveBeenCalledTimes(1);
      expect(wideAssertionSpy).toHaveBeenCalledTimes(1);
    });

    it('should run only specified assertions', () => {
      const narrowAssertionSpy = vi.fn();
      const wideAssertionSpy = vi.fn();

      testResponsiveBehavior(
        'TestComponent partial responsive behavior',
        <TestComponent />,
        {
          narrow: () => narrowAssertionSpy(),
          wide: () => wideAssertionSpy(),
          // Note: no standard assertion
        },
      );

      expect(narrowAssertionSpy).toHaveBeenCalledTimes(1);
      expect(wideAssertionSpy).toHaveBeenCalledTimes(1);
    });

    it('should provide RenderResult with expected methods', () => {
      testResponsiveBehavior('RenderResult validation', <TestComponent />, {
        standard: (result: RenderResult) => {
          expect(result.lastFrame).toBeDefined();
          expect(result.frames).toBeDefined();
          expect(result.rerender).toBeDefined();
          expect(result.unmount).toBeDefined();
        },
      });
    });

    it('should handle empty assertions object', () => {
      expect(() => {
        testResponsiveBehavior('Empty assertions', <TestComponent />, {});
      }).not.toThrow();
    });
  });
});
