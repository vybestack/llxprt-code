/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { CommandKind, type SlashCommand } from '../../../commands/types.js';
import { StreamingState } from '../../../types.js';
import {
  computeIsInputActive,
  type IsInputActiveInputs,
} from './useAppInput.js';

const POPULATED_SLASH_COMMANDS = [
  {
    name: 'clear',
    kind: CommandKind.BUILT_IN,
    description: 'Clear the screen',
  },
] satisfies readonly SlashCommand[];

function readyInputs(): IsInputActiveInputs {
  return {
    streamingState: StreamingState.Idle,
    initError: null,
    isProcessing: false,
    slashCommands: [],
  };
}

describe('computeIsInputActive', () => {
  it('returns true when every input is ready', () => {
    expect(computeIsInputActive(readyInputs())).toBe(true);
  });

  describe('streaming state gating', () => {
    it.each(Object.values(StreamingState))(
      'uses the visibility rule for %s',
      (streamingState) => {
        const expected =
          streamingState === StreamingState.Idle ||
          streamingState === StreamingState.Responding;

        expect(computeIsInputActive({ ...readyInputs(), streamingState })).toBe(
          expected,
        );
      },
    );
  });

  it('returns false while slash commands are still loading', () => {
    expect(
      computeIsInputActive({ ...readyInputs(), slashCommands: undefined }),
    ).toBe(false);
  });

  it('returns true when slash commands load as an empty array', () => {
    expect(computeIsInputActive({ ...readyInputs(), slashCommands: [] })).toBe(
      true,
    );
  });

  it('returns true when slash commands load as a populated array', () => {
    expect(
      computeIsInputActive({
        ...readyInputs(),
        slashCommands: POPULATED_SLASH_COMMANDS,
      }),
    ).toBe(true);
  });

  it('becomes active when only slash-command readiness changes', () => {
    const loadingInputs = { ...readyInputs(), slashCommands: undefined };
    const loadedInputs = { ...loadingInputs, slashCommands: [] };

    expect(computeIsInputActive(loadingInputs)).toBe(false);
    expect(computeIsInputActive(loadedInputs)).toBe(true);
  });

  it('returns false when initialization has failed', () => {
    expect(
      computeIsInputActive({ ...readyInputs(), initError: 'Missing API key' }),
    ).toBe(false);
  });

  it('returns false while slash-command processing is in flight', () => {
    expect(computeIsInputActive({ ...readyInputs(), isProcessing: true })).toBe(
      false,
    );
  });
});
