/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { SuggestionsDisplay, type Suggestion } from './SuggestionsDisplay.js';
import { CommandKind } from '../commands/types.js';

const baseProps = {
  activeIndex: 0,
  isLoading: false,
  width: 80,
  scrollOffset: 0,
  userInput: '',
};

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
