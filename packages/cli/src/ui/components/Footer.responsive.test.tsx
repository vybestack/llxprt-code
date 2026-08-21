/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { render } from 'ink-testing-library';
import type React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import { Footer } from './Footer.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { testRegex } from '../../test-utils/regex.js';

const realUseTerminalSizeModule = {
  ...(await import('../hooks/useTerminalSize.js')),
};

void vi.mock('../hooks/useTerminalSize.js', () =>
  automock(realUseTerminalSizeModule),
);

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => ({
    getActiveProviderStatus: () => ({ providerName: 'gemini' }),
  }),
}));

void vi.mock('node:v8', () => ({
  default: {
    getHeapStatistics: vi.fn(() => ({
      heap_size_limit: 8 * 1024 * 1024 * 1024,
    })),
  },
}));

const mockUseTerminalSize = useTerminalSize as Mock<typeof useTerminalSize>;

function renderFooter(
  props: React.ComponentProps<typeof Footer>,
): ReturnType<typeof render> {
  const result = render(<Footer {...props} />);
  // ink-testing-library hardcodes stdout.columns to 100, but the Footer uses
  // the mocked useTerminalSize for its responsive logic. Patch stdout.columns
  // to match the mocked width so Ink's layout engine and the Footer agree on
  // the available space — otherwise wide content (detailed memory labels +
  // timestamp) wraps mid-pattern.
  const mocked = mockUseTerminalSize();
  Object.defineProperty(result.stdout, 'columns', {
    value: mocked.columns,
    configurable: true,
  });
  result.rerender(<Footer {...props} />);
  return result;
}

describe('Footer Responsive Behavior', () => {
  const defaultProps = {
    model: 'gemini-2.5-pro',
    targetDir: '/home/user/projects/long-project-name',
    branchName: 'feature/very-long-branch-name-that-needs-truncation',
    branchIsDirty: true,
    debugMode: false,
    debugMessage: '',
    errorCount: 0,
    showErrorDetails: false,
    showMemoryUsage: true,
    historyTokenCount: 1000,
    isPaidMode: false,
    nightly: false,
    vimMode: 'NORMAL',
    contextLimit: 100000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('NARROW width behavior (< 80 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 60, rows: 20 });
    });

    it('should show memory heap and RSS labels', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should show Heap and RSS labels at all widths
      expect(output).toMatch(testRegex('Heap:', ''));
      expect(output).toMatch(testRegex('RSS:', ''));
      // Should NOT show dimensionally-invalid percentage (RSS/heap)
      expect(output).not.toMatch(testRegex('[0-9]+%', ''));
    });

    it('should show abbreviated context indicator', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should show abbreviated context format
      expect(output).toMatch(testRegex('Ctx:', ''));
      // Should NOT show full "Context:" text
      expect(output).not.toMatch(testRegex('Context:', ''));
    });

    it('should NOT show model name at narrow width', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should NOT show model name
      expect(output).not.toContain('gpt-4');
      expect(output).not.toMatch(testRegex('Model:', ''));
    });

    it('should NOT show timestamp at narrow width', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should NOT show timestamp
      expect(output).not.toMatch(testRegex('\\d{2}:\\d{2}:\\d{2}', ''));
    });

    it('should truncate long branch names', () => {
      const longBranchName =
        'feature/very-long-branch-name-that-needs-truncation-handling-for-narrow-display-mode';
      const { lastFrame } = render(
        <Footer {...defaultProps} branchName={longBranchName} />,
      );
      const output = lastFrame();

      // Branch name appears (may be truncated with ... or shown in full)
      expect(output).toMatch(testRegex('(feature|featur)', '')); // May be truncated
      // Should NOT show the complete full branch name
      expect(output).not.toContain(
        'feature/very-long-branch-name-that-needs-truncation-handling-for-narrow-display-mode',
      );
    });
  });

  describe('STANDARD width behavior (80-120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 100, rows: 20 });
    });

    it('should show full memory indicator label with Heap and RSS', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should show Heap and RSS labels
      expect(output).toMatch(testRegex('Heap:', ''));
      expect(output).toMatch(testRegex('RSS:', ''));
      // Should NOT show dimensionally-invalid percentage
      expect(output).not.toMatch(
        testRegex('Memory: \\d+% \\(\\d+\\.\\d+GB\\/\\d+\\.\\d+GB\\)', ''),
      );
      expect(output).not.toMatch(testRegex('Mem:', ''));
    });

    it('should show full context indicator label', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should show full "Context:" label
      expect(output).toMatch(testRegex('Context:', ''));
      // Should NOT show fully expanded token counts
      expect(output).not.toMatch(
        testRegex('Context: \\d+,\\d+\\/\\d+,\\d+ tokens', ''),
      );
    });

    it('should show model name at standard width', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should show model name
      expect(output).toContain('gemini-2.5-pro');
      // Model name shows without 'Model:' prefix now
    });

    it('should NOT show timestamp at standard width', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should NOT show timestamp
      expect(output).not.toMatch(testRegex('\\d{2}:\\d{2}:\\d{2}', ''));
    });
  });

  describe('WIDE width behavior (> 120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });
    });

    it('should show detailed memory usage with External and ArrayBuffers', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should show detailed memory format with heap, external, arrayBuffers, RSS
      expect(output).toMatch(testRegex('Heap:', ''));
      expect(output).toMatch(testRegex('RSS:', ''));
      expect(output).toMatch(testRegex('External:', ''));
      expect(output).toMatch(testRegex('ArrayBuffers:', ''));
      // Should NOT show percentage
      expect(output).not.toMatch(testRegex('Memory: \\d+%', ''));
    });

    it('should show detailed context usage with comma-separated numbers', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // ink-testing-library wraps at its internal column width; join lines
      // to verify the full detailed context pattern is present in the output.
      const joined = output!.replace(/\n/g, '');
      expect(joined).toMatch(
        testRegex('Context:\\s*\\d+,\\d+\\/\\d+,\\d+', ''),
      );
    });

    it('should show model name at wide width', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should show model name
      expect(output).toContain('gemini-2.5-pro');
      // Model name shows without 'Model:' prefix now
    });

    it('should show timestamp at wide width', () => {
      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // ink-testing-library wraps at its internal column width; join lines
      // to verify the timestamp pattern survives wrapping.
      const joined = output!.replace(/\n/g, '');
      expect(joined).toMatch(testRegex('\\d{1,2}:\\d{2}:\\d', ''));
    });

    it('should show full branch name when space allows', () => {
      const longBranchName =
        'feature/very-long-branch-name-that-needs-truncation';
      const { lastFrame } = renderFooter({
        ...defaultProps,
        branchName: longBranchName,
      });
      const output = lastFrame();

      // Should show branch name at wide width
      expect(output).toContain('feature/');
    });
  });

  describe('Breakpoint edge cases', () => {
    it('should handle exact breakpoint boundaries correctly', () => {
      // Test exactly at NARROW threshold (80 cols) - should be STANDARD
      mockUseTerminalSize.mockReturnValue({ columns: 80, rows: 20 });

      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // At exactly 80, should be STANDARD behavior
      expect(output).toMatch(testRegex('Heap:', '')); // Not abbreviated
      // Model is visible (not hidden as in NARROW). At exactly 80 cols the
      // long fixture strings cause the model name to wrap, so check for its
      // prefix rather than the full contiguous string.
      expect(output).toContain('gemini'); // Model shown
      expect(output).not.toMatch(testRegex('\\d{2}:\\d{2}:\\d{2}', '')); // No timestamp
    });

    it('should transition properly at STANDARD threshold', () => {
      // Test exactly at STANDARD threshold (120 cols) - should be STANDARD
      mockUseTerminalSize.mockReturnValue({ columns: 120, rows: 20 });

      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // At exactly 120, should be STANDARD behavior (not WIDE)
      expect(output).toMatch(testRegex('Heap:', ''));
      expect(output).toContain('gemini-2.5-pro');
      expect(output).not.toMatch(testRegex('\\d{2}:\\d{2}:\\d{2}', '')); // Still no timestamp
    });
  });

  describe('Information priority preservation', () => {
    it('should always show memory and context info at all widths', () => {
      const widths = [60, 100, 180];

      widths.forEach((width) => {
        mockUseTerminalSize.mockReturnValue({ columns: width, rows: 20 });
        const { lastFrame } = renderFooter(defaultProps);
        const output = lastFrame();

        // Memory and context should always be visible
        expect(output).toMatch(testRegex('Heap:', ''));
        expect(output).toMatch(testRegex('RSS:', ''));
        expect(output).toMatch(testRegex('(Ctx:|Context:)', ''));
      });
    });

    it('should show branch name at all widths (possibly truncated)', () => {
      const widths = [60, 100, 180];
      const longBranchName =
        'feature/very-long-branch-name-that-needs-truncation';

      widths.forEach((width) => {
        mockUseTerminalSize.mockReturnValue({ columns: width, rows: 20 });
        const { lastFrame } = renderFooter({
          ...defaultProps,
          branchName: longBranchName,
        });
        const output = lastFrame();

        // Branch should always be visible (even if truncated)
        expect(output).toMatch(testRegex('(feature|featur|\\.\\.\\.)', ''));
      });
    });
  });

  describe('Two-line layout requirement', () => {
    it('should organize content into logical 2-line structure', () => {
      const widths = [60, 100, 180];

      widths.forEach((width) => {
        mockUseTerminalSize.mockReturnValue({ columns: width, rows: 20 });
        const { lastFrame } = renderFooter(defaultProps);
        const output = lastFrame();

        if (!output) {
          throw new Error('Expected output to be defined');
        }

        // Should have status info (Heap|RSS|Context) separate from path info
        expect(output).toMatch(testRegex('Heap:', ''));
        expect(output).toMatch(testRegex('(Ctx:|Context:)', ''));
        // Path check - should contain path elements (may be truncated)
        expect(output).toMatch(
          testRegex('(home|user|projects|project-name)', ''),
        ); // Path (may be truncated)
        // Model only shown at standard+ widths
        expect(width < 80 || output.includes('gemini-2.5-pro')).toBe(true);
      });
    });

    it('should show Memory|Context|Time together when wide', () => {
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });

      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should have Heap, RSS, Context, and Time displayed
      expect(output).toMatch(testRegex('Heap:', ''));
      expect(output).toMatch(testRegex('RSS:', ''));
      expect(output).toMatch(testRegex('Context:', ''));
      // Timestamp may wrap due to ink-testing-library's internal column width
      const joined = output!.replace(/\n/g, '');
      expect(joined).toMatch(testRegex('\\d{1,2}:\\d{2}:\\d', ''));

      // Should also have path and model displayed
      expect(output).toMatch(
        testRegex('home.*user.*projects|long-project-name', ''),
      );
      expect(output).toContain('gemini-2.5-pro');
    });

    it('should organize Path and Model information appropriately', () => {
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });

      const { lastFrame } = renderFooter(defaultProps);
      const output = lastFrame();

      // Should contain path and model information
      expect(output).toMatch(
        testRegex('home.*user.*projects|long-project-name', ''),
      );
      expect(output).toContain('gemini-2.5-pro');
      expect(output).toContain('feature'); // Branch name (from defaultProps)

      // Should also have heap and context (they can be on separate logical lines)
      expect(output).toMatch(testRegex('Heap:', ''));
      expect(output).toMatch(testRegex('Context:', ''));
    });

    it('should adapt content appropriately across width breakpoints', () => {
      // Test narrow width
      mockUseTerminalSize.mockReturnValue({ columns: 60, rows: 20 });
      let { lastFrame } = renderFooter(defaultProps);
      let output = lastFrame();

      expect(output).toMatch(testRegex('Heap:', '')); // Always present
      expect(output).toMatch(testRegex('RSS:', '')); // Always present
      expect(output).toMatch(testRegex('Ctx:', '')); // Abbreviated
      expect(output).not.toMatch(testRegex('\\d{2}:\\d{2}:\\d{2}', '')); // No timestamp at narrow

      // Test standard width
      mockUseTerminalSize.mockReturnValue({ columns: 100, rows: 20 });
      ({ lastFrame } = renderFooter(defaultProps));
      output = lastFrame();

      expect(output).toMatch(testRegex('Heap:', '')); // Full label
      expect(output).toMatch(testRegex('Context:', '')); // Full label
      expect(output).not.toMatch(testRegex('\\d{2}:\\d{2}:\\d{2}', '')); // Still no timestamp at standard

      // Test wide width
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });
      ({ lastFrame } = renderFooter(defaultProps));
      output = lastFrame();

      expect(output).toMatch(testRegex('Heap:', '')); // Full label
      expect(output).toMatch(testRegex('External:', '')); // Detailed at wide
      expect(output).toMatch(testRegex('ArrayBuffers:', '')); // Detailed at wide
      expect(output).toMatch(testRegex('Context:', '')); // Full label
      // Timestamp may wrap due to ink-testing-library's internal column width
      const joinedWide = output!.replace(/\n/g, '');
      expect(joinedWide).toMatch(testRegex('\\d{1,2}:\\d{2}:\\d', '')); // Timestamp at wide
    });
  });
});
