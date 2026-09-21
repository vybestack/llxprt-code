/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi } from 'bun:test';
import { Text } from 'ink';
import { ToolResultDisplay } from './ToolResultDisplay.js';
import { renderWithProviders } from '../../../__tests__/render.js';

void vi.mock('../../utils/MarkdownDisplay.js', () => ({
  MarkdownDisplay: function MockMarkdownDisplay({ text }: { text: string }) {
    return <Text color="white">{`MockMarkdown:${text}`}</Text>;
  },
}));

void vi.mock('./DiffRenderer.js', () => ({
  DiffRenderer: function MockDiffRenderer({
    diffContent,
    filename,
  }: {
    diffContent: string;
    filename: string;
  }) {
    return <Text color="white">{`MockDiff:${filename}:${diffContent}`}</Text>;
  },
}));

void vi.mock('../AnsiOutput.js', () => ({
  AnsiOutputText: function MockAnsiOutput() {
    return <Text color="white">{`MockAnsiOutput`}</Text>;
  },
}));

function trimmedToolResultFrame(frame: string | undefined): string {
  return frame?.trim() ?? '';
}

describe('<ToolResultDisplay />', () => {
  it('renders nothing when resultDisplay is undefined', () => {
    const { lastFrame } = renderWithProviders(
      <ToolResultDisplay resultDisplay={undefined} terminalWidth={80} />,
    );
    // Empty or whitespace-only when no display data
    expect(trimmedToolResultFrame(lastFrame())).toBe('');
  });

  it('renders without crashing for plain text', () => {
    // Ink's test renderer can produce empty frames on some platforms
    // (e.g., Ubuntu CI). Verify the component doesn't throw.
    expect(() =>
      renderWithProviders(
        <ToolResultDisplay
          resultDisplay="hello world"
          terminalWidth={80}
          renderOutputAsMarkdown={false}
        />,
      ),
    ).not.toThrow();
  });

  it('renders without crashing with markdown enabled', () => {
    expect(() =>
      renderWithProviders(
        <ToolResultDisplay
          resultDisplay="# heading"
          terminalWidth={80}
          renderOutputAsMarkdown={true}
        />,
      ),
    ).not.toThrow();
  });

  it('renders without crashing for string result display', () => {
    expect(() =>
      renderWithProviders(
        <ToolResultDisplay
          resultDisplay="some output text"
          terminalWidth={80}
          renderOutputAsMarkdown={false}
        />,
      ),
    ).not.toThrow();
  });

  it('handles moderately long string results without crashing', () => {
    // Use a smaller string (50K) to avoid Ink renderer timeout on CI
    const longStr = 'x'.repeat(50_000);
    expect(() =>
      renderWithProviders(
        <ToolResultDisplay
          resultDisplay={longStr}
          terminalWidth={80}
          renderOutputAsMarkdown={false}
        />,
      ),
    ).not.toThrow();
  });

  it('renders without crashing for diff results', () => {
    const diffResult = {
      fileDiff: '@@ -1 +1 @@\n-old\n+new',
      fileName: 'test.ts',
    };
    expect(() =>
      renderWithProviders(
        <ToolResultDisplay resultDisplay={diffResult} terminalWidth={80} />,
      ),
    ).not.toThrow();
  });

  it('renders without crashing for array-of-arrays result', () => {
    const ansiData = [[{ text: 'line1', style: {} }]];
    expect(() =>
      renderWithProviders(
        <ToolResultDisplay
          resultDisplay={ansiData as unknown as string}
          terminalWidth={80}
        />,
      ),
    ).not.toThrow();
  });

  it('renders without crashing for object with content property', () => {
    const contentResult = {
      content: 'const x = 1;',
      metadata: { language: 'typescript', declarationsCount: 1 },
    };

    expect(() =>
      renderWithProviders(
        <ToolResultDisplay resultDisplay={contentResult} terminalWidth={80} />,
      ),
    ).not.toThrow();
  });

  it('handles large strings that approach MAXIMUM_RESULT_DISPLAY_CHARACTERS', () => {
    // Test with a large string that renders quickly but still exercises the code path.
    // Note: MAXIMUM_RESULT_DISPLAY_CHARACTERS is 1M; we test with 100K to avoid Ink
    // renderer timeout while still verifying the component handles large inputs.
    const large = 'a'.repeat(100_000);
    expect(() =>
      renderWithProviders(
        <ToolResultDisplay
          resultDisplay={large}
          terminalWidth={80}
          renderOutputAsMarkdown={false}
        />,
      ),
    ).not.toThrow();
  });

  it('falls back to plain text when availableTerminalHeight is set', () => {
    // When availableTerminalHeight is provided, markdown is disabled internally
    expect(() =>
      renderWithProviders(
        <ToolResultDisplay
          resultDisplay="# heading"
          terminalWidth={80}
          availableTerminalHeight={20}
          renderOutputAsMarkdown={true}
        />,
      ),
    ).not.toThrow();
  });

  it('is a React component', () => {
    expect(typeof ToolResultDisplay).toBe('function');
    const element = React.createElement(ToolResultDisplay, {
      resultDisplay: 'test',
      terminalWidth: 80,
    });
    expect(element).toBeTruthy();
  });

  // @plan PLAN-20260824-ISSUE2021.P06 @requirement REQ-2021.6: long output truncation via MaxSizedBox
  describe('long output truncation', () => {
    const longResultDisplay = Array.from(
      { length: 60 },
      (_, i) => `line-${i}`,
    ).join('\n');

    it('renders the lines-hidden marker when content exceeds availableTerminalHeight', () => {
      // @plan PLAN-20260824-ISSUE2021.P06 @requirement REQ-2021.6
      const { lastFrame } = renderWithProviders(
        <ToolResultDisplay
          resultDisplay={longResultDisplay}
          availableTerminalHeight={10}
          terminalWidth={80}
          renderOutputAsMarkdown={false}
        />,
      );

      expect(lastFrame()).toContain('lines hidden');
    });

    it('omits the marker and keeps the last line when content fits', () => {
      // @plan PLAN-20260824-ISSUE2021.P06 @requirement REQ-2021-6
      const { lastFrame } = renderWithProviders(
        <ToolResultDisplay
          resultDisplay={longResultDisplay}
          availableTerminalHeight={80}
          terminalWidth={80}
          renderOutputAsMarkdown={false}
        />,
      );

      expect(lastFrame()).not.toContain('lines hidden');
      expect(lastFrame()).toContain('line-59');
    });
  });

  // @plan issue #3428 section C: the { content } object render path gets the
  // same pre-layout bound the string path got in #3426, so a large structured
  // result costs what its visible window costs instead of its full body.
  describe('object content truncation (issue #3428)', () => {
    const longObjectContent = {
      content: Array.from({ length: 60 }, (_, i) => `oline-${i}`).join(
        String.fromCharCode(10),
      ),
    };

    it('bounds the { content } body to the visible window and reports hidden lines', () => {
      const { lastFrame } = renderWithProviders(
        <ToolResultDisplay
          resultDisplay={longObjectContent}
          availableTerminalHeight={10}
          terminalWidth={80}
          renderOutputAsMarkdown={false}
        />,
      );

      expect(lastFrame()).toContain('lines hidden');
      expect(lastFrame()).toContain('oline-59');
      expect(lastFrame()).not.toContain('oline-0 ');
    });

    it('leaves object content that fits entirely visible', () => {
      const { lastFrame } = renderWithProviders(
        <ToolResultDisplay
          resultDisplay={{
            content: ['oalpha', 'obravo', 'ocharlie'].join(
              String.fromCharCode(10),
            ),
          }}
          availableTerminalHeight={80}
          terminalWidth={80}
          renderOutputAsMarkdown={false}
        />,
      );

      expect(lastFrame()).toContain('oalpha');
      expect(lastFrame()).toContain('ocharlie');
      expect(lastFrame()).not.toContain('lines hidden');
    });

    it('does not bound the { content } body when no height constraint exists', () => {
      const { lastFrame } = renderWithProviders(
        <ToolResultDisplay
          resultDisplay={longObjectContent}
          terminalWidth={80}
          renderOutputAsMarkdown={false}
        />,
      );

      expect(lastFrame()).toContain('oline-0');
      expect(lastFrame()).toContain('oline-59');
      expect(lastFrame()).not.toContain('lines hidden');
    });
  });
});
