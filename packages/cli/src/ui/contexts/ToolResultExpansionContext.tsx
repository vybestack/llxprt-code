/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  createToolResultExpansionStore,
  type ToolResultExpansionState,
  type ToolResultExpansionStore,
  type TranscriptPathAccessor,
} from '../stores/toolResultExpansion/toolResultExpansionStore.js';
import type { Store } from '../stores/createStore.js';
import type { TurnStore } from '../stores/turn/turnStore.js';
import { useTurnStore } from '../stores/turn/TurnContext.js';
import { useTerminalStore } from '../stores/terminal/TerminalContext.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';

const ToolResultExpansionContext =
  createContext<ToolResultExpansionStore | null>(null);

/**
 * Stands in for the expansion store when no provider is mounted, so
 * component hooks stay unconditional in trees without the provider (bare
 * render stacks in tests). Its state never changes.
 */
const emptyExpansionStore: Store<ToolResultExpansionState> =
  createToolResultExpansionStore(() => undefined).store;

/**
 * Mounts the transcript-backed expansion store for the current session
 * (issue #3428 section D).
 *
 * - Full bodies are read on demand against the CURRENT session's transcript
 *   via `getTranscriptFilePath` (the live recording-service accessor, so
 *   resume swaps are followed automatically).
 * - Forward purge: every append into (or trim of) the turn-store history
 *   ledger drops all expanded bodies (#854 point 1 — no permanent
 *   re-retention once an item scrolls forward).
 */
export function ToolResultExpansionProvider({
  getTranscriptFilePath,
  children,
}: {
  getTranscriptFilePath: TranscriptPathAccessor;
  children: ReactNode;
}): ReactNode {
  const turnStore = useTurnStore();
  const storeRef = useRef<ToolResultExpansionStore | null>(null);
  storeRef.current ??= createToolResultExpansionStore(getTranscriptFilePath);
  const expansion = storeRef.current;

  useHistoryAppendPurge(turnStore, expansion);

  return (
    <ToolResultExpansionContext.Provider value={expansion}>
      {children}
    </ToolResultExpansionContext.Provider>
  );
}

/**
 * Purges expanded bodies whenever the history ledger's item-id set changes —
 * appends, trims, removals, and loads. In-place updates keep item ids, so
 * streaming refreshes do not purge.
 */
function useHistoryAppendPurge(
  turnStore: TurnStore,
  expansion: ToolResultExpansionStore,
): void {
  useEffect(() => {
    const idsOf = (): string =>
      turnStore.store
        .getState()
        .history.map((item) => item.id)
        .join(',');
    let lastIds = idsOf();
    return turnStore.store.subscribe(() => {
      const nextIds = idsOf();
      if (nextIds !== lastIds) {
        lastIds = nextIds;
        expansion.commands.purge();
      }
    });
  }, [turnStore, expansion]);
}

/** The full transcript body loaded for `callId`, when one has been expanded. */
export function useExpandedToolResultBody(callId: string): string | undefined {
  const expansion = useContext(ToolResultExpansionContext);
  const store = expansion?.store ?? emptyExpansionStore;
  return useStoreSelector(store, (state) => state.expandedBodies.get(callId));
}

/**
 * Fetch-on-ctrl-s wiring: when height constraints are lifted, a mounted
 * capped result loads its full body from the transcript. One fetch per
 * callId per constraint-lift (a scroll-forward purge does not immediately
 * re-fetch); re-enabling constraints re-arms the fetch for the next lift.
 */
export function useLoadExpandedToolResult(
  callId: string,
  capped: boolean,
): void {
  const expansion = useContext(ToolResultExpansionContext);
  const { store: terminalStore } = useTerminalStore();
  const constrainHeight = useStoreSelector(
    terminalStore,
    (state) => state.constrainHeight,
  );
  const body = useExpandedToolResultBody(callId);
  const fetchedForLiftRef = useRef<string | null>(null);

  useEffect(() => {
    if (constrainHeight) {
      fetchedForLiftRef.current = null;
      return;
    }
    if (!capped || body !== undefined || expansion === null) return;
    if (fetchedForLiftRef.current === callId) return;
    fetchedForLiftRef.current = callId;
    void expansion.commands.expand(callId);
  }, [constrainHeight, capped, body, callId, expansion]);
}

/**
 * Display-substitution wiring for a capped tool result (issue #3428 section
 * D): renders the capped preview until constraints lift and the transcript
 * body loads, then the full body in its place. Only string display bodies
 * are substituted; structured displays pass through unchanged, and the
 * model-facing copies are never touched.
 */
export function useExpandedResultDisplay<T>(
  callId: string,
  retention: { readonly capped: boolean } | undefined,
  resultDisplay: T | string | undefined,
): {
  capped: boolean;
  displayResult: T | string | undefined;
  expandedBody: string | undefined;
} {
  const capped = retention?.capped === true;
  const expandedBody = useExpandedToolResultBody(callId);
  useLoadExpandedToolResult(callId, capped);
  const displayResult =
    expandedBody !== undefined && typeof resultDisplay === 'string'
      ? expandedBody
      : resultDisplay;
  return { capped, displayResult, expandedBody };
}
