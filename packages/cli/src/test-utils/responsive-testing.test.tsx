/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type RenderResult } from '@testing-library/react';
import React from 'react';
import { renderAtWidth, testResponsiveBehavior } from './responsive-testing.js';
import { useResponsive } from '../ui/hooks/useResponsive.js';

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

      expect(result.getByTestId('width').textContent).toBe('100');
      expect(result.getByTestId('breakpoint').textContent).toBe('STANDARD');
    });

    it('should render component at narrow width', () => {
      const result = renderAtWidth(<TestComponent />, 60);

      expect(result.getByTestId('width').textContent).toBe('60');
      expect(result.getByTestId('breakpoint').textContent).toBe('NARROW');
    });

    it('should render component at wide width', () => {
      const result = renderAtWidth(<TestComponent />, 200);

      expect(result.getByTestId('width').textContent).toBe('200');
      expect(result.getByTestId('breakpoint').textContent).toBe('WIDE');
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
            expect(result.getByTestId('breakpoint').textContent).toBe('NARROW');
            narrowAssertionSpy();
          },
          standard: (result: RenderResult) => {
            expect(result.getByTestId('breakpoint').textContent).toBe(
              'STANDARD',
            );
            standardAssertionSpy();
          },
          wide: (result: RenderResult) => {
            expect(result.getByTestId('breakpoint').textContent).toBe('WIDE');
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
          expect(result.getByTestId).toBeDefined();
          expect(result.queryByTestId).toBeDefined();
          expect(result.container).toBeDefined();
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
