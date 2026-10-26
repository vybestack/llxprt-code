/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import type { IContent, ToolCallBlock } from './IContent.js';
import { historyOriginId } from './historyOriginId.js';
import type { JournalDisplayHandle } from './journal-display-commands.js';
import type { JournalDisplayDescriptor } from '../../journal/display-recording.js';
import { HistoryServiceCore } from './HistoryServiceCore.js';
import type { CurrentTurnMarker } from './historyChronology.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import {
  findUnmatchedToolCalls as findUnmatchedToolCallsHelper,
  type ToolPairingStreamOptions,
} from './historyToolPairing.js';

/**
 * Read-only query surface of the history service: cold streams over the
 * journal, tail lookups, and turn recording. Mutation coordination and
 * lifecycle live in {@link HistoryService}.
 */
export abstract class HistoryServiceReads extends HistoryServiceCore {
  appendDisplay(
    descriptor: JournalDisplayDescriptor,
    source: string | AsyncIterable<string>,
    origin?: object,
  ): Promise<JournalDisplayHandle> {
    return new Promise((resolve, reject) => {
      void this.enqueueAsynchronousHistoryMutation(async () => {
        resolve(
          await this.journal.appendDisplay(
            descriptor,
            source,
            origin === undefined ? undefined : historyOriginId(origin),
          ),
        );
      }).catch(reject);
    });
  }

  retractDisplay(row: JournalDisplayHandle): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(() =>
      this.journal.retractDisplay(row),
    );
  }

  async submitPrompt(
    submissionId: string,
    rows: readonly IContent[],
    modelName?: string,
    origin?: object,
  ): Promise<void> {
    await this.detachedValues.append(rows, modelName, {
      submissionId,
      origin,
      publishBatch: true,
    });
    await this.journal.flushCommitted();
  }

  hasPromptSubmission(id: string): Promise<boolean> {
    return this.journal.hasPromptSubmission(id);
  }
  async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* this.journal.streamRows(undefined, signal);
  }

  getCurrentTurnMarker(): Promise<CurrentTurnMarker | null> {
    return this.journal.currentTurnMarker();
  }

  /** Cold chronological suffix stream, preserving slice(-count), including count=0. */
  async *getRecent(
    count: number,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* this.journal.streamRows({ kind: 'recent', count }, signal);
  }

  /** Cold stream of all content, including invalid/empty, pinned at first next(). */
  async *getComprehensive(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* this.journal.streamRows(undefined, signal);
  }

  /**
   * Get the last user (human) content
   */
  getLastUserContent(): Promise<IContent | undefined> {
    return this.getLastContent('human');
  }

  /**
   * Get the last AI content
   */
  getLastAIContent(): Promise<IContent | undefined> {
    return this.getLastContent('ai');
  }

  /** The newest row, optionally of one speaker; the row is read, never cached. */
  getLastContent(speaker?: IContent['speaker']): Promise<IContent | undefined> {
    return this.journal.lastContent(speaker);
  }

  /**
   * Record a complete turn (user input + AI response + optional tool interactions)
   */
  recordTurn(
    userInput: IContent,
    aiResponse: IContent,
    toolInteractions?: IContent[],
  ): void {
    this.add(userInput);
    this.add(aiResponse);
    if (toolInteractions) {
      this.addAll(toolInteractions);
    }
  }

  /** Get the number of messages in history. */
  length(): number {
    return this.journal.getLength();
  }

  /** Check if history is empty. */
  isEmpty(): boolean {
    return this.journal.getLength() === 0;
  }

  /** Cold sanitized copies over membership pinned at the first next(). */
  async *clone(): AsyncGenerator<IContent, void, unknown> {
    for await (const content of this.journal.streamRows()) {
      yield sanitizeProviderContentForSerialization(content);
    }
  }

  /**
   * Find unmatched tool calls (tool calls without responses)
   */
  findUnmatchedToolCalls(
    options: ToolPairingStreamOptions = {},
  ): AsyncGenerator<ToolCallBlock, void, unknown> {
    return findUnmatchedToolCallsHelper(
      this.logger,
      this.journal.streamRows(),
      options,
    );
  }

  /** Cold chronological stream of the newest contiguous suffix fitting the budget. */
  async *getWithinTokenLimit(
    maxTokens: number,
    countTokensFn: (content: IContent) => number,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* this.journal.streamRows(
      { kind: 'tokens', maxTokens, countTokens: countTokensFn },
      signal,
    );
  }
}
