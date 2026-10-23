/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  StreamingState,
  ToolCallStatus,
  type HistoryItemWithoutId,
} from '../../../types.js';
export interface IsInputActiveInputs {
  streamingState: StreamingState;
  initError: string | null;
  hasSlashCommands: boolean;
  /** True while a slash command is blocked on a shell-expansion approval. */
  isAwaitingSlashCommandConfirmation: boolean;
}

/**
 * True when a slash command has put a confirmation on screen that owns the
 * keyboard. `confirm_action` renders through the dialog manager, which
 * replaces the whole inline layout; `confirm_shell_commands` instead parks a
 * Confirming tool group in the processor's pending items, which is what this
 * detects.
 */
export function computeIsAwaitingSlashCommandConfirmation(
  pendingItems: readonly HistoryItemWithoutId[],
): boolean {
  return pendingItems.some(
    (item) =>
      item.type === 'tool_group' &&
      item.tools.some((tool) => tool.status === ToolCallStatus.Confirming),
  );
}

/**
 * Decides whether the composer is rendered.
 *
 * This deliberately does NOT key off the slash-command pipeline being busy.
 * Doing so hid the prompt for the entire duration of a long command
 * (issue #2976). The composer only has to stand down when something else owns
 * the keyboard, which is what the streaming and confirmation terms cover.
 */
export function computeIsInputActive(inputs: IsInputActiveInputs): boolean {
  const isStreamingIdleOrResponding =
    inputs.streamingState === StreamingState.Idle ||
    inputs.streamingState === StreamingState.Responding;
  return (
    isStreamingIdleOrResponding &&
    !inputs.initError &&
    inputs.hasSlashCommands &&
    !inputs.isAwaitingSlashCommandConfirmation
  );
}
