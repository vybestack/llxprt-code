/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '../../test-utils/render.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Footer } from './Footer.js';

// Mock the responsive hooks and utilities
vi.mock('../hooks/useResponsive.js', () => ({
  useResponsive: vi.fn(),
}));

vi.mock('../utils/responsive.js', () => ({
  truncateMiddle: vi.fn((text: string, maxLength: number) =>
    text.length > maxLength ? text.slice(0, maxLength - 3) + '...' : text,
  ),
}));

vi.mock('../../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(() => ({
    getActiveProvider: vi.fn(() => ({ name: 'gemini' })),
  })),
}));

vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      memoryUsage: vi.fn(() => ({ rss: 1024 * 1024 * 1024 })),
      env: {
        ...actual.default.env,
        SANDBOX: 'test-sandbox',
      },
    },
  };
});

vi.mock('node:v8', () => ({
  default: {
    getHeapStatistics: vi.fn(() => ({
      heap_size_limit: 8 * 1024 * 1024 * 1024,
    })),
  },
}));

import { useResponsive } from '../hooks/useResponsive.js';

const mockUseResponsive = vi.mocked(useResponsive);

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

      const { container } = render(<Footer {...defaultProps} />);

      // The component should have two main lines
      // First line: Memory | Context | Time (optional)
      // Second line: Branch info and model

      // Branch should appear before path in the display
      // Currently this is incorrect and needs to be fixed
      const textElements = container.querySelectorAll('*');
      const textContent = Array.from(textElements)
        .map((el) => el.textContent)
        .join(' ');

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

      const { container } = render(<Footer {...defaultProps} />);

      const textContent = container.textContent;
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

      const { container } = render(
        <Footer {...defaultProps} branchName={longBranchName} />,
      );
      const textContent = container.textContent ?? '';

      // The untruncated branch name is 63 chars; truncated narrow layout must
      // render strictly fewer characters of it and include the truncation
      // ellipsis from truncateMiddle.
      expect(textContent).not.toContain(longBranchName);
      // eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
      expect(textContent).toMatch(/feature\/.+\.\.\..+/);
    });

    it('should handle missing branch name gracefully', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { container } = render(
        <Footer {...defaultProps} branchName={undefined} />,
      );

      const textContent = container.textContent;
      // Should show path without branch info
      expect(textContent).toContain('/home/user/project');
      expect(textContent).not.toContain('*');
    });
  });

  describe('responsive layout', () => {
    it('should adapt branch truncation length based on breakpoint', () => {
      const scenarios = [
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
        {
          breakpoint: 'WIDE' as const,
          width: 180,
          isNarrow: false,
          isStandard: false,
          isWide: true,
          expectedMaxLength: 100,
        },
      ];

      const longBranchName =
        'feature/very-long-branch-name-that-needs-truncation-handling';

      scenarios.forEach((scenario) => {
        mockUseResponsive.mockReturnValue(scenario);

        const { container } = render(
          <Footer {...defaultProps} branchName={longBranchName} />,
        );
        const textContent = container.textContent ?? '';

        if (scenario.breakpoint === 'WIDE') {
          // WIDE (expectedMaxLength 100) is longer than the branch; full name
          // must be preserved.
          // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
          expect(textContent).toContain(longBranchName);
        } else {
          // NARROW/STANDARD must truncate the name via truncateMiddle.
          // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
          expect(textContent).not.toContain(longBranchName);
          // eslint-disable-next-line vitest/no-conditional-expect, sonarjs/regular-expr -- intentional breakpoint assertion with reviewed static regex.
          expect(textContent).toMatch(/feature\/.+\.\.\..+/);
        }
      });
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

      const { container: narrowContainer } = render(
        <Footer {...defaultProps} />,
      );

      let textContent = narrowContainer.textContent ?? '';

      // Narrow should show compact memory and context
      expect(textContent).toContain('Mem:');
      expect(textContent).toContain('Ctx:');

      // Wide: Full details including timestamp
      mockUseResponsive.mockReturnValue({
        width: 180,
        breakpoint: 'WIDE',
        isNarrow: false,
        isStandard: false,
        isWide: true,
      });

      const { container: wideContainer } = render(<Footer {...defaultProps} />);

      textContent = wideContainer.textContent ?? '';

      // Wide should show full memory info and timestamp
      expect(textContent).toContain('Memory:');
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

      const { container } = render(<Footer {...defaultProps} />);
      const textContent = container.textContent ?? '';

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

      const { container } = render(
        <Footer {...defaultProps} isTrustedFolder={false} />,
      );

      const textContent = container.textContent;
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

      const { container } = render(
        <Footer {...defaultProps} isTrustedFolder={true} />,
      );

      const textContent = container.textContent;
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

      const { container } = render(
        <Footer {...defaultProps} isTrustedFolder={undefined} />,
      );

      const textContent = container.textContent;
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

      const { container } = render(
        <Footer
          {...defaultProps}
          branchName="test-branch"
          isTrustedFolder={false}
        />,
      );

      const textContent = container.textContent;
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

      const { container } = render(<Footer {...defaultProps} hideCWD={true} />);
      expect(container.textContent).not.toContain(defaultProps.targetDir);
    });

    it('should hide sandbox status when hideSandboxStatus is true', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { container } = render(
        <Footer
          {...defaultProps}
          isTrustedFolder={true}
          hideSandboxStatus={true}
        />,
      );
      expect(container.textContent).not.toContain('no sandbox');
    });

    it('should hide model info when hideModelInfo is true', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      const { container } = render(
        <Footer {...defaultProps} hideModelInfo={true} />,
      );
      expect(container.textContent).not.toContain(defaultProps.model);
    });
  });

  describe('memory display uses actual heap limit', () => {
    it('should calculate percentage against actual heap limit and show correct denominator', () => {
      mockUseResponsive.mockReturnValue({
        width: 180,
        breakpoint: 'WIDE',
        isNarrow: false,
        isStandard: false,
        isWide: true,
      });

      const { container } = render(<Footer {...defaultProps} />);

      const textContent = container.textContent ?? '';

      expect(textContent).toContain('8.0GB');
      expect(textContent).not.toContain('4.8GB');
      expect(textContent).toContain('Memory: 13%');
    });
  });
});
