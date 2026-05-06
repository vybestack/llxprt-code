/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import type { Key } from './useKeypress.js';
import type {
  EnrichedSessionSummary,
  UseSessionBrowserProps,
} from './useSessionBrowser.js';
import type {
  BrowserRefs,
  BrowserSetters,
  DerivedState,
} from './useSessionBrowserHelpers.js';

const SORT_CYCLE: Array<'newest' | 'oldest' | 'size'> = [
  'newest',
  'oldest',
  'size',
];

interface ControllerContext {
  hasActiveConversation: boolean;
  onClose: () => void;
  executeResume: (session: EnrichedSessionSummary) => void;
  executeDelete: (session: EnrichedSessionSummary) => void;
}

export function useSessionKeypressHandler(params: {
  props: UseSessionBrowserProps;
  refs: BrowserRefs;
  setters: BrowserSetters;
  derived: DerivedState;
  executeResume: (session: EnrichedSessionSummary) => void;
  executeDelete: (session: EnrichedSessionSummary) => void;
}): (input: string, key: Key) => void {
  return useCallback(
    (input: string, key: Key) => {
      const context = buildControllerContext(params);
      if (clearErrorOrBlocked(params.refs, params.setters)) return;
      if (handleModalKeys(input, key, params, context)) return;
      if (handleGlobalKeys(key, params.refs, params.setters, context)) return;
      if (
        handleNavigationKeys(
          key,
          params.refs,
          params.setters,
          params.derived,
          context,
        )
      )
        return;
      handleModeSpecificKeys(
        input,
        key,
        params.refs,
        params.setters,
        params.derived,
      );
    },
    [params],
  );
}

function buildControllerContext(params: {
  props: UseSessionBrowserProps;
  executeResume: (session: EnrichedSessionSummary) => void;
  executeDelete: (session: EnrichedSessionSummary) => void;
}): ControllerContext {
  return {
    hasActiveConversation: params.props.hasActiveConversation ?? false,
    onClose: params.props.onClose,
    executeResume: params.executeResume,
    executeDelete: params.executeDelete,
  };
}

function clearErrorOrBlocked(
  refs: BrowserRefs,
  setters: BrowserSetters,
): boolean {
  if (refs.errorRef.current !== null) setters.setError(null);
  return refs.isResumingRef.current;
}

function handleModalKeys(
  input: string,
  key: Key,
  params: {
    refs: BrowserRefs;
    setters: BrowserSetters;
    derived: DerivedState;
  },
  context: ControllerContext,
): boolean {
  const deleteIndex = params.refs.deleteConfirmIndexRef.current;
  if (deleteIndex !== null) {
    return handleDeleteConfirm(
      input,
      key,
      params.setters,
      params.derived.pageItems,
      deleteIndex,
      context,
    );
  }
  if (params.refs.conversationConfirmActiveRef.current) {
    return handleConversationConfirm(
      input,
      key,
      params.setters,
      params.derived.selectedSession,
      context,
    );
  }
  return false;
}

function handleDeleteConfirm(
  input: string,
  key: Key,
  setters: BrowserSetters,
  pageItems: EnrichedSessionSummary[],
  deleteIndex: number,
  context: ControllerContext,
): boolean {
  const lowerInput = input.toLowerCase();
  if (lowerInput === 'y') {
    const session = pageItems.at(deleteIndex);
    if (session !== undefined) context.executeDelete(session);
  } else if (lowerInput === 'n' || key.name === 'escape') {
    setters.setDeleteConfirmIndex(null);
  }
  return true;
}

function handleConversationConfirm(
  input: string,
  key: Key,
  setters: BrowserSetters,
  selectedSession: EnrichedSessionSummary | null,
  context: ControllerContext,
): boolean {
  const lowerInput = input.toLowerCase();
  if (lowerInput === 'y') {
    setters.setConversationConfirmActive(false);
    if (selectedSession !== null) context.executeResume(selectedSession);
  } else if (lowerInput === 'n' || key.name === 'escape') {
    setters.setConversationConfirmActive(false);
  }
  return true;
}

function handleGlobalKeys(
  key: Key,
  refs: BrowserRefs,
  setters: BrowserSetters,
  context: ControllerContext,
): boolean {
  if (key.name === 'escape') {
    if (refs.searchTermRef.current !== '') resetSearch(setters);
    else context.onClose();
    return true;
  }
  if (key.name === 'tab') {
    setters.setIsSearching(!refs.isSearchingRef.current);
    return true;
  }
  return false;
}

function resetSearch(setters: BrowserSetters): void {
  setters.setSearchTerm('');
  setters.setSelectedIndex(0);
  setters.setPage(0);
}

function handleNavigationKeys(
  key: Key,
  refs: BrowserRefs,
  setters: BrowserSetters,
  derived: DerivedState,
  context: ControllerContext,
): boolean {
  if (key.name === 'return') {
    handleReturnKey(setters, derived.selectedSession, context);
    return true;
  }
  if (key.name === 'pagedown') return handlePageDown(setters, derived);
  if (key.name === 'pageup') return handlePageUp(setters, derived);
  if (key.name === 'up') return handleMoveUp(refs, setters);
  if (key.name === 'down')
    return handleMoveDown(refs, setters, derived.pageItems);
  return false;
}

function handleReturnKey(
  setters: BrowserSetters,
  selectedSession: EnrichedSessionSummary | null,
  context: ControllerContext,
): void {
  if (selectedSession === null) return;
  if (context.hasActiveConversation) setters.setConversationConfirmActive(true);
  else context.executeResume(selectedSession);
}

function handlePageDown(
  setters: BrowserSetters,
  derived: DerivedState,
): boolean {
  if (derived.clampedPage < derived.totalPages - 1) {
    setters.setPage(derived.clampedPage + 1);
    setters.setSelectedIndex(0);
  }
  return true;
}

function handlePageUp(setters: BrowserSetters, derived: DerivedState): boolean {
  if (derived.clampedPage > 0) {
    setters.setPage(derived.clampedPage - 1);
    setters.setSelectedIndex(0);
  }
  return true;
}

function handleMoveUp(refs: BrowserRefs, setters: BrowserSetters): boolean {
  if (refs.selectedIndexRef.current > 0)
    setters.setSelectedIndex(refs.selectedIndexRef.current - 1);
  return true;
}

function handleMoveDown(
  refs: BrowserRefs,
  setters: BrowserSetters,
  pageItems: EnrichedSessionSummary[],
): boolean {
  if (refs.selectedIndexRef.current < pageItems.length - 1) {
    setters.setSelectedIndex(refs.selectedIndexRef.current + 1);
  }
  return true;
}

function handleModeSpecificKeys(
  input: string,
  key: Key,
  refs: BrowserRefs,
  setters: BrowserSetters,
  derived: DerivedState,
): void {
  if (refs.isSearchingRef.current) {
    handleSearchModeKey(input, key, refs, setters);
    return;
  }
  handleNavModeKey(input, key, refs, setters, derived);
}

function handleSearchModeKey(
  input: string,
  key: Key,
  refs: BrowserRefs,
  setters: BrowserSetters,
): void {
  if (key.name === 'backspace') {
    if (refs.searchTermRef.current.length > 0) {
      setters.setSearchTerm(refs.searchTermRef.current.slice(0, -1));
      setters.setSelectedIndex(0);
      setters.setPage(0);
    }
    return;
  }
  if (input.length === 1 && !key.ctrl && !key.meta) {
    setters.setSearchTerm(refs.searchTermRef.current + input);
    setters.setSelectedIndex(0);
    setters.setPage(0);
  }
}

function handleNavModeKey(
  input: string,
  key: Key,
  refs: BrowserRefs,
  setters: BrowserSetters,
  derived: DerivedState,
): void {
  if (key.name === 'delete') {
    if (derived.pageItems.length > 0 && derived.selectedSession !== null) {
      setters.setDeleteConfirmIndex(refs.selectedIndexRef.current);
    }
    return;
  }
  if (input === 's') {
    const currentIdx = SORT_CYCLE.indexOf(refs.sortOrderRef.current);
    setters.setSortOrder(SORT_CYCLE[(currentIdx + 1) % SORT_CYCLE.length]);
  }
}
