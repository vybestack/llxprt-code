/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy session browser behavior is being decomposed without changing behavior. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SessionDiscovery,
  SessionLockManager,
  deleteSession,
} from '@vybestack/llxprt-code-core';
import type { SessionSummary } from '@vybestack/llxprt-code-core';
import type { Key } from './useKeypress.js';
import type {
  EnrichedSessionSummary,
  PreviewState,
  UseSessionBrowserProps,
  UseSessionBrowserResult,
} from './useSessionBrowser.js';
import { useSessionKeypressHandler } from './useSessionBrowserKeypress.js';

const PAGE_SIZE = 20;

type SortOrder = 'newest' | 'oldest' | 'size';
type PreviewCache = Map<string, { text: string | null; state: PreviewState }>;

export interface BrowserRefs {
  searchTermRef: React.MutableRefObject<string>;
  sortOrderRef: React.MutableRefObject<SortOrder>;
  selectedIndexRef: React.MutableRefObject<number>;
  pageRef: React.MutableRefObject<number>;
  isSearchingRef: React.MutableRefObject<boolean>;
  isResumingRef: React.MutableRefObject<boolean>;
  deleteConfirmIndexRef: React.MutableRefObject<number | null>;
  conversationConfirmActiveRef: React.MutableRefObject<boolean>;
  errorRef: React.MutableRefObject<string | null>;
}

export interface BrowserSetters {
  setSearchTerm: (value: string) => void;
  setSortOrder: (value: SortOrder) => void;
  setSelectedIndex: (value: number) => void;
  setPage: (value: number) => void;
  setIsSearching: (value: boolean) => void;
  setIsResuming: (value: boolean) => void;
  setDeleteConfirmIndex: (value: number | null) => void;
  setConversationConfirmActive: (value: boolean) => void;
  setError: (value: string | null) => void;
}

export interface PaginationValues {
  sorted: EnrichedSessionSummary[];
  totalPages: number;
  clampedPage: number;
  pageItems: EnrichedSessionSummary[];
  selectedSession: EnrichedSessionSummary | null;
}

export interface DerivedState extends PaginationValues {
  getSortedSessions: () => EnrichedSessionSummary[];
  getPaginationValues: () => PaginationValues;
  previewPageKey: string;
  refreshPagination: () => PaginationValues;
}

interface CoreState {
  sessions: EnrichedSessionSummary[];
  setSessions: React.Dispatch<React.SetStateAction<EnrichedSessionSummary[]>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  skippedCount: number;
  setSkippedCount: React.Dispatch<React.SetStateAction<number>>;
}

type CoreSetters = Pick<
  CoreState,
  'setSessions' | 'setIsLoading' | 'setSkippedCount'
>;

export function useSessionBrowserController(
  props: UseSessionBrowserProps,
): UseSessionBrowserResult {
  const core = useCoreState();
  const { refs, setters } = useBrowserRefsAndSetters();
  const generationRef = useRef(0);
  const previewCacheRef = useRef<PreviewCache>(new Map());
  const selectedSessionIdRef = useRef<string | null>(null);
  const derived = useDerivedState(core.sessions, refs);
  const loadPreviewsForPage = usePreviewLoader(
    generationRef,
    previewCacheRef,
    core.setSessions,
  );
  const coreSetters = useMemo(
    () => ({
      setSessions: core.setSessions,
      setIsLoading: core.setIsLoading,
      setSkippedCount: core.setSkippedCount,
    }),
    [core.setIsLoading, core.setSessions, core.setSkippedCount],
  );
  const loaderDeps = useMemo(
    () => ({
      coreSetters,
      refs,
      setters,
      generationRef,
      previewCacheRef,
      selectedSessionIdRef,
      loadPreviewsForPage,
    }),
    [
      coreSetters,
      refs,
      setters,
      generationRef,
      previewCacheRef,
      selectedSessionIdRef,
      loadPreviewsForPage,
    ],
  );
  const loadSessions = useSessionLoader(props, loaderDeps);
  const executeResume = useResumeExecutor(props, setters);
  const deleteDeps = useMemo(
    () => ({ setters, selectedSessionIdRef, loadSessions }),
    [setters, selectedSessionIdRef, loadSessions],
  );
  const executeDelete = useDeleteExecutor(props, deleteDeps);
  const handleKeypress = useSessionKeypressHandler({
    props,
    refs,
    setters,
    derived,
    executeResume,
    executeDelete,
  });
  useSessionBrowserEffects({
    isLoading: core.isLoading,
    derived,
    refs,
    setters,
    generationRef,
    loadSessions,
    loadPreviewsForPage,
  });
  return buildResult(core, refs, derived, handleKeypress);
}

function useCoreState(): CoreState {
  const [sessions, setSessions] = useState<EnrichedSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [skippedCount, setSkippedCount] = useState(0);
  return useMemo(
    () => ({
      sessions,
      setSessions,
      isLoading,
      setIsLoading,
      skippedCount,
      setSkippedCount,
    }),
    [sessions, isLoading, skippedCount],
  );
}

function useSyncedState<T>(
  initialValue: T,
): [React.MutableRefObject<T>, (value: T) => void] {
  const ref = useRef(initialValue);
  const [, setState] = useState(initialValue);
  const setValue = useCallback((value: T) => {
    ref.current = value;
    setState(value);
  }, []);
  return [ref, setValue];
}

function useBrowserRefsAndSetters(): {
  refs: BrowserRefs;
  setters: BrowserSetters;
} {
  const [searchTermRef, setSearchTerm] = useSyncedState('');
  const [sortOrderRef, setSortOrder] = useSyncedState<SortOrder>('newest');
  const [selectedIndexRef, setSelectedIndex] = useSyncedState(0);
  const [pageRef, setPage] = useSyncedState(0);
  const [isSearchingRef, setIsSearching] = useSyncedState(true);
  const [isResumingRef, setIsResuming] = useSyncedState(false);
  const [deleteConfirmIndexRef, setDeleteConfirmIndex] = useSyncedState<
    number | null
  >(null);
  const [conversationConfirmActiveRef, setConversationConfirmActive] =
    useSyncedState(false);
  const [errorRef, setError] = useSyncedState<string | null>(null);
  return useMemo(
    () => ({
      refs: {
        searchTermRef,
        sortOrderRef,
        selectedIndexRef,
        pageRef,
        isSearchingRef,
        isResumingRef,
        deleteConfirmIndexRef,
        conversationConfirmActiveRef,
        errorRef,
      },
      setters: {
        setSearchTerm,
        setSortOrder,
        setSelectedIndex,
        setPage,
        setIsSearching,
        setIsResuming,
        setDeleteConfirmIndex,
        setConversationConfirmActive,
        setError,
      },
    }),
    [
      searchTermRef,
      sortOrderRef,
      selectedIndexRef,
      pageRef,
      isSearchingRef,
      isResumingRef,
      deleteConfirmIndexRef,
      conversationConfirmActiveRef,
      errorRef,
      setSearchTerm,
      setSortOrder,
      setSelectedIndex,
      setPage,
      setIsSearching,
      setIsResuming,
      setDeleteConfirmIndex,
      setConversationConfirmActive,
      setError,
    ],
  );
}

function useDerivedState(
  sessions: EnrichedSessionSummary[],
  refs: BrowserRefs,
): DerivedState {
  const getFilteredSessions = useCallback(
    () => filterSessions(sessions, refs.searchTermRef.current),
    [sessions, refs.searchTermRef],
  );
  const getSortedSessions = useCallback(
    () => sortSessions(getFilteredSessions(), refs.sortOrderRef.current),
    [getFilteredSessions, refs.sortOrderRef],
  );
  const getPaginationValues = useCallback(
    () =>
      getPagination(
        getSortedSessions(),
        refs.pageRef.current,
        refs.selectedIndexRef.current,
      ),
    [getSortedSessions, refs.pageRef, refs.selectedIndexRef],
  );
  const values = getPaginationValues();
  return {
    ...values,
    getSortedSessions,
    getPaginationValues,
    previewPageKey: values.pageItems
      .map((session) => session.sessionId)
      .join('|'),
    refreshPagination: getPaginationValues,
  };
}

function filterSessions(
  sessions: EnrichedSessionSummary[],
  term: string,
): EnrichedSessionSummary[] {
  if (term === '') return sessions;
  const lowerTerm = term.toLowerCase();
  return sessions.filter((session) => {
    if (session.previewState === 'loading') return true;
    const fields = [
      session.firstUserMessage ?? '',
      session.provider,
      session.model,
    ];
    return fields.some((field) => field.toLowerCase().includes(lowerTerm));
  });
}

function sortSessions(
  sessions: EnrichedSessionSummary[],
  order: SortOrder,
): EnrichedSessionSummary[] {
  const sorted = [...sessions];
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
      return sorted.sort((a, b) => b.fileSize - a.fileSize);
    default:
      return sorted;
  }
}

function getPagination(
  sorted: EnrichedSessionSummary[],
  currentPage: number,
  selectedIndex: number,
): PaginationValues {
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(currentPage, totalPages - 1);
  const start = clampedPage * PAGE_SIZE;
  const pageItems = sorted.slice(start, start + PAGE_SIZE);
  return {
    sorted,
    totalPages,
    clampedPage,
    pageItems,
    selectedSession: pageItems.at(selectedIndex) ?? null,
  };
}

function usePreviewLoader(
  generationRef: React.MutableRefObject<number>,
  previewCacheRef: React.MutableRefObject<PreviewCache>,
  setSessions: React.Dispatch<React.SetStateAction<EnrichedSessionSummary[]>>,
) {
  return useCallback(
    async (
      generation: number,
      sessionsToUse: EnrichedSessionSummary[],
      pageToUse: number,
    ) => {
      const currentPageItems = sessionsToUse.slice(
        pageToUse * PAGE_SIZE,
        pageToUse * PAGE_SIZE + PAGE_SIZE,
      );
      await Promise.allSettled(
        currentPageItems
          .filter((session) => !previewCacheRef.current.has(session.sessionId))
          .map((session) =>
            loadPreview(
              session,
              generation,
              generationRef,
              previewCacheRef,
              setSessions,
            ),
          ),
      );
    },
    [generationRef, previewCacheRef, setSessions],
  );
}

async function loadPreview(
  session: EnrichedSessionSummary,
  generation: number,
  generationRef: React.MutableRefObject<number>,
  previewCacheRef: React.MutableRefObject<PreviewCache>,
  setSessions: React.Dispatch<React.SetStateAction<EnrichedSessionSummary[]>>,
): Promise<void> {
  try {
    const text = await SessionDiscovery.readFirstUserMessage(session.filePath);
    if (generation !== generationRef.current) return;
    const state: PreviewState = text !== null ? 'loaded' : 'none';
    previewCacheRef.current.set(session.sessionId, { text, state });
    updateSessionPreview(setSessions, session.sessionId, text, state);
  } catch {
    if (generation !== generationRef.current) return;
    previewCacheRef.current.set(session.sessionId, {
      text: null,
      state: 'error',
    });
    updateSessionPreview(setSessions, session.sessionId, undefined, 'error');
  }
}

function updateSessionPreview(
  setSessions: React.Dispatch<React.SetStateAction<EnrichedSessionSummary[]>>,
  sessionId: string,
  text: string | null | undefined,
  state: PreviewState,
): void {
  setSessions((prev) =>
    prev.map((session) =>
      session.sessionId === sessionId
        ? {
            ...session,
            firstUserMessage: text ?? undefined,
            previewState: state,
          }
        : session,
    ),
  );
}

interface LoaderDeps {
  coreSetters: CoreSetters;
  refs: BrowserRefs;
  setters: BrowserSetters;
  generationRef: React.MutableRefObject<number>;
  previewCacheRef: React.MutableRefObject<PreviewCache>;
  selectedSessionIdRef: React.MutableRefObject<string | null>;
  loadPreviewsForPage: (
    generation: number,
    sessionsToUse: EnrichedSessionSummary[],
    pageToUse: number,
  ) => Promise<void>;
}

function useSessionLoader(props: UseSessionBrowserProps, deps: LoaderDeps) {
  const processSession = useSessionProcessor(
    props.chatsDir,
    deps.generationRef,
    deps.previewCacheRef,
  );
  return useCallback(async () => {
    const currentGen = beginSessionLoad(deps);
    try {
      const result = await SessionDiscovery.listSessionsDetailed(
        props.chatsDir,
        props.projectHash,
      );
      if (currentGen !== deps.generationRef.current) return;
      const filtered = await filterDetailedSessions(
        result.sessions,
        currentGen,
        props.currentSessionId,
        processSession,
      );
      if (filtered === null) return;
      const pageToLoad = finishSessionLoad(result.skippedCount, filtered, deps);
      await deps.loadPreviewsForPage(currentGen, filtered.sessions, pageToLoad);
    } catch (loadError) {
      if (currentGen !== deps.generationRef.current) return;
      deps.setters.setError(
        `Failed to load sessions: ${loadError instanceof Error ? loadError.message : String(loadError)}`,
      );
      deps.coreSetters.setIsLoading(false);
    }
  }, [
    deps,
    processSession,
    props.chatsDir,
    props.currentSessionId,
    props.projectHash,
  ]);
}

function beginSessionLoad(deps: LoaderDeps): number {
  deps.generationRef.current += 1;
  deps.coreSetters.setIsLoading(true);
  deps.setters.setError(null);
  return deps.generationRef.current;
}

interface FilteredSessionsResult {
  sessions: EnrichedSessionSummary[];
  skippedCount: number;
}

async function filterDetailedSessions(
  sessions: SessionSummary[],
  currentGen: number,
  currentSessionId: string,
  processSession: (
    session: SessionSummary,
    currentGen: number,
    currentSessionId: string,
  ) => Promise<{ enriched: EnrichedSessionSummary } | { skipped: true } | null>,
): Promise<FilteredSessionsResult | null> {
  const filtered: EnrichedSessionSummary[] = [];
  let skippedCount = 0;
  for (const session of sessions) {
    const result = await processSession(session, currentGen, currentSessionId);
    if (result === null) return null;
    if ('skipped' in result) skippedCount++;
    else filtered.push(result.enriched);
  }
  return { sessions: filtered, skippedCount };
}

function finishSessionLoad(
  initialSkippedCount: number,
  filtered: FilteredSessionsResult,
  deps: LoaderDeps,
): number {
  deps.coreSetters.setSkippedCount(initialSkippedCount + filtered.skippedCount);
  deps.coreSetters.setSessions(filtered.sessions);
  deps.coreSetters.setIsLoading(false);
  return restoreSelectionAfterLoad(filtered.sessions, deps);
}

function restoreSelectionAfterLoad(
  filtered: EnrichedSessionSummary[],
  deps: LoaderDeps,
): number {
  let pageToLoad = 0;
  if (deps.selectedSessionIdRef.current) {
    const idx = filtered.findIndex(
      (session) => session.sessionId === deps.selectedSessionIdRef.current,
    );
    if (idx >= 0) {
      deps.setters.setSelectedIndex(idx % PAGE_SIZE);
      pageToLoad = Math.floor(idx / PAGE_SIZE);
      deps.setters.setPage(pageToLoad);
    }
    deps.selectedSessionIdRef.current = null;
  }
  return pageToLoad;
}

function useSessionProcessor(
  chatsDir: string,
  generationRef: React.MutableRefObject<number>,
  previewCacheRef: React.MutableRefObject<PreviewCache>,
) {
  return useCallback(
    async (
      session: SessionSummary,
      currentGen: number,
      currentSessionId: string,
    ): Promise<
      { enriched: EnrichedSessionSummary } | { skipped: true } | null
    > => {
      if (session.sessionId === currentSessionId) return { skipped: true };
      const hasContent = await SessionDiscovery.hasContentEvents(
        session.filePath,
      );
      if (currentGen !== generationRef.current) return null;
      if (!hasContent) return { skipped: true };
      const locked = await SessionLockManager.isLocked(
        chatsDir,
        session.sessionId,
      );
      if (currentGen !== generationRef.current) return null;
      const cached = previewCacheRef.current.get(session.sessionId);
      return { enriched: buildEnrichedSession(session, locked, cached) };
    },
    [chatsDir, generationRef, previewCacheRef],
  );
}

function buildEnrichedSession(
  session: SessionSummary,
  locked: boolean,
  cached: { text: string | null; state: PreviewState } | undefined,
): EnrichedSessionSummary {
  return {
    ...session,
    isLocked: locked,
    previewState: cached ? cached.state : 'loading',
    firstUserMessage: cached?.text ?? undefined,
  };
}

function useResumeExecutor(
  props: UseSessionBrowserProps,
  setters: BrowserSetters,
): (session: EnrichedSessionSummary) => void {
  return useCallback(
    (session: EnrichedSessionSummary) => {
      void executeResumeSession(session, props, setters);
    },
    [props, setters],
  );
}

async function executeResumeSession(
  session: EnrichedSessionSummary,
  props: UseSessionBrowserProps,
  setters: BrowserSetters,
): Promise<void> {
  setters.setIsResuming(true);
  setters.setError(null);
  try {
    const resumeResult = await props.onSelect(session);
    setters.setIsResuming(false);
    if (resumeResult.ok) props.onClose();
    else setters.setError(resumeResult.error);
  } catch (err) {
    setters.setIsResuming(false);
    setters.setError(err instanceof Error ? err.message : String(err));
  }
}

function useDeleteExecutor(
  props: UseSessionBrowserProps,
  deps: {
    setters: BrowserSetters;
    selectedSessionIdRef: React.MutableRefObject<string | null>;
    loadSessions: () => Promise<void>;
  },
): (session: EnrichedSessionSummary) => void {
  return useCallback(
    (session: EnrichedSessionSummary) => {
      void executeDeleteSession(session, props, deps);
    },
    [deps, props],
  );
}

async function executeDeleteSession(
  session: EnrichedSessionSummary,
  props: UseSessionBrowserProps,
  deps: {
    setters: BrowserSetters;
    selectedSessionIdRef: React.MutableRefObject<string | null>;
    loadSessions: () => Promise<void>;
  },
): Promise<void> {
  deps.selectedSessionIdRef.current = session.sessionId;
  try {
    const locked = await SessionLockManager.isLocked(
      props.chatsDir,
      session.sessionId,
    );
    if (locked) {
      deps.setters.setError('Cannot delete: session is in use');
      deps.setters.setDeleteConfirmIndex(null);
      return;
    }
    await deleteSession(session.sessionId, props.chatsDir, props.projectHash);
    deps.setters.setDeleteConfirmIndex(null);
    await deps.loadSessions();
  } catch (err) {
    deps.setters.setError(err instanceof Error ? err.message : String(err));
    deps.setters.setDeleteConfirmIndex(null);
  }
}

function useSessionBrowserEffects(params: {
  isLoading: boolean;
  derived: DerivedState;
  refs: BrowserRefs;
  setters: BrowserSetters;
  generationRef: React.MutableRefObject<number>;
  loadSessions: () => Promise<void>;
  loadPreviewsForPage: (
    generation: number,
    sessionsToUse: EnrichedSessionSummary[],
    pageToUse: number,
  ) => Promise<void>;
}): void {
  const {
    isLoading,
    derived,
    refs,
    setters,
    generationRef,
    loadSessions,
    loadPreviewsForPage,
  } = params;

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);
  useEffect(() => {
    if (!isLoading && derived.sorted.length > 0) {
      void loadPreviewsForPage(
        generationRef.current,
        derived.sorted,
        derived.clampedPage,
      );
    }
  }, [
    derived.clampedPage,
    derived.previewPageKey,
    generationRef,
    isLoading,
    loadPreviewsForPage,
    derived.sorted,
  ]);
  useClampEffects(
    derived.pageItems.length,
    derived.sorted.length,
    refs,
    setters,
  );
}

function useClampEffects(
  pageItemsLength: number,
  sortedSessionsLength: number,
  refs: BrowserRefs,
  setters: BrowserSetters,
): void {
  useEffect(() => {
    if (pageItemsLength === 0 && refs.selectedIndexRef.current !== 0)
      setters.setSelectedIndex(0);
    else if (refs.selectedIndexRef.current >= pageItemsLength) {
      setters.setSelectedIndex(Math.max(0, pageItemsLength - 1));
    }
  }, [pageItemsLength, refs, setters]);
  useEffect(() => {
    const newTotalPages = Math.max(
      1,
      Math.ceil(sortedSessionsLength / PAGE_SIZE),
    );
    if (refs.pageRef.current >= newTotalPages)
      setters.setPage(Math.max(0, newTotalPages - 1));
  }, [refs, setters, sortedSessionsLength]);
}

function buildResult(
  core: CoreState,
  refs: BrowserRefs,
  derived: DerivedState,
  handleKeypress: (input: string, key: Key) => void,
): UseSessionBrowserResult {
  return {
    sessions: core.sessions,
    get filteredSessions() {
      return derived.getSortedSessions();
    },
    get searchTerm() {
      return refs.searchTermRef.current;
    },
    get sortOrder() {
      return refs.sortOrderRef.current;
    },
    get selectedIndex() {
      return refs.selectedIndexRef.current;
    },
    get page() {
      return derived.getPaginationValues().clampedPage;
    },
    get isSearching() {
      return refs.isSearchingRef.current;
    },
    isLoading: core.isLoading,
    get isResuming() {
      return refs.isResumingRef.current;
    },
    get deleteConfirmIndex() {
      return refs.deleteConfirmIndexRef.current;
    },
    get conversationConfirmActive() {
      return refs.conversationConfirmActiveRef.current;
    },
    get error() {
      return refs.errorRef.current;
    },
    skippedCount: core.skippedCount,
    get totalPages() {
      return derived.getPaginationValues().totalPages;
    },
    get pageItems() {
      return derived.getPaginationValues().pageItems;
    },
    get selectedSession() {
      return derived.getPaginationValues().selectedSession;
    },
    handleKeypress,
  };
}
