/**
 * @license
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable sonarjs/nested-control-flow, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type {
  ConversationRecord,
  BaseMessageRecord,
} from '@vybestack/llxprt-code-core';
import fs from 'node:fs/promises';
import * as Diff from 'diff';
import {
  coreEvents,
  debugLogger,
  getFileDiffFromResultDisplay,
  computeAddedAndRemovedLines,
} from '@vybestack/llxprt-code-core';

export interface FileChangeDetail {
  fileName: string;
  diff: string;
}

export interface FileChangeStats {
  addedLines: number;
  removedLines: number;
  fileCount: number;
  details?: FileChangeDetail[];
}

/**
 * Calculates file change statistics for a single turn.
 * A turn is defined as the sequence of messages starting after the given user message
 * and continuing until the next user message or the end of the conversation.
 *
 * @param conversation The full conversation record.
 * @param userMessage The starting user message for the turn.
 * @returns Statistics about lines added/removed and files touched, or null if no edits occurred.
 */
export function calculateTurnStats(
  conversation: ConversationRecord,
  userMessage: BaseMessageRecord,
): FileChangeStats | null {
  const msgIndex = conversation.messages.indexOf(userMessage);
  if (msgIndex === -1) return null;

  let addedLines = 0;
  let removedLines = 0;
  const files = new Set<string>();
  let hasEdits = false;

  // Look ahead until the next user message (single turn)
  for (let i = msgIndex + 1; i < conversation.messages.length; i++) {
    const msg = conversation.messages[i];
    if (msg.type === 'user') break; // Stop at next user message

    if (msg.type === 'gemini' && msg.toolCalls) {
      for (const toolCall of msg.toolCalls) {
        const fileDiff = getFileDiffFromResultDisplay(toolCall.resultDisplay);
        if (fileDiff) {
          hasEdits = true;
          const stats = fileDiff.diffStat;
          const calculations = computeAddedAndRemovedLines(stats);
          addedLines += calculations.addedLines;
          removedLines += calculations.removedLines;

          files.add(fileDiff.fileName);
        }
      }
    }
  }

  if (!hasEdits) return null;

  return {
    addedLines,
    removedLines,
    fileCount: files.size,
  };
}

/**
 * Calculates the cumulative file change statistics from a specific message
 * to the end of the conversation.
 *
 * @param conversation The full conversation record.
 * @param userMessage The message to start calculating impact from (exclusive).
 * @returns Aggregate statistics about lines added/removed and files touched, or null if no edits occurred.
 */
export function calculateRewindImpact(
  conversation: ConversationRecord,
  userMessage: BaseMessageRecord,
): FileChangeStats | null {
  const msgIndex = conversation.messages.indexOf(userMessage);
  if (msgIndex === -1) return null;

  let addedLines = 0;
  let removedLines = 0;
  const files = new Set<string>();
  const details: FileChangeDetail[] = [];
  let hasEdits = false;

  // Look ahead to the end of conversation (cumulative)
  for (let i = msgIndex + 1; i < conversation.messages.length; i++) {
    const msg = conversation.messages[i];
    // Do NOT break on user message - we want total impact

    if (msg.type === 'gemini' && msg.toolCalls) {
      for (const toolCall of msg.toolCalls) {
        const fileDiff = getFileDiffFromResultDisplay(toolCall.resultDisplay);
        if (fileDiff) {
          hasEdits = true;
          const stats = fileDiff.diffStat;
          const calculations = computeAddedAndRemovedLines(stats);
          addedLines += calculations.addedLines;
          removedLines += calculations.removedLines;
          files.add(fileDiff.fileName);
          details.push({
            fileName: fileDiff.fileName,
            diff: fileDiff.fileDiff,
          });
        }
      }
    }
  }

  if (!hasEdits) return null;

  return {
    addedLines,
    removedLines,
    fileCount: files.size,
    details,
  };
}

/**
 * Reads the current on-disk content of a file targeted for revert.
 * Returns null if the file does not exist (ENOENT) — the caller decides
 * how to handle that case.  Propagates unexpected read errors as a
 * thrown exception so the outer catch can emit feedback.
 */
async function readCurrentContent(
  filePath: string,
  fileName: string,
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (e) {
    const error = e as Error;
    if ('code' in error && error.code === 'ENOENT') {
      debugLogger.debug(
        `File ${fileName} not found during revert, proceeding as it may be a new file deletion.`,
      );
      return null;
    }
    coreEvents.emitFeedback(
      'error',
      `Error reading ${fileName} during revert: ${error.message}`,
      e,
    );
    throw e;
  }
}

/**
 * Attempts to revert a single file to its original content.
 * Handles exact-match revert, smart-patch revert, and missing-file scenarios.
 */
async function revertSingleFile(
  filePath: string,
  fileName: string,
  newContent: string,
  originalContent: string | null,
  isNewFile: boolean | undefined = undefined,
): Promise<void> {
  try {
    const currentContent = await readCurrentContent(filePath, fileName);

    // 1. Exact Match: Safe to revert directly
    if (currentContent === newContent) {
      if (isNewFile !== true) {
        await fs.writeFile(filePath, originalContent ?? '');
      } else {
        await fs.unlink(filePath);
      }
      return;
    }

    // 2. Mismatch: Attempt Smart Revert (Patch)
    if (currentContent !== null) {
      const originalText = originalContent ?? '';
      const undoPatch = Diff.createPatch(fileName, newContent, originalText);
      const patchedContent = Diff.applyPatch(currentContent, undoPatch);

      if (typeof patchedContent === 'string') {
        if (patchedContent === '' && isNewFile === true) {
          await fs.unlink(filePath);
        } else {
          await fs.writeFile(filePath, patchedContent);
        }
      } else {
        coreEvents.emitFeedback(
          'warning',
          `Smart revert for ${fileName} failed. The file may have been modified in a way that conflicts with the undo operation.`,
        );
      }
      return;
    }

    // 3. File was deleted by the user, but we expected content.
    coreEvents.emitFeedback(
      'warning',
      `Cannot revert changes for ${fileName} because it was not found on disk. This is expected if a file created by the agent was deleted before rewind`,
    );
  } catch (e) {
    coreEvents.emitFeedback(
      'error',
      `An unexpected error occurred while reverting ${fileName}.`,
      e,
    );
  }
}

/**
 * Reverts file changes made by the model from the end of the conversation
 * back to a specific target message.
 *
 * It iterates backwards through the conversation history and attempts to undo
 * any file modifications. It handles cases where the user might have subsequently
 * modified the file by attempting a smart patch (using the `diff` library).
 *
 * @param conversation The full conversation record.
 * @param targetMessageId The ID of the message to revert back to. Changes *after* this message will be undone.
 */
export async function revertFileChanges(
  conversation: ConversationRecord,
  targetMessageId: string,
): Promise<void> {
  const messageIndex = conversation.messages.findIndex(
    (m) => m.id === targetMessageId,
  );

  if (messageIndex === -1) {
    debugLogger.error('Requested message to rewind to was not found ');
    return;
  }

  for (let i = conversation.messages.length - 1; i > messageIndex; i--) {
    const msg = conversation.messages[i];
    if (msg.type === 'gemini' && msg.toolCalls) {
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const toolCall = msg.toolCalls[j];
        const fileDiff = getFileDiffFromResultDisplay(toolCall.resultDisplay);
        if (fileDiff) {
          const { filePath, fileName, newContent, originalContent, isNewFile } =
            fileDiff;
          if (!filePath) {
            debugLogger.debug(
              `Skipping revert for ${fileName}: no file path available`,
            );
            continue;
          }
          await revertSingleFile(
            filePath,
            fileName,
            newContent,
            originalContent,
            isNewFile,
          );
        }
      }
    }
  }
}
