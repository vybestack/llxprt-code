/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * History mutation service shared by CLI and Agents for `/chat clear` and
 * `/chat restore N`. Computes removed items from real human-turn boundaries
 * (not `turns * 2`), durably appends a rewind event, and commits live/UI
 * history only after persistence succeeds.
 */

import type { IContent } from '../services/history/IContent.js';
import type { SessionRecordingService } from './SessionRecordingService.js';

/**
 * Result of a clear or restore operation.
 */
export interface HistoryMutationResult {
  ok: true;
  remainingHistory: IContent[];
  itemsRemoved: number;
}

export interface HistoryMutationError {
  ok: false;
  error: string;
}

/**
 * Count the number of human-led turns in a history array.
 * A human-led turn starts at a `human` entry and includes all following
 * non-human entries until the next `human` entry.
 */
export function countHumanTurns(history: readonly IContent[]): number {
  let count = 0;
  for (const item of history) {
    if (item.speaker === 'human') {
      count++;
    }
  }
  return count;
}

/**
 * Compute the items that would be removed by clearing all non-initial content.
 * "Initial" means everything up to and including the first human-led turn.
 * Returns the cut point index and the removed items.
 */
function computeClearCut(history: readonly IContent[]): {
  cutIndex: number;
  removed: IContent[];
} {
  if (history.length === 0) {
    return { cutIndex: 0, removed: [] };
  }

  let cutIndex = 0;
  let foundHuman = false;
  for (let i = 0; i < history.length; i++) {
    if (history[i].speaker === 'human') {
      if (foundHuman) break;
      foundHuman = true;
    }
    if (foundHuman) {
      cutIndex = i + 1;
    }
  }

  return {
    cutIndex,
    removed: history.slice(cutIndex),
  };
}

/**
 * Compute the items that would be removed by restoring the last N human-led turns.
 */
function computeRestoreCut(
  history: readonly IContent[],
  turnsToRemove: number,
): { cutIndex: number; removed: IContent[] } {
  if (turnsToRemove <= 0 || history.length === 0) {
    return { cutIndex: history.length, removed: [] };
  }

  // Walk backwards to find the start of the Nth-from-last human turn.
  let humanCount = 0;
  let cutIndex = history.length;

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].speaker === 'human') {
      humanCount++;
      if (humanCount === turnsToRemove) {
        cutIndex = i;
        break;
      }
    }
  }

  if (humanCount < turnsToRemove) {
    // Remove all content (not enough turns)
    cutIndex = 0;
  }

  return {
    cutIndex,
    removed: history.slice(cutIndex),
  };
}

/**
 * Service for durable history mutations that persist rewind semantics.
 */
export class HistoryMutationService {
  /**
   * Clear all non-initial conversational content.
   * Durably appends a rewind event before committing the live history change.
   *
   * @returns the remaining history after the clear, or an error if persistence fails.
   */
  async clear(
    history: readonly IContent[],
    recording: SessionRecordingService,
  ): Promise<HistoryMutationResult | HistoryMutationError> {
    const { cutIndex, removed } = computeClearCut(history);
    return this.applyMutation(history.slice(0, cutIndex), removed, recording);
  }

  /**
   * Remove the last N human-led turns from history.
   * Durably appends a rewind event before committing the live history change.
   */
  async restore(
    history: readonly IContent[],
    turnsToRemove: number,
    recording: SessionRecordingService,
  ): Promise<HistoryMutationResult | HistoryMutationError> {
    const { cutIndex, removed } = computeRestoreCut(history, turnsToRemove);
    return this.applyMutation(history.slice(0, cutIndex), removed, recording);
  }

  /**
   * Apply a history mutation: flush pending content, record rewind, flush,
   * and return the result. On persistence failure, leave live state unchanged.
   */
  private async applyMutation(
    remaining: IContent[],
    removed: IContent[],
    recording: SessionRecordingService,
  ): Promise<HistoryMutationResult | HistoryMutationError> {
    if (removed.length === 0) {
      return { ok: true, remainingHistory: remaining, itemsRemoved: 0 };
    }

    if (!recording.isActive()) {
      return { ok: false, error: 'Recording is not active' };
    }

    try {
      // 1. Flush pending content first.
      await recording.flush();

      // 2. Durably append the rewind event.
      recording.recordRewind(removed.length);

      // 3. Flush the rewind.
      await recording.flush();

      if (!recording.isActive()) {
        return {
          ok: false,
          error: 'Recording failed during rewind persistence',
        };
      }

      // 4. Return the new history only after persistence succeeds.
      return {
        ok: true,
        remainingHistory: remaining,
        itemsRemoved: removed.length,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `History mutation failed: ${detail}`,
      };
    }
  }
}
