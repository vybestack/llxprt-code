/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * React hook for session browser state management and keyboard handling.
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P12
 * @plan PLAN-20260214-SESSIONBROWSER.P14
 * @requirement REQ-SB-002, REQ-SR-001, REQ-SO-001, REQ-PG-001, REQ-KN-001
 * @pseudocode use-session-browser.md
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  SessionDiscovery,
  SessionLockManager,
  deleteSession,
} from '@vybestack/llxprt-code-core';
import type { SessionSummary } from '@vybestack/llxprt-code-core';
import type { PerformResumeResult } from '../../services/performResume.js';
import type { Key } from './useKeypress.js';

/**
 * Preview loading state for session first message.
 */
export type PreviewState = 'loading' | 'loaded' | 'none' | 'error';

/**
 * Extended session summary with browser-specific enrichments.
 */
export interface EnrichedSessionSummary extends SessionSummary {
  /** First user message extracted from session, if available */
  firstUserMessage?: string;
  /** Current state of preview loading */
  previewState: PreviewState;
  /** Whether this session is currently locked by another process */
  isLocked: boolean;
}

/**
 * Props for the useSessionBrowser hook.
 */
export interface UseSessionBrowserProps {
  /** Directory containing chat session files */
  chatsDir: string;
  /** Hash identifying the current project */
  projectHash: string;
  /** ID of the currently active session (to exclude from list) */
  currentSessionId: string;
  /** Callback to handle session selection/resume */
  onSelect: (session: SessionSummary) => Promise<PerformResumeResult>;
  /** Callback to close the browser */
  onClose: () => void;
  /** Whether there's an active conversation that would be abandoned */
  hasActiveConversation?: boolean;
}

/**
 * Result returned by the useSessionBrowser hook.
 */
export interface UseSessionBrowserResult {
  // State
  sessions: EnrichedSessionSummary[];
  filteredSessions: EnrichedSessionSummary[];
  searchTerm: string;
  sortOrder: 'newest' | 'oldest' | 'size';
  selectedIndex: number;
  page: number;
  isSearching: boolean;
  isLoading: boolean;
  isResuming: boolean;
  deleteConfirmIndex: number | null;
  conversationConfirmActive: boolean;
  error: string | null;
  skippedCount: number;

  // Derived
  totalPages: number;
  pageItems: EnrichedSessionSummary[];
  selectedSession: EnrichedSessionSummary | null;

  // Actions
  handleKeypress: (input: string, key: Key) => void;
}

// Constants
const PAGE_SIZE = 20;
const SORT_CYCLE: Array<'newest' | 'oldest' | 'size'> = [
  'newest',
  'oldest',
  'size',
];

/**
 * React hook for managing session browser state and interactions.
 */
export function useSessionBrowser(
  props: UseSessionBrowserProps,
): UseSessionBrowserResult {
  const {
    chatsDir,
    projectHash,
    currentSessionId,
    onSelect,
    onClose,
    hasActiveConversation = false,
  } = props;

  // === Core State ===
  const [sessions, setSessions] = useState<EnrichedSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [skippedCount, setSkippedCount] = useState(0);

  // Using refs for immediate synchronous updates + state for React re-renders
  // Tests observe refs via getters; React re-renders from state
  const searchTermRef = useRef('');
  const [, setSearchTermState] = useState('');

  const sortOrderRef = useRef<'newest' | 'oldest' | 'size'>('newest');
  const [, setSortOrderState] = useState<'newest' | 'oldest' | 'size'>(
    'newest',
  );

  const selectedIndexRef = useRef(0);
  const [, setSelectedIndexState] = useState(0);

  const pageRef = useRef(0);
  const [, setPageState] = useState(0);

  const isSearchingRef = useRef(true);
  const [, setIsSearchingState] = useState(true);

  const isResumingRef = useRef(false);
  const [, setIsResumingState] = useState(false);

  const deleteConfirmIndexRef = useRef<number | null>(null);
  const [, setDeleteConfirmIndexState] = useState<number | null>(null);

  const conversationConfirmActiveRef = useRef(false);
  const [, setConversationConfirmActiveState] = useState(false);

  const errorRef = useRef<string | null>(null);
  const [, setErrorState] = useState<string | null>(null);

  // Helper to update both ref and state
  const setSearchTerm = (value: string) => {
    searchTermRef.current = value;
    setSearchTermState(value);
  };
  const setSortOrder = (value: 'newest' | 'oldest' | 'size') => {
    sortOrderRef.current = value;
    setSortOrderState(value);
  };
  const setSelectedIndex = (value: number) => {
    selectedIndexRef.current = value;
    setSelectedIndexState(value);
  };
  const setPage = (value: number) => {
    pageRef.current = value;
    setPageState(value);
  };
  const setIsSearching = (value: boolean) => {
    isSearchingRef.current = value;
    setIsSearchingState(value);
  };
  const setIsResuming = (value: boolean) => {
    isResumingRef.current = value;
    setIsResumingState(value);
  };
  const setDeleteConfirmIndex = (value: number | null) => {
    deleteConfirmIndexRef.current = value;
    setDeleteConfirmIndexState(value);
  };
  const setConversationConfirmActive = (value: boolean) => {
    conversationConfirmActiveRef.current = value;
    setConversationConfirmActiveState(value);
  };
  const setError = (value: string | null) => {
    errorRef.current = value;
    setErrorState(value);
  };

  // Refs for internal logic
  const generationRef = useRef(0);
  const previewCacheRef = useRef<
    Map<string, { text: string | null; state: PreviewState }>
  >(new Map());
  const selectedSessionIdRef = useRef<string | null>(null);

  // === Derived State ===
  // These need to be computed from refs for immediate values

  // Helper to compute filtered sessions
  const getFilteredSessions = useCallback(() => {
    const term = searchTermRef.current;
    if (term === '') {
      return sessions;
    }
    const lowerTerm = term.toLowerCase();
    return sessions.filter((s) => {
      // Always include sessions with unloaded previews (REQ-SR-003)
      if (s.previewState === 'loading') return true;
      // Match against loaded preview text, provider, model
      const fields = [
        s.firstUserMessage ?? '',
        s.provider ?? '',
        s.model ?? '',
      ];
      return fields.some((f) => f.toLowerCase().includes(lowerTerm));
    });
  }, [sessions]);

  // Helper to compute sorted sessions
  const getSortedSessions = useCallback(() => {
    const filtered = getFilteredSessions();
    const sorted = [...filtered];
    const order = sortOrderRef.current;
    switch (order) {
      case 'newest':
        return sorted.sort(
          (a, b) => b.lastModified.getTime() - a.lastModified.getTime(),
        );
      case 'oldest':
        return sorted.sort(
          (a, b) => a.lastModified.getTime() - b.lastModified.getTime(),
        );
      case 'size':
        return sorted.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
      default:
        return sorted;
    }
  }, [getFilteredSessions]);

  // Helper to compute pagination values
  const getPaginationValues = useCallback(() => {
    const sorted = getSortedSessions();
    const total = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const clamped = Math.min(pageRef.current, total - 1);
    const start = clamped * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const items = sorted.slice(start, end);
    const selected = items[selectedIndexRef.current] ?? null;
    return {
      sorted,
      totalPages: total,
      clampedPage: clamped,
      pageItems: items,
      selectedSession: selected,
    };
  }, [getSortedSessions]);

  // For useEffect dependencies, compute these once per render
  const sortedSessions = getSortedSessions();
  const { clampedPage, pageItems } = getPaginationValues();

  // === Preview Loading ===

  const loadPreviewsForPage = useCallback(
    async (
      generation: number,
      sessionsToUse: EnrichedSessionSummary[],
      pageToUse: number,
    ) => {
      const start = pageToUse * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      const currentPageItems = sessionsToUse.slice(start, end);

      const promises = currentPageItems
        .filter((s) => !previewCacheRef.current.has(s.sessionId))
        .map(async (session) => {
          try {
            const text = await SessionDiscovery.readFirstUserMessage(
              session.filePath,
            );
            if (generation !== generationRef.current) return; // Stale

            const state: PreviewState = text !== null ? 'loaded' : 'none';
            previewCacheRef.current.set(session.sessionId, { text, state });

            // Update session in state
            setSessions((prev) =>
              prev.map((s) =>
                s.sessionId === session.sessionId
                  ? {
                      ...s,
                      firstUserMessage: text ?? undefined,
                      previewState: state,
                    }
                  : s,
              ),
            );
          } catch {
            if (generation !== generationRef.current) return;
            previewCacheRef.current.set(session.sessionId, {
              text: null,
              state: 'error',
            });
            setSessions((prev) =>
              prev.map((s) =>
                s.sessionId === session.sessionId
                  ? { ...s, previewState: 'error' }
                  : s,
              ),
            );
          }
        });

      await Promise.allSettled(promises);
    },
    [], // No external dependencies - all parameters are passed explicitly
  );

  // === Load Sessions ===

  const loadSessions = useCallback(async () => {
    generationRef.current += 1;
    const currentGen = generationRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await SessionDiscovery.listSessionsDetailed(
        chatsDir,
        projectHash,
      );
      if (currentGen !== generationRef.current) return; // Stale

      let totalSkipped = result.skippedCount;

      // Filter out current session and empty sessions
      const filtered: EnrichedSessionSummary[] = [];
      for (const session of result.sessions) {
        if (session.sessionId === currentSessionId) {
          totalSkipped++;
          continue;
        }

        const hasContent = await SessionDiscovery.hasContentEvents(
          session.filePath,
        );
        if (currentGen !== generationRef.current) return;
        if (!hasContent) {
          totalSkipped++;
          continue;
        }

        // Check lock status (isLocked handles stale lock cleanup internally)
        const locked = await SessionLockManager.isLocked(
          chatsDir,
          session.sessionId,
        );
        if (currentGen !== generationRef.current) return;

        // Check preview cache
        const cached = previewCacheRef.current.get(session.sessionId);
        const enriched: EnrichedSessionSummary = {
          ...session,
          isLocked: locked,
          previewState: cached ? cached.state : 'loading',
          firstUserMessage: cached?.text ?? undefined,
        };
        filtered.push(enriched);
      }

      setSkippedCount(totalSkipped);
      setSessions(filtered);
      setIsLoading(false);

      // Restore selection by sessionId
      let pageToLoad = 0;
      if (selectedSessionIdRef.current) {
        const idx = filtered.findIndex(
          (s) => s.sessionId === selectedSessionIdRef.current,
        );
        if (idx >= 0) {
          setSelectedIndex(idx % PAGE_SIZE);
          pageToLoad = Math.floor(idx / PAGE_SIZE);
          setPage(pageToLoad);
        }
        selectedSessionIdRef.current = null;
      }

      // Load previews for visible page (pass filtered and page to avoid stale closure)
      await loadPreviewsForPage(currentGen, filtered, pageToLoad);
    } catch (loadError) {
      if (currentGen !== generationRef.current) return;
      setError(
        `Failed to load sessions: ${loadError instanceof Error ? loadError.message : String(loadError)}`,
      );
      setIsLoading(false);
    }
  }, [chatsDir, projectHash, currentSessionId, loadPreviewsForPage]);

  // Initial load
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // Load previews when page changes
  useEffect(() => {
    if (!isLoading && sortedSessions.length > 0) {
      void loadPreviewsForPage(
        generationRef.current,
        sortedSessions,
        clampedPage,
      );
    }
    // Note: sortedSessions is excluded from deps to prevent infinite loop.
    // This effect only triggers on explicit page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedPage, isLoading, loadPreviewsForPage]);

  // === Execute Resume ===

  const executeResume = useCallback(
    async (session: EnrichedSessionSummary) => {
      setIsResuming(true);
      setError(null);

      try {
        const resumeResult = await onSelect(session);
        setIsResuming(false);

        if (resumeResult.ok) {
          onClose();
        } else {
          // Don't call loadSessions - it would clear the error via setError(null)
          setError(resumeResult.error);
        }
      } catch (err) {
        setIsResuming(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [onSelect, onClose],
  );

  // === Execute Delete ===

  const executeDelete = useCallback(
    async (session: EnrichedSessionSummary) => {
      // Remember current selection for restoration
      selectedSessionIdRef.current = session.sessionId;

      try {
        // Check if locked
        const locked = await SessionLockManager.isLocked(
          chatsDir,
          session.sessionId,
        );
        if (locked) {
          setError('Cannot delete: session is in use');
          setDeleteConfirmIndex(null);
          return;
        }

        await deleteSession(session.sessionId, chatsDir, projectHash);
        setDeleteConfirmIndex(null);

        // Refresh sessions
        await loadSessions();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDeleteConfirmIndex(null);
      }
    },
    [chatsDir, projectHash, loadSessions],
  );

  // === Keyboard Handler ===

  const handleKeypress = useCallback(
    (input: string, key: Key) => {
      // Read current values from refs for synchronous access
      const currentError = errorRef.current;
      const currentIsResuming = isResumingRef.current;
      const currentDeleteConfirmIndex = deleteConfirmIndexRef.current;
      const currentConversationConfirmActive =
        conversationConfirmActiveRef.current;
      const currentSearchTerm = searchTermRef.current;
      const currentIsSearching = isSearchingRef.current;
      const currentSelectedIndex = selectedIndexRef.current;
      const currentSortOrder = sortOrderRef.current;

      // Compute current pagination values
      const {
        totalPages: currentTotalPages,
        clampedPage: currentClampedPage,
        pageItems: currentPageItems,
        selectedSession: currentSelectedSession,
      } = getPaginationValues();

      // Clear error on any input
      if (currentError !== null) {
        setError(null);
      }

      // Modal priority: isResuming blocks all keys
      if (currentIsResuming) {
        return;
      }

      // Modal priority: delete confirmation
      if (currentDeleteConfirmIndex !== null) {
        const lowerInput = input.toLowerCase();
        if (lowerInput === 'y') {
          const session = currentPageItems[currentDeleteConfirmIndex];
          if (session) {
            void executeDelete(session);
          }
        } else if (lowerInput === 'n' || key.name === 'escape') {
          setDeleteConfirmIndex(null);
        }
        // All other keys ignored during delete confirmation
        return;
      }

      // Modal priority: conversation confirmation
      if (currentConversationConfirmActive) {
        const lowerInput = input.toLowerCase();
        if (lowerInput === 'y') {
          setConversationConfirmActive(false);
          if (currentSelectedSession) {
            void executeResume(currentSelectedSession);
          }
        } else if (lowerInput === 'n' || key.name === 'escape') {
          setConversationConfirmActive(false);
        }
        // All other keys ignored during conversation confirmation
        return;
      }

      // Handle escape with precedence
      if (key.name === 'escape') {
        if (currentSearchTerm !== '') {
          setSearchTerm('');
          setSelectedIndex(0);
          setPage(0);
        } else {
          onClose();
        }
        return;
      }

      // Tab toggles search mode
      if (key.name === 'tab') {
        setIsSearching(!currentIsSearching);
        return;
      }

      // Enter: initiate resume
      if (key.name === 'return') {
        if (!currentSelectedSession) return;

        if (hasActiveConversation) {
          setConversationConfirmActive(true);
        } else {
          void executeResume(currentSelectedSession);
        }
        return;
      }

      // Page navigation
      if (key.name === 'pagedown') {
        if (currentClampedPage < currentTotalPages - 1) {
          setPage(currentClampedPage + 1);
          setSelectedIndex(0);
        }
        return;
      }

      if (key.name === 'pageup') {
        if (currentClampedPage > 0) {
          setPage(currentClampedPage - 1);
          setSelectedIndex(0);
        }
        return;
      }

      // Arrow navigation (works in both modes)
      if (key.name === 'up') {
        if (currentSelectedIndex > 0) {
          setSelectedIndex(currentSelectedIndex - 1);
        }
        return;
      }

      if (key.name === 'down') {
        if (currentSelectedIndex < currentPageItems.length - 1) {
          setSelectedIndex(currentSelectedIndex + 1);
        }
        return;
      }

      // Search mode specific
      if (currentIsSearching) {
        if (key.name === 'backspace') {
          if (currentSearchTerm.length > 0) {
            const newTerm = currentSearchTerm.slice(0, -1);
            setSearchTerm(newTerm);
            setSelectedIndex(0);
            setPage(0);
          }
          return;
        }

        // Printable characters
        if (input.length === 1 && !key.ctrl && !key.meta) {
          const newTerm = currentSearchTerm + input;
          setSearchTerm(newTerm);
          setSelectedIndex(0);
          setPage(0);
          return;
        }
      }

      // Nav mode specific
      if (!currentIsSearching) {
        // Delete key shows confirmation
        if (key.name === 'delete') {
          if (currentPageItems.length > 0 && currentSelectedSession) {
            setDeleteConfirmIndex(currentSelectedIndex);
          }
          return;
        }

        // 's' cycles sort order
        if (input === 's') {
          const currentIdx = SORT_CYCLE.indexOf(currentSortOrder);
          const nextIdx = (currentIdx + 1) % SORT_CYCLE.length;
          setSortOrder(SORT_CYCLE[nextIdx]);
          return;
        }

        // Characters and backspace are no-op in nav mode
        return;
      }
    },
    [
      getPaginationValues,
      hasActiveConversation,
      executeResume,
      executeDelete,
      onClose,
    ],
  );

  // Clamp selected index when page items change
  useEffect(() => {
    const currentSelectedIndex = selectedIndexRef.current;
    if (pageItems.length === 0) {
      if (currentSelectedIndex !== 0) {
        setSelectedIndex(0);
      }
    } else if (currentSelectedIndex >= pageItems.length) {
      setSelectedIndex(Math.max(0, pageItems.length - 1));
    }
  }, [pageItems.length]);

  // Reset page when search changes and would make current page invalid
  useEffect(() => {
    const currentPage = pageRef.current;
    const newTotalPages = Math.max(
      1,
      Math.ceil(sortedSessions.length / PAGE_SIZE),
    );
    if (currentPage >= newTotalPages) {
      setPage(Math.max(0, newTotalPages - 1));
    }
  }, [sortedSessions.length]);

  // Return object with getters for synchronous observation
  return {
    sessions,
    get filteredSessions() {
      return getSortedSessions();
    },
    get searchTerm() {
      return searchTermRef.current;
    },
    get sortOrder() {
      return sortOrderRef.current;
    },
    get selectedIndex() {
      return selectedIndexRef.current;
    },
    get page() {
      return getPaginationValues().clampedPage;
    },
    get isSearching() {
      return isSearchingRef.current;
    },
    isLoading,
    get isResuming() {
      return isResumingRef.current;
    },
    get deleteConfirmIndex() {
      return deleteConfirmIndexRef.current;
    },
    get conversationConfirmActive() {
      return conversationConfirmActiveRef.current;
    },
    get error() {
      return errorRef.current;
    },
    skippedCount,
    get totalPages() {
      return getPaginationValues().totalPages;
    },
    get pageItems() {
      return getPaginationValues().pageItems;
    },
    get selectedSession() {
      return getPaginationValues().selectedSession;
    },
    handleKeypress,
  };
}
