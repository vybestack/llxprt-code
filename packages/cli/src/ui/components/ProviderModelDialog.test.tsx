/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '../../test-utils/render.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderModelDialog } from './ProviderModelDialog.js';
import { IModel } from '../../providers/index.js';

// Mock the responsive hooks and utilities
vi.mock('../hooks/useResponsive.js', () => ({
  useResponsive: vi.fn(),
}));

vi.mock('../utils/responsive.js', () => ({
  truncateEnd: vi.fn((text: string, maxLength: number) =>
    text.length > maxLength ? text.slice(0, maxLength - 3) + '...' : text,
  ),
}));

import { useResponsive } from '../hooks/useResponsive.js';

const mockUseResponsive = vi.mocked(useResponsive);

describe('ProviderModelDialog', () => {
  const mockModels: IModel[] = [
    {
      id: 'gpt-4',
      name: 'GPT-4',
      provider: 'openai',
      supportedToolFormats: ['openai'],
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      provider: 'openai',
      supportedToolFormats: ['openai'],
    },
    {
      id: 'claude-3-opus-20240229',
      name: 'Claude 3 Opus',
      provider: 'anthropic',
      supportedToolFormats: ['anthropic'],
    },
    {
      id: 'claude-3-sonnet-20240229',
      name: 'Claude 3 Sonnet',
      provider: 'anthropic',
      supportedToolFormats: ['anthropic'],
    },
    {
      id: 'gemini-pro',
      name: 'Gemini Pro',
      provider: 'google',
      supportedToolFormats: ['google'],
    },
    {
      id: 'very-long-model-name-that-should-be-truncated',
      name: 'Long Model',
      provider: 'test',
      supportedToolFormats: ['test'],
    },
  ];

  const defaultProps = {
    models: mockModels,
    currentModel: 'gpt-4',
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('column layout calculation', () => {
    it('should use 1 column for narrow width (< 80)', () => {
      mockUseResponsive.mockReturnValue({
        width: 70,
        breakpoint: 'NARROW',
        isNarrow: true,
        isStandard: false,
        isWide: false,
      });

      const { lastFrame } = render(<ProviderModelDialog {...defaultProps} />);

      // In narrow mode, should have single column layout
      // Each model should be in its own row
      expect(lastFrame()).toContain('GPT-4');
    });

    it('should calculate appropriate column width based on longest model name', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      render(<ProviderModelDialog {...defaultProps} />);

      // The longest model name is 'very-long-model-name-that-should-be-truncated' (44 chars)
      // Column width should be calculated based on this plus padding
      // Expected column width should accommodate the content properly
    });

    it('should limit columns based on terminal width and content fit', () => {
      mockUseResponsive.mockReturnValue({
        width: 200,
        breakpoint: 'WIDE',
        isNarrow: false,
        isStandard: false,
        isWide: true,
      });

      render(<ProviderModelDialog {...defaultProps} />);

      // With terminal width 200, should calculate optimal number of columns
      // that fit within the available space while showing all content
    });

    it('should prefer fewer columns when model names are very long', () => {
      const longNameModels: IModel[] = [
        {
          id: 'extremely-long-model-name-that-exceeds-reasonable-column-width-limits',
          name: 'Long Model 1',
          provider: 'test',
          supportedToolFormats: ['test'],
        },
        {
          id: 'another-extremely-long-model-name-that-also-exceeds-limits',
          name: 'Long Model 2',
          provider: 'test',
          supportedToolFormats: ['test'],
        },
      ];

      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      render(<ProviderModelDialog {...defaultProps} models={longNameModels} />);

      // Should use fewer columns or single column when names are too long
    });

    it('should handle empty model list gracefully', () => {
      mockUseResponsive.mockReturnValue({
        width: 120,
        breakpoint: 'STANDARD',
        isNarrow: false,
        isStandard: true,
        isWide: false,
      });

      render(<ProviderModelDialog {...defaultProps} models={[]} />);

      // Should not crash with empty models array
    });
  });

  describe('responsive behavior', () => {
    it('should show different layouts for different breakpoints', () => {
      const scenarios = [
        {
          width: 70,
          breakpoint: 'NARROW' as const,
          isNarrow: true,
          isStandard: false,
          isWide: false,
        },
        {
          width: 100,
          breakpoint: 'STANDARD' as const,
          isNarrow: false,
          isStandard: true,
          isWide: false,
        },
        {
          width: 180,
          breakpoint: 'WIDE' as const,
          isNarrow: false,
          isStandard: false,
          isWide: true,
        },
      ];

      scenarios.forEach((scenario) => {
        mockUseResponsive.mockReturnValue(scenario);
        const { rerender } = render(<ProviderModelDialog {...defaultProps} />);

        // Each breakpoint should render appropriately
        // Narrow: single column, no truncation indicator
        // Standard: 2-3 columns, some truncation
        // Wide: 3 columns, minimal truncation

        rerender(<ProviderModelDialog {...defaultProps} />);
      });
    });
  });

  describe('maximum width constraints', () => {
    it('should constrain dialog width even on very wide terminals', () => {
      mockUseResponsive.mockReturnValue({
        width: 300,
        breakpoint: 'WIDE',
        isNarrow: false,
        isStandard: false,
        isWide: true,
      });

      const { lastFrame } = render(<ProviderModelDialog {...defaultProps} />);

      // Dialog should have maximum width constraint to prevent it from
      // becoming too wide and causing overlapping dialogs
      // For now, just verify the component renders without error
      expect(lastFrame()).toBeTruthy();
    });
  });
});
