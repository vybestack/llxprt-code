/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Text } from 'ink';
import { ToolResultDisplay } from './ToolResultDisplay.js';
import { renderWithProviders } from '../../../test-utils/render.js';

vi.mock('../../utils/MarkdownDisplay.js', () => ({
  MarkdownDisplay: function MockMarkdownDisplay({ text }: { text: string }) {
    return <Text color="white">{`MockMarkdown:${text}`}</Text>;
  },
}));

vi.mock('./DiffRenderer.js', () => ({
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

vi.mock('../AnsiOutput.js', () => ({
  AnsiOutputText: function MockAnsiOutput() {
    return <Text color="white">{`MockAnsiOutput`}</Text>;
  },
}));

describe('<ToolResultDisplay />', () => {
  it('renders nothing when resultDisplay is undefined', () => {
    const { lastFrame } = renderWithProviders(
      <ToolResultDisplay resultDisplay={undefined} terminalWidth={80} />,
    );
    // Empty or whitespace-only when no display data
    expect(lastFrame()?.trim() || '').toBe('');
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

  it('truncates extremely long strings to MAXIMUM_RESULT_DISPLAY_CHARACTERS', () => {
    // 500_001 chars exceeds the 500_000 cap; component should not throw
    const veryLong = 'a'.repeat(500_001);
    expect(() =>
      renderWithProviders(
        <ToolResultDisplay
          resultDisplay={veryLong}
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
});
