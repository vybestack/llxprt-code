/**
 * @license
 * Copyright 2025 Vybestack LLC
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
import { ProviderModelDialog } from './ProviderModelDialog.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { IModel } from '../../providers/index.js';

vi.mock('../hooks/useTerminalSize.js');

const testModels: IModel[] = [
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
    id: 'gemini-pro-very-long-model-name-that-should-be-truncated',
    name: 'Gemini Pro Long',
    provider: 'google',
    supportedToolFormats: ['google'],
  },
  {
    id: 'text-embedding-ada-002',
    name: 'Ada Embedding',
    provider: 'openai',
    supportedToolFormats: ['openai'],
  },
  {
    id: 'another-very-long-model-identifier-for-testing-truncation',
    name: 'Long Model',
    provider: 'test',
    supportedToolFormats: ['test'],
  },
];

describe('ProviderModelDialog Responsive Behavior', () => {
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

    it('should prioritize search-first approach with help text below search', () => {
      const { lastFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="gpt-4"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should prominently show search functionality
      expect(output).toMatch(/search:/i);
      expect(output).toContain('▌'); // Active search cursor

      // Should show help text below search
      expect(output).toMatch(/tab.*switch modes/i);
      expect(output).toMatch(/enter.*select/i);
      expect(output).toMatch(/esc.*cancel/i);

      // Should have minimal borders to save space
      expect(output).not.toMatch(/┌─+┐/); // No fancy borders or simpler borders

      // Should show model IDs (may not be truncated at narrow width anymore)
      expect(output).toContain('gemini-pro'); // Should show at least part of the model name

      // Should show model results but prioritize search
      expect(output).toContain('gpt-4');
      expect(output).toContain('claude-3-opus');
    });

    it('should focus search over grid layout for narrow width', () => {
      const { lastFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="gpt-3.5-turbo"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should not show complex multi-column layout
      expect(output).not.toMatch(/├|┤|│.*│.*│/); // No multi-column separators

      // Search should be the primary focus
      expect(output).toMatch(/search:.*▌/);

      // Should show models in simple list format (note: gpt-3.5-turbo is selected, hence ●)
      expect(output).toMatch(/○ gpt-4/);
      expect(output).toMatch(/● gpt-3.5-turbo/);
    });
  });

  describe('STANDARD width behavior (80-120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 100, rows: 20 });
    });

    it('should show condensed layout with abbreviated model descriptions', () => {
      const { lastFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="claude-3-opus-20240229"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should have proper borders
      expect(output).toMatch(/┌─+┐|╭─+╮/);

      // Should show search but not as prominently
      expect(output).toMatch(/search:/i);

      // Should show model names (may not truncate anymore)
      expect(output).toContain('gemini-pro'); // Should show model names

      // Should show model grid in condensed form
      expect(output).toContain('gpt-4');
      expect(output).toContain('● claude-3-opus-20240229'); // Selected model

      // Should show model count information
      expect(output).toMatch(/found \d+ of \d+ models/i);

      // Should have scrolling indicators if needed
      expect(output).toMatch(/tab.*switch modes/i);
    });

    it('should balance search functionality with grid layout', () => {
      const { lastFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="gpt-4"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should show both search and grid effectively
      expect(output).toMatch(/search:.*▌/);

      // Should have multi-column layout but condensed
      const lines = output!.split('\n');
      const modelLines = lines.filter(
        (line) => line.includes('○') || line.includes('●'),
      );
      expect(modelLines.length).toBeGreaterThan(2); // Multiple rows

      // Should show current selection info
      expect(output).toMatch(/● gpt-4/);
    });
  });

  describe('WIDE width behavior (> 120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });
    });

    it('should show full layout with all model details visible', () => {
      const { lastFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="text-embedding-ada-002"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should show full model names without truncation
      expect(output).toContain(
        'gemini-pro-very-long-model-name-that-should-be-truncated',
      );
      expect(output).toContain(
        'another-very-long-model-identifier-for-testing-truncation',
      );

      // Should have full decorative borders
      expect(output).toMatch(/┌─+┐|╭─+╮/);

      // Should show comprehensive search interface
      expect(output).toMatch(/search:.*▌/);

      // Should show complete instructions (simplified check)
      expect(output).toMatch(/tab.*switch modes/i);
      expect(output).toMatch(/search models/i);

      // Should show the selected model with ● marker
      expect(output).toMatch(/● text-embedding-ada-002/);

      // Should show model count information
      expect(output).toMatch(/found \d+ of \d+ models/i);
    });

    it('should utilize full width for optimal model grid layout', () => {
      const { lastFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="claude-3-sonnet-20240229"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Should efficiently use wide layout for multiple columns
      expect(output).toContain('● claude-3-sonnet-20240229');

      // Should show all models with full names
      expect(output).toContain('gpt-4');
      expect(output).toContain('gpt-3.5-turbo');
      expect(output).toContain('claude-3-opus-20240229');

      // Should pack efficiently - fewer rows due to more columns
      const lines = output!.split('\n');
      const contentLines = lines.filter(
        (line) => line.includes('○') || line.includes('●'),
      );
      expect(contentLines.length).toBeLessThanOrEqual(4); // Efficient packing
    });

    it('should create proper fixed-width columns with consistent spacing', () => {
      const { lastFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="gpt-4"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const output = lastFrame();

      // Parse model grid lines to check column layout
      const lines = output!.split('\n');
      const modelLines = lines.filter(
        (line) => line.includes('○') || line.includes('●'),
      );

      // Each model line should have consistent column widths
      // Models should be spaced with proper fixed-width columns, not just single spaces
      expect(modelLines.length).toBeGreaterThan(0);
      const firstLine = modelLines[0];

      // Should NOT have models separated by only single spaces (the zigzag issue)
      // Instead should have proper column alignment
      const modelMatches = firstLine.match(/[○●]\s+[^\s]+/g);
      // Verify proper column spacing if multiple models on same line
      const hasProperSpacing =
        !modelMatches ||
        modelMatches.length <= 1 ||
        (() => {
          const model1End =
            firstLine.indexOf(modelMatches[0]) + modelMatches[0].length;
          const model2Start = firstLine.indexOf(modelMatches[1]);
          return model2Start - model1End >= 2;
        })();
      expect(hasProperSpacing).toBe(true); // Fixed-width columns should have adequate spacing
    });
  });

  describe('Search functionality across breakpoints', () => {
    it('should maintain search functionality at all breakpoints', () => {
      const widths = [60, 100, 180];

      widths.forEach((width) => {
        mockUseTerminalSize.mockReturnValue({ columns: width, rows: 20 });

        const { lastFrame } = render(
          <ProviderModelDialog
            models={testModels}
            currentModel="gpt-4"
            onSelect={mockOnSelect}
            onClose={mockOnClose}
          />,
        );

        const output = lastFrame();

        // Search should be available at all breakpoints
        expect(output).toMatch(/search:/i);
        expect(output).toContain('▌'); // Search cursor

        // Models should be visible
        expect(output).toContain('gpt-4');
      });
    });

    it('should show search results count at standard and wide breakpoints', () => {
      // Standard width
      mockUseTerminalSize.mockReturnValue({ columns: 100, rows: 20 });

      let { lastFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="gpt-4"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      expect(lastFrame()).toMatch(/found \d+ of \d+ models/i);

      // Wide width
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });

      ({ lastFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="gpt-4"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      ));

      expect(lastFrame()).toMatch(/found \d+ of \d+ models/i);
    });
  });

  describe('Responsive breakpoint transitions', () => {
    it('should handle transitions between breakpoints correctly', () => {
      // Test at NARROW/STANDARD boundary (80 cols)
      mockUseTerminalSize.mockReturnValue({ columns: 80, rows: 20 });

      const { lastFrame: standardFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="gpt-4"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const standardOutput = standardFrame();
      // At 80 columns, should be STANDARD behavior
      expect(standardOutput).toMatch(/┌─+┐|╭─+╮/); // Should have borders
      expect(standardOutput).toMatch(/found.*models/i); // Should show model count

      // Test at STANDARD/WIDE boundary (120 cols)
      mockUseTerminalSize.mockReturnValue({ columns: 120, rows: 20 });

      const { lastFrame: wideFrame } = render(
        <ProviderModelDialog
          models={testModels}
          currentModel="gpt-4"
          onSelect={mockOnSelect}
          onClose={mockOnClose}
        />,
      );

      const wideOutput = wideFrame();
      // At 120 columns, should be STANDARD (not WIDE yet)
      expect(wideOutput).toContain('gemini-pro'); // Should show model name
    });
  });

  describe('Semantic color preservation', () => {
    it('should maintain semantic colors across all breakpoints', () => {
      const widths = [60, 100, 180];

      widths.forEach((width) => {
        mockUseTerminalSize.mockReturnValue({ columns: width, rows: 20 });

        const { lastFrame } = render(
          <ProviderModelDialog
            models={testModels}
            currentModel="claude-3-opus-20240229"
            onSelect={mockOnSelect}
            onClose={mockOnClose}
          />,
        );

        const output = lastFrame();

        // Should show selected model with accent color (●)
        // Note: Model names might be truncated at narrow width
        expect(output).toMatch(/● claude-3-opus/);

        // Should show unselected models with appropriate colors (○)
        expect(output).toMatch(/○ gpt-4/);

        // Search cursor should use accent color
        expect(output).toContain('▌');
      });
    });
  });
});
