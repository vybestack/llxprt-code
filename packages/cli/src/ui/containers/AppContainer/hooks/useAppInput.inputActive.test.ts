/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the composer-visibility rule. InlineContent renders no
 * Composer when this returns false, so these cases are literally "is the input
 * prompt on screen".
 */

import { describe, it, expect } from 'bun:test';
import {
  computeIsInputActive,
  computeIsAwaitingSlashCommandConfirmation,
} from './useAppInput.js';
import type { IsInputActiveInputs } from './useAppInput.js';
import { StreamingState, ToolCallStatus } from '../../../types.js';
import type { HistoryItemWithoutId } from '../../../types.js';

const idleAndReady: IsInputActiveInputs = {
  streamingState: StreamingState.Idle,
  initError: null,
  hasSlashCommands: true,
  isAwaitingSlashCommandConfirmation: false,
};

function toolGroup(status: ToolCallStatus): HistoryItemWithoutId {
  return {
    type: 'tool_group',
    tools: [
      {
        callId: 'call-1',
        name: 'Expansion',
        description: 'Command expansion needs shell access',
        status,
        resultDisplay: undefined,
        confirmationDetails: undefined,
      },
    ],
  };
}

describe('computeIsInputActive', () => {
  it('shows the prompt when the session is idle and ready', () => {
    expect(computeIsInputActive(idleAndReady)).toBe(true);
  });

  it('hides the prompt while a slash command waits on a confirmation', () => {
    expect(
      computeIsInputActive({
        ...idleAndReady,
        isAwaitingSlashCommandConfirmation: true,
      }),
    ).toBe(false);
  });

  it('keeps the prompt up while the model is responding', () => {
    expect(
      computeIsInputActive({
        ...idleAndReady,
        streamingState: StreamingState.Responding,
      }),
    ).toBe(true);
  });

  it('hides the prompt while a tool call awaits confirmation', () => {
    expect(
      computeIsInputActive({
        ...idleAndReady,
        streamingState: StreamingState.WaitingForConfirmation,
      }),
    ).toBe(false);
  });

  it('hides the prompt when initialization failed', () => {
    expect(computeIsInputActive({ ...idleAndReady, initError: 'boom' })).toBe(
      false,
    );
  });

  it('hides the prompt before the slash commands have loaded', () => {
    expect(
      computeIsInputActive({ ...idleAndReady, hasSlashCommands: false }),
    ).toBe(false);
  });
});

describe('computeIsAwaitingSlashCommandConfirmation', () => {
  it('is false when nothing is pending', () => {
    expect(computeIsAwaitingSlashCommandConfirmation([])).toBe(false);
  });

  it('is true while a shell-expansion approval is on screen', () => {
    expect(
      computeIsAwaitingSlashCommandConfirmation([
        toolGroup(ToolCallStatus.Confirming),
      ]),
    ).toBe(true);
  });

  it('is false for a pending item that is merely progress, not a question', () => {
    // Commands may park a pending item as a progress indicator; that must not
    // take the prompt away (issue #2976).
    expect(
      computeIsAwaitingSlashCommandConfirmation([
        toolGroup(ToolCallStatus.Executing),
      ]),
    ).toBe(false);
  });

  it('is false for pending items that are not tool groups', () => {
    expect(
      computeIsAwaitingSlashCommandConfirmation([
        { type: 'info', text: 'working' },
      ]),
    ).toBe(false);
  });
});
