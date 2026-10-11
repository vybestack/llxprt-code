/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AsyncFzf } from 'fzf';
import type { Suggestion } from '../components/SuggestionsDisplay.js';

interface CompletionCandidate {
  searchKey: string;
  suggestion: Suggestion;
}

export async function searchCompletionCandidates(
  candidates: CompletionCandidate[],
  pattern: string,
  limit: number,
  signal: AbortSignal,
): Promise<Suggestion[]> {
  signal.throwIfAborted();
  const engine = new AsyncFzf(candidates, {
    selector: (candidate: CompletionCandidate) => candidate.searchKey,
    limit,
  });
  const cancel = (): void => {
    void engine.find('');
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const results = await engine.find(pattern);
    signal.throwIfAborted();
    return results.map(
      (result: { item: CompletionCandidate }) => result.item.suggestion,
    );
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
