/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Support module for task.ts containing pure helper functions for the a2a
 * protocol mapping (confirmation wire parts, message factories, tool output
 * formatting) on top of the public Agent event surface (#3221).
 */

import {
  ToolConfirmationOutcome,
  type AnsiOutput,
  type ToolConfirmationPayload,
} from '@vybestack/llxprt-code-core';
import type { Part, Message } from '@a2a-js/sdk';
import { v4 as uuidv4 } from 'uuid';

/**
 * Maps an outcome string from a tool confirmation part to the corresponding
 * ToolConfirmationOutcome enum value. Returns undefined for unknown outcomes.
 */
export function mapOutcomeStringToEnum(
  outcomeString: string,
): ToolConfirmationOutcome | undefined {
  switch (outcomeString) {
    case 'proceed_once':
      return ToolConfirmationOutcome.ProceedOnce;
    case 'cancel':
      return ToolConfirmationOutcome.Cancel;
    case 'proceed_always':
      return ToolConfirmationOutcome.ProceedAlways;
    case 'proceed_always_server':
      return ToolConfirmationOutcome.ProceedAlwaysServer;
    case 'proceed_always_tool':
      return ToolConfirmationOutcome.ProceedAlwaysTool;
    case 'modify_with_editor':
      return ToolConfirmationOutcome.ModifyWithEditor;
    case 'suggest_edit':
      return ToolConfirmationOutcome.SuggestEdit;
    default:
      return undefined;
  }
}

/**
 * Extracts tool confirmation payload data from a part.
 * Returns undefined if neither newContent nor editedCommand is present.
 */
export function buildToolConfirmationPayload(
  partData: Record<string, unknown>,
): ToolConfirmationPayload | undefined {
  const newContent =
    typeof partData['newContent'] === 'string'
      ? partData['newContent']
      : undefined;
  const editedCommand =
    typeof partData['editedCommand'] === 'string'
      ? partData['editedCommand']
      : undefined;

  if (newContent === undefined && editedCommand === undefined) {
    return undefined;
  }
  return { newContent, editedCommand };
}

/**
 * Converts a tool output chunk (plain text or ANSI-grid output) to a string.
 */
export function convertAnsiOutputToString(
  outputChunk: string | AnsiOutput,
): string {
  return typeof outputChunk === 'string'
    ? outputChunk
    : outputChunk
        .map((line) => line.map((token) => token.text).join(''))
        .join('\n');
}

/**
 * Creates a text message for the event bus.
 */
export function createTextMessage(
  text: string,
  taskId: string,
  contextId: string,
  role: 'agent' | 'user' = 'agent',
): Message {
  return {
    kind: 'message',
    role,
    parts: [{ kind: 'text', text }],
    messageId: uuidv4(),
    taskId,
    contextId,
  };
}

/**
 * Creates a data message with arbitrary data payload.
 */
export function createDataMessage(
  data: unknown,
  taskId: string,
  contextId: string,
): Message {
  return {
    kind: 'message',
    role: 'agent',
    parts: [
      {
        kind: 'data',
        data,
      } as Part,
    ],
    messageId: uuidv4(),
    taskId,
    contextId,
  };
}
