/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '../../test-utils/render.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { Mock } from 'bun:test';
import { act } from 'react';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { Footer } from './Footer.js';

let mockProcessVersions: NodeJS.ProcessVersions;
const mockHeapStatistics: { heap_size_limit: number } = {
  heap_size_limit: 8 * 1024 ** 3,
};
const mockMemoryUsage: NodeJS.MemoryUsage = {
  rss: 1024 * 1024 * 1024,
  heapUsed: 100 * 1024 * 1024,
  heapTotal: 200 * 1024 * 1024,
  external: 10 * 1024 * 1024,
  arrayBuffers: 5 * 1024 * 1024,
};

// Mock the responsive hooks and utilities
void vi.mock('../hooks/useResponsive.js', () => ({
  useResponsive: vi.fn(),
}));

void vi.mock('../utils/responsive.js', () => ({
  truncateMiddle: vi.fn((text: string, maxLength: number) =>
    text.length > maxLength ? text.slice(0, maxLength - 3) + '...' : text,
  ),
}));

const actual = { ...(await import('node:process')) };
void vi.mock('node:process', () => {
  // Under Bun, require('node:process') returns the process namespace
  // directly (no .default wrapper), so normalize the shape.
  const actualDefault =
    (actual as { default?: typeof process }).default ?? actual;
  mockProcessVersions = { ...actualDefault.versions };
  return {
    ...actual,
    default: {
      ...actualDefault,
      memoryUsage: vi.fn(() => ({ ...mockMemoryUsage })),
      versions: mockProcessVersions,
      env: {
        ...actualDefault.env,
        SANDBOX: 'test-sandbox',
      },
    },
  };
});

void vi.mock('node:v8', () => ({
  default: {
    getHeapStatistics: vi.fn(() => mockHeapStatistics),
  },
}));

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => ({
    getActiveProviderStatus: () => ({ providerName: 'gemini' }),
  }),
}));

import { useResponsive } from '../hooks/useResponsive.js';
import { testRegex } from '../../test-utils/regex.js';

const mockUseResponsive = useResponsive as Mock<typeof useResponsive>;

function footerFrameOrEmpty(frame: string | undefined): string {
  return frame ?? '';
}

describe('Footer', () => {
  const defaultProps = {
    model: 'gpt-4',
    targetDir: '/home/user/project',
    branchName: '20250808-gmerge',
    debugMode: false,
    debugMessage: '',
    errorCount: 0,
    showErrorDetails: false,
    showMemoryUsage: true,
    historyTokenCount: 1000,
    isPaidMode: false,
    nightly: false,
    contextLimit: 100000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessVersions.bun = '';
    mockHeapStatistics.heap_size_limit = 8 * 1024 ** 3;
    mockMemoryUsage.rss = 1024 * 1024 * 1024;
    mockMemoryUsage.heapUsed = 100 * 1024 * 1024;
    mockMemoryUsage.heapTotal = 200 * 1024 * 1024;
    mockMemoryUsage.external = 10 * 1024 * 1024;
    mockMemoryUsage.arrayBuffers = 5 * 1024 * 1024;
  });

  describe('branch and path display order', () => {
    it('should display branch first, then path on second line', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(<Footer {...defaultProps} />);

      // Branch should appear before path in the display
      const textContent = footerFrameOrEmpty(lastFrame());

      // Should contain branch name
      expect(textContent).toContain('20250808-gmerge');
      expect(textContent).toContain('/home/user/project');
    });

    it('should show branch with asterisk to indicate modified state', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(<Footer {...defaultProps} />);

      const textContent = lastFrame();
      // Branch should have asterisk indicating modified state
      expect(textContent).toContain('20250808-gmerge*');
    });

    it('should truncate long branch names appropriately', () => {
      const longBranchName =
        'feature/very-long-branch-name-that-should-be-truncated-properly';

      mockUseResponsive.mockReturnValue({
        width: 80,
        breakpoint: 'NARROW',
        isNarrow: true,
        isStandard: false,
        isWide: false,
      });

      const { lastFrame } = render(
        <Footer {...defaultProps} branchName={longBranchName} />,
      );
      const textContent = footerFrameOrEmpty(lastFrame());

      // The untruncated branch name is 63 chars; truncated narrow layout must
      // render strictly fewer characters of it and include the truncation
      // ellipsis from truncateMiddle.
      expect(textContent).not.toContain(longBranchName);
      expect(textContent).toMatch(testRegex('feature\\/.+\\.\\.\\..+', ''));
    });

    it('should handle missing branch name gracefully', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(
        <Footer {...defaultProps} branchName={undefined} />,
      );

      const textContent = lastFrame();
      // Should show path without branch info
      expect(textContent).toContain('/home/user/project');
      expect(textContent).not.toContain('*');
    });
  });

  describe('responsive layout', () => {
    const longBranchName =
      'feature/very-long-branch-name-that-needs-truncation-handling';

    // NARROW/STANDARD breakpoints have a max length shorter than the branch
    // name, so truncateMiddle must shorten it.
    const truncatingScenarios = [
      {
        breakpoint: 'NARROW' as const,
        width: 70,
        isNarrow: true,
        isStandard: false,
        isWide: false,
        expectedMaxLength: 15,
      },
      {
        breakpoint: 'STANDARD' as const,
        width: 100,
        isNarrow: false,
        isStandard: true,
        isWide: false,
        expectedMaxLength: 35,
      },
    ];

    // WIDE's max length (100) exceeds the branch name, so it is preserved.
    const preservingScenario = {
      breakpoint: 'WIDE' as const,
      width: 180,
      isNarrow: false,
      isStandard: false,
      isWide: true,
      expectedMaxLength: 100,
    };

    it.each(truncatingScenarios)(
      'truncates the branch name at the $breakpoint breakpoint',
      (scenario) => {
        mockUseResponsive.mockReturnValue(scenario);

        const { lastFrame } = render(
          <Footer {...defaultProps} branchName={longBranchName} />,
        );
        const textContent = footerFrameOrEmpty(lastFrame());

        expect(textContent).not.toContain(longBranchName);
        expect(textContent).toMatch(testRegex('feature\\/.+\\.\\.\\..+', ''));
      },
    );

    it('preserves the full branch name at the WIDE breakpoint', () => {
      mockUseResponsive.mockReturnValue(preservingScenario);

      const { lastFrame } = render(
        <Footer {...defaultProps} branchName={longBranchName} />,
      );
      const textContent = footerFrameOrEmpty(lastFrame());

      // WIDE breakpoint has enough room so truncateMiddle must not fire.
      //
      // The test renderer's stdout is 100 columns, so the untruncated name is
      // split across lines with other footer columns interleaved; a plain
      // toContain would fail on the wrap rather than on a real defect. Assert
      // instead that every character of the name survives IN ORDER, which
      // still fails if the middle is corrupted, reordered or dropped.
      expect(textContent).not.toContain('...');
      const flattened = textContent.replace(/\n/g, '');
      let cursor = 0;
      for (const char of longBranchName) {
        cursor = flattened.indexOf(char, cursor);
        expect(cursor).toBeGreaterThanOrEqual(0);
        cursor += 1;
      }
    });

    it('should show different information based on breakpoint', () => {
      // Narrow: Compact display, minimal info
      mockUseResponsive.mockReturnValue({
        width: 70,
        breakpoint: 'NARROW',
        isNarrow: true,
        isStandard: false,
        isWide: false,
      });

      const { lastFrame: narrowLastFrame } = render(
        <Footer {...defaultProps} />,
      );

      let textContent = footerFrameOrEmpty(narrowLastFrame());

      // Narrow should show compact memory and context
      expect(textContent).toContain('Heap:');
      expect(textContent).toContain('Ctx:');

      // Wide: Full details including timestamp
      mockUseResponsive.mockReturnValue({
        width: 180,
        breakpoint: 'WIDE',
        isNarrow: false,
        isStandard: false,
        isWide: true,
      });

      const { lastFrame: wideLastFrame } = render(<Footer {...defaultProps} />);

      textContent = footerFrameOrEmpty(wideLastFrame());

      // Wide should show full heap info (External, ArrayBuffers)
      expect(textContent).toContain('External:');
    });
  });

  describe('information display priority', () => {
    it('should prioritize branch information in the correct line order', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(<Footer {...defaultProps} />);
      const textContent = footerFrameOrEmpty(lastFrame());

      // Branch (with modified asterisk) and path must both render, with the
      // branch indicator appearing before the path in reading order so the
      // branch is the more prominent element on the path line.
      const branchIdx = textContent.indexOf('20250808-gmerge*');
      const pathIdx = textContent.indexOf('/home/user/project');
      expect(branchIdx).toBeGreaterThanOrEqual(0);
      expect(pathIdx).toBeGreaterThanOrEqual(0);
      expect(branchIdx).toBeLessThan(pathIdx);
    });
  });

  describe('untrusted folder display', () => {
    it('should show (untrusted) when isTrustedFolder is false', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(
        <Footer {...defaultProps} isTrustedFolder={false} />,
      );

      const textContent = lastFrame();
      expect(textContent).toContain('(untrusted)');
    });

    it('should not show (untrusted) when isTrustedFolder is true', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(
        <Footer {...defaultProps} isTrustedFolder={true} />,
      );

      const textContent = lastFrame();
      expect(textContent).not.toContain('(untrusted)');
    });

    it('should not show (untrusted) when isTrustedFolder is undefined', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(
        <Footer {...defaultProps} isTrustedFolder={undefined} />,
      );

      const textContent = lastFrame();
      expect(textContent).not.toContain('(untrusted)');
    });

    it('should show (untrusted) after branch name when both are present', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(
        <Footer
          {...defaultProps}
          branchName="test-branch"
          isTrustedFolder={false}
        />,
      );

      const textContent = lastFrame();
      expect(textContent).toContain('test-branch*');
      expect(textContent).toContain('(untrusted)');
    });
  });

  describe('visibility toggles', () => {
    it('should hide CWD when hideCWD is true', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(<Footer {...defaultProps} hideCWD={true} />);
      expect(lastFrame()).not.toContain(defaultProps.targetDir);
    });

    it('should hide sandbox status when hideSandboxStatus is true', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(
        <Footer
          {...defaultProps}
          isTrustedFolder={true}
          hideSandboxStatus={true}
        />,
      );
      expect(lastFrame()).not.toContain('no sandbox');
    });

    it('should hide model info when hideModelInfo is true', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(
        <Footer {...defaultProps} hideModelInfo={true} />,
      );
      expect(lastFrame()).not.toContain(defaultProps.model);
    });
  });

  describe('memory display uses actual heap limit', () => {
    it('should calculate percentage against actual heap limit and show correct denominator', () => {
      mockProcessVersions.bun = '';
      mockUseResponsive.mockReturnValue({
        width: 180,
        breakpoint: 'WIDE',
        isNarrow: false,
        isStandard: false,
        isWide: true,
      });

      const { lastFrame } = render(<Footer {...defaultProps} />);

      const textContent = footerFrameOrEmpty(lastFrame());

      expect(textContent).toContain('8.0GB');
      expect(textContent).not.toContain('4.8GB');
    });
  });

  describe('Bun memory display (no heap denominator)', () => {
    afterEach(() => {
      mockProcessVersions.bun = '';
    });

    it('compact: Heap shows used heap only with G suffix, no denominator, RSS present', () => {
      mockProcessVersions.bun = '1.3.14';
      mockUseResponsive.mockReturnValue({
        width: 70,
        breakpoint: 'NARROW',
        isNarrow: true,
        isStandard: false,
        isWide: false,
      });

      const { lastFrame } = render(<Footer {...defaultProps} />);

      const textContent = footerFrameOrEmpty(lastFrame());
      expect(textContent).toContain('Heap: 0.1G');
      expect(textContent).not.toContain('0.1G/');
      expect(textContent).toContain('RSS:');
    });

    it('standard: Heap shows used heap only with GB suffix, no denominator, RSS present', () => {
      mockProcessVersions.bun = '1.3.14';
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(<Footer {...defaultProps} />);

      const textContent = footerFrameOrEmpty(lastFrame());
      expect(textContent).toContain('Heap: 0.1GB');
      expect(textContent).not.toContain('0.1GB/');
      expect(textContent).toContain('RSS:');
    });

    it('wide: Heap, External, ArrayBuffers, and RSS all present with no denominator', () => {
      mockProcessVersions.bun = '1.3.14';
      mockUseResponsive.mockReturnValue({
        width: 180,
        breakpoint: 'WIDE',
        isNarrow: false,
        isStandard: false,
        isWide: true,
      });

      const { lastFrame } = render(<Footer {...defaultProps} />);

      const textContent = footerFrameOrEmpty(lastFrame());
      expect(textContent).toContain('Heap: 0.1GB');
      expect(textContent).not.toContain('0.1GB/');
      expect(textContent).toContain('External:');
      expect(textContent).toContain('ArrayBuffers:');
      expect(textContent).toContain('RSS:');
    });

    it('does not show the heap-limit denominator even when v8 reports a large limit', () => {
      mockProcessVersions.bun = '1.3.14';
      mockHeapStatistics.heap_size_limit = 8 * 1024 ** 3;
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { lastFrame } = render(<Footer {...defaultProps} />);

      const textContent = footerFrameOrEmpty(lastFrame());
      expect(textContent).not.toContain('8.0GB');
    });
  });

  describe('Node memory display re-reads heap statistic on refresh', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('updates the denominator when the heap statistic changes on the two-second refresh', async () => {
      mockProcessVersions.bun = '';
      mockHeapStatistics.heap_size_limit = 4 * 1024 ** 3;

      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      vi.useFakeTimers();

      const { lastFrame } = render(<Footer {...defaultProps} />);

      let textContent = footerFrameOrEmpty(lastFrame());
      expect(textContent).toContain('0.1GB/4.0GB');

      mockHeapStatistics.heap_size_limit = 8 * 1024 ** 3;

      await act(async () => {
        await advanceTimersByTimeAsync(2000);
      });

      textContent = footerFrameOrEmpty(lastFrame());
      expect(textContent).toContain('0.1GB/8.0GB');
      expect(textContent).not.toContain('4.0GB');
    });
  });

  describe('Bun memory display refreshes on the two-second timer', () => {
    afterEach(() => {
      vi.useRealTimers();
      mockProcessVersions.bun = '';
    });

    it('renders updated heap and RSS values after the refresh with no heap-limit denominator', async () => {
      mockProcessVersions.bun = '1.3.14';
      mockUseResponsive.mockReturnValue({
        width: 180,
        breakpoint: 'WIDE',
        isNarrow: false,
        isStandard: false,
        isWide: true,
      });

      vi.useFakeTimers();

      const { lastFrame } = render(<Footer {...defaultProps} />);

      let textContent = footerFrameOrEmpty(lastFrame());
      expect(textContent).toContain('Heap: 0.1GB');
      expect(textContent).toContain('RSS: 1.0GB');
      expect(textContent).not.toContain('0.1GB/');

      mockMemoryUsage.heapUsed = 300 * 1024 * 1024;
      mockMemoryUsage.rss = 2 * 1024 * 1024 * 1024;
      mockMemoryUsage.external = 20 * 1024 * 1024;
      mockMemoryUsage.arrayBuffers = 8 * 1024 * 1024;

      await act(async () => {
        await advanceTimersByTimeAsync(2000);
      });

      textContent = footerFrameOrEmpty(lastFrame());
      expect(textContent).toContain('Heap: 0.3GB');
      expect(textContent).toContain('RSS: 2.0GB');
      expect(textContent).toContain('External: 0.0GB');
      expect(textContent).toContain('ArrayBuffers: 0.0GB');
      expect(textContent).not.toContain('0.3GB/');
      expect(textContent).not.toContain('8.0GB');
    });
  });
});
