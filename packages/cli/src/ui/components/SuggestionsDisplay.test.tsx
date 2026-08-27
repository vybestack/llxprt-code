/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import chalk from 'chalk';
import { describe, it, expect } from 'bun:test';
import { SuggestionsDisplay, type Suggestion } from './SuggestionsDisplay.js';
import { CommandKind } from '../commands/types.js';

const baseProps = {
  activeIndex: 0,
  isLoading: false,
  width: 80,
  scrollOffset: 0,
  userInput: '',
};

function frameOf(lastFrame: () => string | undefined): string {
  const frame = lastFrame();
  if (frame === undefined) {
    throw new Error('expected a rendered frame');
  }

  return frame;
}

describe('<SuggestionsDisplay /> subagent badge', () => {
  it('renders the [Subagent] badge for subagent-kind suggestions', () => {
    const suggestions: Suggestion[] = [
      {
        label: 'typescriptexpert',
        value: 'typescriptexpert',
        description: 'subagent',
        kind: CommandKind.SUBAGENT,
      },
    ];

    const { lastFrame } = render(
      <SuggestionsDisplay {...baseProps} suggestions={suggestions} />,
    );

    const output = lastFrame();
    expect(output).toContain('[Subagent]');
    expect(output).toContain('typescriptexpert');
  });

  it('does not render the [Subagent] badge for file-kind suggestions', () => {
    const suggestions: Suggestion[] = [
      {
        label: 'realfile.txt',
        value: 'realfile.txt',
        kind: CommandKind.FILE,
      },
    ];

    const { lastFrame } = render(
      <SuggestionsDisplay {...baseProps} suggestions={suggestions} />,
    );

    const output = lastFrame();
    expect(output).not.toContain('[Subagent]');
    expect(output).toContain('realfile.txt');
  });

  it('does not render the [Subagent] badge when kind is absent', () => {
    const suggestions: Suggestion[] = [
      {
        label: 'plain.txt',
        value: 'plain.txt',
      },
    ];

    const { lastFrame } = render(
      <SuggestionsDisplay {...baseProps} suggestions={suggestions} />,
    );

    const output = lastFrame();
    expect(output).not.toContain('[Subagent]');
    expect(output).toContain('plain.txt');
  });
});

describe('<SuggestionsDisplay /> rendering contract', () => {
  const makeSuggestions = (count: number): Suggestion[] =>
    Array.from({ length: count }, (_, i) => ({
      label: `label${i}`,
      value: `value${i}`,
    }));

  it('renders "Loading suggestions..." and no suggestion labels while isLoading', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        {...baseProps}
        isLoading={true}
        suggestions={makeSuggestions(3)}
      />,
    );

    const output = frameOf(lastFrame);
    expect(output).toContain('Loading suggestions...');
    for (let i = 0; i < 3; i++) {
      expect(output).not.toContain(`label${i}`);
    }
  });

  it('renders nothing when there are no suggestions', () => {
    const { lastFrame, rerender } = render(
      <SuggestionsDisplay
        {...baseProps}
        suggestions={[{ label: 'memory', value: 'memory' }]}
      />,
    );

    expect(frameOf(lastFrame)).toContain('memory');
    rerender(<SuggestionsDisplay {...baseProps} suggestions={[]} />);
    expect(frameOf(lastFrame).trim()).toBe('');
  });

  it('renders no scroll markers when the list fits in the visible window', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay {...baseProps} suggestions={makeSuggestions(4)} />,
    );

    const output = frameOf(lastFrame);
    for (let i = 0; i < 4; i++) {
      expect(output).toContain(`label${i}`);
    }
    expect(output).not.toContain('▲');
    expect(output).not.toContain('▼');
  });

  it('renders a down marker for a list longer than the visible window', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay {...baseProps} suggestions={makeSuggestions(12)} />,
    );

    const output = frameOf(lastFrame);
    expect(output).toContain('▼');
    expect(output).not.toContain('▲');
  });

  it('renders an up marker and no down marker at the last scroll window', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        {...baseProps}
        suggestions={makeSuggestions(12)}
        scrollOffset={4}
      />,
    );

    const output = frameOf(lastFrame);
    expect(output).toContain('▲');
    expect(output).not.toContain('▼');
  });

  it('renders only the 8 visible suggestions from scrollOffset 0', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay {...baseProps} suggestions={makeSuggestions(12)} />,
    );

    const output = frameOf(lastFrame);
    for (let i = 0; i < 8; i++) {
      expect(output).toContain(`label${i}`);
    }
    for (let i = 8; i < 12; i++) {
      expect(output).not.toContain(`label${i}`);
    }
  });

  it('renders suggestions starting from the scroll offset', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        {...baseProps}
        suggestions={makeSuggestions(12)}
        scrollOffset={4}
      />,
    );

    const output = frameOf(lastFrame);
    expect(output).toContain('label4');
    expect(output).not.toContain('label3');
  });

  it('does not render the counter at exactly 8 suggestions', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay {...baseProps} suggestions={makeSuggestions(8)} />,
    );

    const output = frameOf(lastFrame);
    for (let i = 0; i < 8; i++) {
      expect(output).toContain(`label${i}`);
    }
    expect(output).not.toContain('(');
    expect(output).not.toContain('▼');
  });

  it('renders the (activeIndex+1/total) counter when suggestions exceed the window', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        {...baseProps}
        suggestions={makeSuggestions(9)}
        activeIndex={2}
      />,
    );

    expect(frameOf(lastFrame)).toContain('(3/9)');
  });

  it('renders the description next to each label', () => {
    const suggestions: Suggestion[] = [
      { label: 'memory', value: 'memory', description: 'manage memory' },
      { label: 'chat', value: 'chat', description: 'manage chats' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay {...baseProps} suggestions={suggestions} />,
    );

    const rows = frameOf(lastFrame).split('\n');
    const memoryRow = rows.find((row) => row.includes('memory'));
    const chatRow = rows.find((row) => row.includes('chat'));
    expect(memoryRow).toContain('manage memory');
    expect(chatRow).toContain('manage chats');
  });

  it('aligns descriptions in a single column in slash mode', () => {
    const suggestions: Suggestion[] = [
      { label: 'm', value: 'm', description: 'DDD-short' },
      { label: 'longlonglonglong', value: 'long', description: 'DDD-long' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay
        {...baseProps}
        userInput="/"
        suggestions={suggestions}
      />,
    );

    const rows = frameOf(lastFrame).split('\n');
    const shortRow = rows.find((row) => row.includes('DDD-short')) ?? '';
    const longRow = rows.find((row) => row.includes('DDD-long')) ?? '';
    const shortDescriptionIndex = shortRow.indexOf('DDD-short');
    const longDescriptionIndex = longRow.indexOf('DDD-long');

    expect(shortDescriptionIndex).toBeGreaterThanOrEqual(0);
    expect(longDescriptionIndex).toBeGreaterThanOrEqual(0);
    expect(shortDescriptionIndex).toBe(longDescriptionIndex);
  });

  it('does not column-align descriptions outside slash mode', () => {
    const suggestions: Suggestion[] = [
      { label: 'm', value: 'm', description: 'DESC-short' },
      { label: 'longlonglonglong', value: 'long', description: 'DESC-long' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay
        {...baseProps}
        userInput="@"
        suggestions={suggestions}
      />,
    );

    const rows = frameOf(lastFrame).split('\n');
    const shortRow = rows.find((row) => row.includes('DESC-short')) ?? '';
    const longRow = rows.find((row) => row.includes('DESC-long')) ?? '';
    const shortDescriptionIndex = shortRow.indexOf('DESC-short');
    const longDescriptionIndex = longRow.indexOf('DESC-long');

    expect(shortDescriptionIndex).toBeGreaterThanOrEqual(0);
    expect(longDescriptionIndex).toBeGreaterThanOrEqual(0);
    expect(shortDescriptionIndex).toBeLessThan(longDescriptionIndex);
  });

  it('renders the active hint above the list when provided', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        {...baseProps}
        suggestions={[{ label: 'memory', value: 'memory' }]}
        activeHint="tab to accept"
      />,
    );

    const lines = frameOf(lastFrame).split('\n');
    const suggestionLineIndex = lines.findIndex(
      (line) => line.trim() === 'memory',
    );
    expect(lines[0]?.trim()).toBe('tab to accept');
    expect(suggestionLineIndex).toBeGreaterThan(0);
  });

  it('omits the active hint when the prop is not provided', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        {...baseProps}
        suggestions={[{ label: 'memory', value: 'memory' }]}
      />,
    );

    const lines = frameOf(lastFrame).split('\n');
    expect(lines[0]?.trim()).toBe('memory');
  });

  it('renders the active row with the active colour only', () => {
    const previousChalkLevel = chalk.level;
    chalk.level = 3;

    try {
      const { lastFrame } = render(
        <SuggestionsDisplay
          {...baseProps}
          suggestions={[
            { label: 'idle', value: 'idle' },
            { label: 'selected', value: 'selected' },
          ]}
          activeIndex={1}
        />,
      );
      const rows = frameOf(lastFrame).split('\n');
      const inactiveRow = rows.find((row) => row.includes('idle')) ?? '';
      const activeRow = rows.find((row) => row.includes('selected')) ?? '';
      const activeColorSample = chalk.hex('#00ff00')('sample');
      const sampleIndex = activeColorSample.indexOf('sample');

      expect(sampleIndex).toBeGreaterThan(0);
      const activeColorSequence = activeColorSample.slice(0, sampleIndex);
      expect(activeRow).toContain(activeColorSequence);
      expect(inactiveRow).not.toContain(activeColorSequence);
    } finally {
      chalk.level = previousChalkLevel;
    }
  });
});
