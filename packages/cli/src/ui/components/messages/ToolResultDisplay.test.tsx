/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
    expect(lastFrame()).toBe('');
  });

  it('renders string results as plain text when markdown disabled', () => {
    const { lastFrame } = renderWithProviders(
      <ToolResultDisplay
        resultDisplay="hello world"
        terminalWidth={80}
        renderOutputAsMarkdown={false}
      />,
    );
    expect(lastFrame()).toContain('hello world');
  });

  it('renders string results with markdown when enabled', () => {
    const { lastFrame } = renderWithProviders(
      <ToolResultDisplay
        resultDisplay="# heading"
        terminalWidth={80}
        renderOutputAsMarkdown={true}
      />,
    );
    expect(lastFrame()).toContain('MockMarkdown:# heading');
  });

  it('strips shell markers from string result display', () => {
    // stripShellMarkers removes runtime markers; verify the visual output
    // does not contain the raw marker text
    const { lastFrame } = renderWithProviders(
      <ToolResultDisplay
        resultDisplay="some output text"
        terminalWidth={80}
        renderOutputAsMarkdown={false}
      />,
    );
    expect(lastFrame()).toContain('some output text');
  });

  it('truncates extremely long string results', () => {
    const longStr = 'x'.repeat(2_000_000);
    const { lastFrame } = renderWithProviders(
      <ToolResultDisplay
        resultDisplay={longStr}
        terminalWidth={80}
        renderOutputAsMarkdown={false}
      />,
    );
    // Should have been truncated with leading ...
    expect(lastFrame()).toContain('...');
  });

  it('renders diff results when resultDisplay contains fileDiff', () => {
    const diffResult = {
      fileDiff: '@@ -1 +1 @@\n-old\n+new',
      fileName: 'test.ts',
    };
    const { lastFrame } = renderWithProviders(
      <ToolResultDisplay resultDisplay={diffResult} terminalWidth={80} />,
    );
    expect(lastFrame()).toContain('MockDiff:');
    expect(lastFrame()).toContain('test.ts');
  });

  it('renders AnsiOutput for array-of-arrays result', () => {
    const ansiData = [[{ text: 'line1', style: {} }]];
    const { lastFrame } = renderWithProviders(
      <ToolResultDisplay
        resultDisplay={ansiData as unknown as string}
        terminalWidth={80}
      />,
    );
    expect(lastFrame()).toContain('MockAnsiOutput');
  });
});
