/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from 'vitest';
import { ProviderDialog } from './ProviderDialog.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

vi.mock('../hooks/useTerminalSize.js');

const testProviders = [
  'anthropic',
  'openai',
  'gemini',
  'azure-openai',
  'very-long-provider-name-that-should-be-truncated',
  'short',
  'another-moderately-long-provider-name',
];

describe('ProviderDialog Responsive Behavior', () => {
  let mockUseTerminalSize: MockedFunction<typeof useTerminalSize>;
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTerminalSize = useTerminalSize as MockedFunction<
      typeof useTerminalSize
    >;
  });

  describe('NARROW width behavior (< 80 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 60, rows: 20 });
    });

    it('should show search-first approach with help text below search', () => {
      const { lastFrame } = render(
        <ProviderDialog
          providers={testProviders}
          currentProvider="openai"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should have search input prominently displayed
      expect(output).toMatch(/search:/i);
      expect(output).toMatch(/type to filter/i);

      // Should have help text below search
      expect(output).toMatch(/enter to select.*esc to cancel/i);

      // Should have minimal or no borders
      expect(output).not.toMatch(/┌─+┐/); // No fancy borders

      // Should show abbreviated provider names
      expect(output).toContain('anthropic');
      expect(output).toContain('openai');
      expect(output).not.toContain(
        'very-long-provider-name-that-should-be-truncated',
      ); // Should be truncated
      expect(output).toMatch(/very-long.*\.\.\./); // Should show truncated version
    });

    it('should focus on search functionality over grid layout', () => {
      const { lastFrame } = render(
        <ProviderDialog
          providers={testProviders}
          currentProvider="openai"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should not show complex grid layout
      expect(output).not.toMatch(/├|┤|│.*│.*│/); // No multi-column separators

      // Should show results in single column or minimal columns
      expect(output).toMatch(/● openai/); // Selected item should be visible
    });
  });

  describe('STANDARD width behavior (80-120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 100, rows: 20 });
    });

    it('should show condensed layout with abbreviated descriptions', () => {
      const { lastFrame } = render(
        <ProviderDialog
          providers={testProviders}
          currentProvider="openai"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should have proper borders
      expect(output).toMatch(/┌─+┐|╭─+╮/); // Should have borders

      // Should show providers in a grid layout but condensed
      expect(output).toContain('anthropic');
      expect(output).toContain('openai');
      expect(output).toContain('gemini');

      // Should show abbreviated long names
      expect(output).toMatch(/very-long.*\.\.\./);
      expect(output).not.toContain(
        'very-long-provider-name-that-should-be-truncated',
      );

      // Should have navigation instructions
      expect(output).toMatch(/←\/→\/↑\/↓.*enter.*esc/i);
    });

    it('should optimize for multi-column layout within width constraints', () => {
      const { lastFrame } = render(
        <ProviderDialog
          providers={testProviders}
          currentProvider="anthropic"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should show multiple providers per row when possible
      expect(output).toMatch(/● anthropic.*○/); // Selected and another on same line or nearby

      // Should show reasonable number of columns (2-3 for standard width)
      const lines = output.split('\n');
      const providerLines = lines.filter(
        (line) => line.includes('○') || line.includes('●'),
      );
      expect(providerLines.length).toBeGreaterThan(1); // Multiple rows
    });
  });

  describe('WIDE width behavior (> 120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });
    });

    it('should show full layout with all details visible', () => {
      const { lastFrame } = render(
        <ProviderDialog
          providers={testProviders}
          currentProvider="azure-openai"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should show full provider names without truncation
      expect(output).toContain(
        'very-long-provider-name-that-should-be-truncated',
      );
      expect(output).toContain('another-moderately-long-provider-name');

      // Should have full decorative borders
      expect(output).toMatch(/┌─+┐|╭─+╮/);

      // Should show full instructions
      expect(output).toMatch(
        /select provider.*←\/→\/↑\/↓.*enter to choose.*esc to cancel/i,
      );

      // Should have optimal multi-column layout
      expect(output).toContain('● azure-openai'); // Current selection visible
    });

    it('should utilize full width for optimal grid layout', () => {
      const { lastFrame } = render(
        <ProviderDialog
          providers={testProviders}
          currentProvider="gemini"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should show multiple columns efficiently using wide width
      const lines = output.split('\n');
      const contentLines = lines.filter(
        (line) => line.includes('○') || line.includes('●'),
      );
      expect(contentLines.length).toBeLessThanOrEqual(3); // Should pack efficiently in wide layout

      // Should show all providers
      expect(output).toContain('anthropic');
      expect(output).toContain('● gemini');
      expect(output).toContain('azure-openai');
      expect(output).toContain(
        'very-long-provider-name-that-should-be-truncated',
      );
    });
  });

  describe('Responsive breakpoint transitions', () => {
    it('should handle transitions between breakpoints correctly', () => {
      // Test exactly at NARROW/STANDARD boundary (80 cols)
      mockUseTerminalSize.mockReturnValue({ columns: 80, rows: 20 });

      const { lastFrame: standardFrame } = render(
        <ProviderDialog
          providers={testProviders}
          currentProvider="openai"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const standardOutput = standardFrame();
      // At 80 columns, should be STANDARD behavior (not NARROW)
      expect(standardOutput).toMatch(/┌─+┐|╭─+╮/); // Should have borders
      expect(standardOutput).not.toMatch(/type to filter/i); // No search-first approach

      // Test exactly at STANDARD/WIDE boundary (120 cols)
      mockUseTerminalSize.mockReturnValue({ columns: 120, rows: 20 });

      const { lastFrame: wideFrame } = render(
        <ProviderDialog
          providers={testProviders}
          currentProvider="openai"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const wideOutput = wideFrame();
      // At 120 columns, should be STANDARD behavior (not WIDE yet)
      expect(wideOutput).toMatch(/very-long.*\.\.\./); // Should still truncate at boundary
      expect(wideOutput).not.toContain(
        'very-long-provider-name-that-should-be-truncated',
      );
    });
  });

  describe('Semantic color preservation', () => {
    it('should maintain semantic colors across all breakpoints', () => {
      // Test that semantic colors are preserved at each breakpoint
      const widths = [60, 100, 180];

      widths.forEach((width) => {
        mockUseTerminalSize.mockReturnValue({ columns: width, rows: 20 });

        const { lastFrame } = render(
          <ProviderDialog
            providers={testProviders}
            currentProvider="openai"
            onSelect={mockOnSelect}
            onClose={mockOnClose}
          />,
        );

        const output = lastFrame();

        // Should show selected provider with accent color (●)
        expect(output).toMatch(/● openai/);

        // Should show unselected providers with primary color (○)
        expect(output).toMatch(/○ anthropic/);
      });
    });
  });
});
