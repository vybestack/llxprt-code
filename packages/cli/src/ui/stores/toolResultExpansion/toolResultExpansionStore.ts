/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStore, type Store } from '../createStore.js';
import { readToolResultBody } from '../../utils/toolResultTranscriptReader.js';

/**
 * Hard cap on simultaneously expanded tool-result bodies (issue #3428
 * section D). Expanded bodies are a transient read view over the transcript,
 * not a second retention system: at most three full bodies live in UI state,
 * so expansion can never reintroduce the unbounded retention the display cap
 * removed.
 */
export const TOOL_RESULT_EXPANSION_LIMIT = 3;

export interface ToolResultExpansionState {
  /** Full bodies loaded from the transcript, keyed by callId. */
  readonly expandedBodies: ReadonlyMap<string, string>;
}

export interface ToolResultExpansionCommands {
  /**
   * Loads the full body for `callId` from the current session transcript.
   * One fetch per callId: already-expanded, in-flight, and settled-missing
   * callIds resolve without reading the transcript again.
   */
  expand: (callId: string) => Promise<void>;
  /** Drops every expanded body (scroll-forward purge, issue #854 point 1). */
  purge: () => void;
}

export interface ToolResultExpansionStore {
  store: Store<ToolResultExpansionState>;
  commands: ToolResultExpansionCommands;
}

/** Resolves the current session's transcript file, when one is recorded. */
export type TranscriptPathAccessor = () => string | undefined;

export function createToolResultExpansionStore(
  getTranscriptFilePath: TranscriptPathAccessor,
): ToolResultExpansionStore {
  const store = createStore<ToolResultExpansionState>({
    expandedBodies: new Map<string, string>(),
  });
  const inFlight = new Set<string>();
  const settledWithoutBody = new Set<string>();
  // Bumped by every purge: a read that was pending when a purge ran must
  // not re-insert its body afterwards, or a purged result would reappear
  // after history moved forward (#854 point 1).
  let purgeGeneration = 0;

  const publish = (bodies: ReadonlyMap<string, string>): void => {
    store.setState({ expandedBodies: bodies });
  };

  const insertBounded = (callId: string, body: string): void => {
    const next = new Map(store.getState().expandedBodies);
    next.delete(callId);
    next.set(callId, body);
    while (next.size > TOOL_RESULT_EXPANSION_LIMIT) {
      const oldest = next.keys().next();
      if (oldest.done === true) break;
      next.delete(oldest.value);
    }
    publish(next);
  };

  const expand = async (callId: string): Promise<void> => {
    if (store.getState().expandedBodies.has(callId)) return;
    if (inFlight.has(callId) || settledWithoutBody.has(callId)) return;
    inFlight.add(callId);
    try {
      const generationAtRead = purgeGeneration;
      const filePath = getTranscriptFilePath();
      const body =
        filePath === undefined
          ? undefined
          : await readToolResultBody(filePath, callId);
      if (generationAtRead !== purgeGeneration) {
        // A purge ran while the read was pending: history moved forward, so
        // the body must not re-enter the expansion map.
        return;
      }
      if (body === undefined) {
        // The transcript had no body for this callId; remember so repeated
        // expansion attempts (effect reruns) do not rescan the file. Purge
        // resets this, allowing a retry after the transcript grows.
        settledWithoutBody.add(callId);
        return;
      }
      insertBounded(callId, body);
    } finally {
      inFlight.delete(callId);
    }
  };

  const purge = (): void => {
    purgeGeneration += 1;
    settledWithoutBody.clear();
    if (store.getState().expandedBodies.size === 0) return;
    publish(new Map<string, string>());
  };

  return {
    store,
    commands: { expand, purge },
  };
}
