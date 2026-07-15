/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CliUiRuntime } from '../cliUiRuntime.js';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from 'react';
import { AsyncFzf } from 'fzf';
import type {
  FileFilteringOptions,
  FileSearch,
  MCPResource,
} from '@vybestack/llxprt-code-core';
import {
  FileSearchFactory,
  escapePath,
  DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
  DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
  DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
} from '@vybestack/llxprt-code-core';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import { MAX_SUGGESTIONS_TO_SHOW } from '../components/SuggestionsDisplay.js';

const DEFAULT_SEARCH_TIMEOUT_MS = 5000;
const SEARCH_DEBOUNCE_MS = 150;

export enum AtCompletionStatus {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  READY = 'ready',
  SEARCHING = 'searching',
  ERROR = 'error',
}

interface AtCompletionState {
  status: AtCompletionStatus;
  suggestions: Suggestion[];
  isLoading: boolean;
  pattern: PatternInput;
}

type AtCompletionAction =
  | { type: 'INITIALIZE' }
  | { type: 'INITIALIZE_SUCCESS' }
  | { type: 'SEARCH'; payload: string }
  | { type: 'SEARCH_SUCCESS'; payload: Suggestion[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SEARCH_CANCELLED' }
  | { type: 'ERROR' }
  | { type: 'RESET' };

const initialState: AtCompletionState = {
  status: AtCompletionStatus.IDLE,
  suggestions: [],
  isLoading: false,
  pattern: null,
};

function atCompletionReducer(
  state: AtCompletionState,
  action: AtCompletionAction,
): AtCompletionState {
  switch (action.type) {
    case 'INITIALIZE':
      return {
        ...state,
        status: AtCompletionStatus.INITIALIZING,
        isLoading: true,
      };
    case 'INITIALIZE_SUCCESS':
      return { ...state, status: AtCompletionStatus.READY, isLoading: false };
    case 'SEARCH':
      // Keep old suggestions, don't set loading immediately
      return {
        ...state,
        status: AtCompletionStatus.SEARCHING,
        pattern: action.payload,
      };
    case 'SEARCH_SUCCESS':
      return {
        ...state,
        status: AtCompletionStatus.READY,
        suggestions: action.payload,
        isLoading: false,
      };
    case 'SET_LOADING':
      // Only show loading if we are still in a searching state
      if (state.status === AtCompletionStatus.SEARCHING) {
        return { ...state, isLoading: action.payload, suggestions: [] };
      }
      return state;
    case 'SEARCH_CANCELLED':
      if (state.status === AtCompletionStatus.SEARCHING) {
        return { ...state, status: AtCompletionStatus.READY, isLoading: false };
      }
      return state;

    case 'ERROR':
      return {
        ...state,
        status: AtCompletionStatus.ERROR,
        isLoading: false,
        suggestions: [],
      };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

interface ResourceSuggestionCandidate {
  searchKey: string;
  suggestion: Suggestion;
}

interface SubagentSuggestionCandidate {
  searchKey: string;
  suggestion: Suggestion;
}

type PatternInput = string | null;

function fileFilteringOptions(
  config: CliUiRuntime | undefined,
): FileFilteringOptions | undefined {
  return config?.getFileFilteringOptions();
}

function getResourceRegistry(config: CliUiRuntime | undefined) {
  if (config === undefined) {
    return undefined;
  }

  return config.getResourceRegistry();
}

function getSubagentManager(config: CliUiRuntime | undefined) {
  if (config === undefined) {
    return undefined;
  }

  return config.getSubagentManager();
}

function hasResourceIdentity(resource: MCPResource): boolean {
  return resource.serverName.length > 0 && resource.uri.length > 0;
}

function buildResourceCandidates(
  config: CliUiRuntime | undefined,
): ResourceSuggestionCandidate[] {
  const registry = getResourceRegistry(config);

  if (registry === undefined) {
    return [];
  }

  return registry
    .getAllResources()
    .filter(hasResourceIdentity)
    .map((resource) => {
      const prefixedUri = `${resource.serverName}:${resource.uri}`;
      return {
        searchKey: `${prefixedUri} ${resource.name}`.toLowerCase(),
        suggestion: {
          label: prefixedUri,
          value: prefixedUri,
        },
      };
    });
}

async function buildSubagentCandidates(
  config: CliUiRuntime | undefined,
): Promise<SubagentSuggestionCandidate[]> {
  const subagentManager = getSubagentManager(config);
  if (!subagentManager) {
    return [];
  }

  try {
    const names = await subagentManager.listSubagents();
    return names.map((name) => ({
      searchKey: name.toLowerCase(),
      suggestion: {
        label: name,
        value: name,
        description: 'subagent',
      },
    }));
  } catch {
    return [];
  }
}

async function searchResourceCandidates(
  pattern: string,
  candidates: ResourceSuggestionCandidate[],
  signal: AbortSignal,
): Promise<Suggestion[]> {
  if (candidates.length === 0) {
    return [];
  }

  const normalizedPattern = pattern.toLowerCase();
  if (!normalizedPattern) {
    return candidates
      .slice(0, MAX_SUGGESTIONS_TO_SHOW)
      .map((candidate) => candidate.suggestion);
  }

  const fzf = new AsyncFzf(candidates, {
    selector: (candidate: ResourceSuggestionCandidate) => candidate.searchKey,
  });
  const results = await fzf.find(normalizedPattern, {
    limit: MAX_SUGGESTIONS_TO_SHOW * 3,
  });

  if (signal.aborted) {
    return [];
  }

  return results.map(
    (result: { item: ResourceSuggestionCandidate }) => result.item.suggestion,
  );
}

async function searchSubagentCandidates(
  pattern: string,
  candidates: SubagentSuggestionCandidate[],
  signal: AbortSignal,
): Promise<Suggestion[]> {
  if (candidates.length === 0) {
    return [];
  }

  const normalizedPattern = pattern.toLowerCase();
  if (!normalizedPattern) {
    return candidates
      .slice(0, MAX_SUGGESTIONS_TO_SHOW)
      .map((candidate) => candidate.suggestion);
  }

  const fzf = new AsyncFzf(candidates, {
    selector: (candidate: SubagentSuggestionCandidate) => candidate.searchKey,
  });
  const results = await fzf.find(normalizedPattern, {
    limit: MAX_SUGGESTIONS_TO_SHOW * 3,
  });

  if (signal.aborted) {
    return [];
  }

  return results.map(
    (result: { item: SubagentSuggestionCandidate }) => result.item.suggestion,
  );
}

async function createFileSearcher(
  config: CliUiRuntime | undefined,
  cwd: string,
): Promise<FileSearch> {
  const filteringOptions = fileFilteringOptions(config);
  const searcher = FileSearchFactory.create({
    projectRoot: cwd,
    ignoreDirs: DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
    ignorePatterns: DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
    useGitignore: filteringOptions?.respectGitIgnore ?? true,
    useExtensionIgnore: filteringOptions?.respectLlxprtIgnore ?? true,
    cache: true,
    cacheTtl: 30, // 30 seconds
    enableRecursiveFileSearch: config?.getEnableRecursiveFileSearch() ?? true,
    enableFuzzySearch: !(config?.getFileFilteringDisableFuzzySearch() ?? false),
    maxFiles: filteringOptions?.maxFileCount,
    maxDepth: DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
  });

  await searcher.initialize();
  return searcher;
}

function handleSkippedSearchDispatch(
  signal: AbortSignal,
  pattern: string,
  shouldDispatchResult: (pattern: string) => boolean,
  dispatch: React.Dispatch<AtCompletionAction>,
): boolean {
  const isCurrentPattern = shouldDispatchResult(pattern);
  if (signal.aborted) {
    if (isCurrentPattern) {
      dispatch({ type: 'SEARCH_CANCELLED' });
    }
    return true;
  }
  return !isCurrentPattern;
}

async function performSearch(
  fileSearch: FileSearch,
  pattern: string,
  config: CliUiRuntime | undefined,
  controller: AbortController,
  clearSlowSearchTimer: () => void,
  shouldDispatchResult: (pattern: string) => boolean,
  dispatch: React.Dispatch<AtCompletionAction>,
): Promise<void> {
  const timeoutMs =
    fileFilteringOptions(config)?.searchTimeout ?? DEFAULT_SEARCH_TIMEOUT_MS;

  const searchTimeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const results = await fileSearch.search(pattern, {
      signal: controller.signal,
      maxResults: MAX_SUGGESTIONS_TO_SHOW * 3,
    });

    clearSlowSearchTimer();

    if (
      handleSkippedSearchDispatch(
        controller.signal,
        pattern,
        shouldDispatchResult,
        dispatch,
      )
    ) {
      return;
    }

    const fileSuggestions = results.map((p) => ({
      label: p,
      value: escapePath(p),
    }));

    const resourceCandidates = buildResourceCandidates(config);
    const resourceSuggestions = await searchResourceCandidates(
      pattern,
      resourceCandidates,
      controller.signal,
    );

    const subagentCandidates = await buildSubagentCandidates(config);
    const subagentSuggestions = await searchSubagentCandidates(
      pattern,
      subagentCandidates,
      controller.signal,
    );

    if (
      handleSkippedSearchDispatch(
        controller.signal,
        pattern,
        shouldDispatchResult,
        dispatch,
      )
    ) {
      return;
    }

    dispatch({
      type: 'SEARCH_SUCCESS',
      payload: [
        ...fileSuggestions,
        ...resourceSuggestions,
        ...subagentSuggestions,
      ],
    });
  } catch (error) {
    if (
      !(error instanceof Error && error.name === 'AbortError') &&
      !controller.signal.aborted &&
      shouldDispatchResult(pattern)
    ) {
      dispatch({ type: 'ERROR' });
    }
  } finally {
    clearTimeout(searchTimeout);

    controller.abort();
  }
}

export interface UseAtCompletionProps {
  enabled: boolean;
  pattern: PatternInput;
  config: CliUiRuntime | undefined;
  cwd: string;
  setSuggestions: (suggestions: Suggestion[]) => void;
  setIsLoadingSuggestions: (isLoading: boolean) => void;
}

function useSyncSuggestions(
  suggestions: Suggestion[],
  setSuggestions: (suggestions: Suggestion[]) => void,
): void {
  useEffect(() => {
    setSuggestions(suggestions);
  }, [suggestions, setSuggestions]);
}

function useSyncLoadingState(
  isLoading: boolean,
  setIsLoadingSuggestions: (isLoading: boolean) => void,
): void {
  useEffect(() => {
    setIsLoadingSuggestions(isLoading);
  }, [isLoading, setIsLoadingSuggestions]);
}

function useResetOnCwdChange(
  cwd: string,
  config: CliUiRuntime | undefined,
  fileSearch: React.MutableRefObject<FileSearch | null>,

  latestRequestedPattern: React.MutableRefObject<PatternInput>,
  lifecycleGeneration: React.MutableRefObject<number>,
  abortCurrentSearch: () => void,
  dispatch: React.Dispatch<AtCompletionAction>,
): void {
  useLayoutEffect(() => {
    lifecycleGeneration.current += 1;
    fileSearch.current = null;

    latestRequestedPattern.current = null;
    abortCurrentSearch();
    dispatch({ type: 'RESET' });
  }, [
    fileSearch,

    cwd,
    config,
    latestRequestedPattern,
    lifecycleGeneration,
    abortCurrentSearch,
    dispatch,
  ]);
}

function usePatternChangeHandler(
  enabled: boolean,
  pattern: PatternInput,
  state: AtCompletionState,
  latestRequestedPattern: React.MutableRefObject<PatternInput>,
  lifecycleGeneration: React.MutableRefObject<number>,
  abortCurrentSearch: () => void,
  dispatch: React.Dispatch<AtCompletionAction>,
): void {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      lifecycleGeneration.current += 1;
      latestRequestedPattern.current = null;
      abortCurrentSearch();
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (state.status !== AtCompletionStatus.IDLE) {
        dispatch({ type: 'RESET' });
      }

      return undefined;
    }

    if (pattern === null) {
      lifecycleGeneration.current += 1;
      latestRequestedPattern.current = null;
      abortCurrentSearch();
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      dispatch({ type: 'RESET' });
      return undefined;
    }

    const normalizedPattern = pattern.toLowerCase();
    latestRequestedPattern.current = normalizedPattern;
    if (state.status === AtCompletionStatus.IDLE) {
      dispatch({ type: 'INITIALIZE' });
    } else if (
      (state.status === AtCompletionStatus.READY ||
        state.status === AtCompletionStatus.SEARCHING) &&
      normalizedPattern !== state.pattern
    ) {
      lifecycleGeneration.current += 1;
      abortCurrentSearch();
      if (normalizedPattern === '') {
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        dispatch({ type: 'SEARCH', payload: normalizedPattern });
      } else {
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          dispatch({ type: 'SEARCH', payload: normalizedPattern });
        }, SEARCH_DEBOUNCE_MS);
      }
    }

    return (): void => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    enabled,
    pattern,
    state.status,
    state.pattern,
    latestRequestedPattern,
    lifecycleGeneration,
    abortCurrentSearch,
    dispatch,
  ]);
}

function useInitializationHandler(
  state: AtCompletionState,
  config: CliUiRuntime | undefined,
  cwd: string,
  fileSearch: React.MutableRefObject<FileSearch | null>,
  initializationGeneration: React.MutableRefObject<number>,
  dispatch: React.Dispatch<AtCompletionAction>,
): void {
  useEffect(() => {
    if (state.status !== AtCompletionStatus.INITIALIZING) {
      return;
    }

    const generation = initializationGeneration.current;
    const initialize = async (): Promise<void> => {
      try {
        const searcher = await createFileSearcher(config, cwd);
        if (generation !== initializationGeneration.current) {
          return;
        }
        fileSearch.current = searcher;
        dispatch({ type: 'INITIALIZE_SUCCESS' });
        if (state.pattern !== null) {
          dispatch({ type: 'SEARCH', payload: state.pattern });
        }
      } catch {
        if (generation === initializationGeneration.current) {
          dispatch({ type: 'ERROR' });
        }
      }
    };

    void initialize();
  }, [
    state.status,
    state.pattern,
    config,
    cwd,
    fileSearch,
    initializationGeneration,
    dispatch,
  ]);
}

function useSearchHandler(
  state: AtCompletionState,
  config: CliUiRuntime | undefined,
  fileSearch: React.MutableRefObject<FileSearch | null>,
  latestRequestedPattern: React.MutableRefObject<PatternInput>,
  lifecycleGeneration: React.MutableRefObject<number>,

  searchAbortController: React.MutableRefObject<AbortController | null>,
  dispatch: React.Dispatch<AtCompletionAction>,
): void {
  const slowSearchTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (state.status !== AtCompletionStatus.SEARCHING) {
      return undefined;
    }
    if (!fileSearch.current || state.pattern === null) {
      return undefined;
    }

    if (slowSearchTimer.current) {
      clearTimeout(slowSearchTimer.current);
    }

    const generation = lifecycleGeneration.current;

    const controller = new AbortController();
    searchAbortController.current = controller;

    slowSearchTimer.current = setTimeout(() => {
      if (
        searchAbortController.current === controller &&
        lifecycleGeneration.current === generation &&
        latestRequestedPattern.current === state.pattern
      ) {
        dispatch({ type: 'SET_LOADING', payload: true });
      }
    }, 200);

    void performSearch(
      fileSearch.current,
      state.pattern,
      config,
      controller,
      () => {
        if (
          searchAbortController.current === controller &&
          slowSearchTimer.current !== null
        ) {
          clearTimeout(slowSearchTimer.current);
          slowSearchTimer.current = null;
        }
      },

      (searchPattern) =>
        lifecycleGeneration.current === generation &&
        latestRequestedPattern.current === searchPattern,

      dispatch,
    );

    return (): void => {
      if (searchAbortController.current !== null) {
        searchAbortController.current.abort();
      }
      if (slowSearchTimer.current !== null) {
        clearTimeout(slowSearchTimer.current);
        slowSearchTimer.current = null;
      }
    };
  }, [
    state.status,
    state.pattern,
    lifecycleGeneration,

    config,
    fileSearch,
    latestRequestedPattern,
    searchAbortController,

    dispatch,
  ]);
}

export function useAtCompletion(props: UseAtCompletionProps): void {
  const {
    enabled,
    pattern,
    config,
    cwd,
    setSuggestions,
    setIsLoadingSuggestions,
  } = props;
  const [state, dispatch] = useReducer(atCompletionReducer, initialState);
  const fileSearch = useRef<FileSearch | null>(null);
  const latestRequestedPattern = useRef<PatternInput>(
    enabled && pattern !== null ? pattern.toLowerCase() : null,
  );
  const searchAbortController = useRef<AbortController | null>(null);
  const lifecycleGeneration = useRef(0);

  latestRequestedPattern.current =
    enabled && pattern !== null ? pattern.toLowerCase() : null;

  const abortCurrentSearch = useCallback((): void => {
    searchAbortController.current?.abort();
  }, []);

  useSyncSuggestions(state.suggestions, setSuggestions);
  useSyncLoadingState(state.isLoading, setIsLoadingSuggestions);
  useResetOnCwdChange(
    cwd,
    config,
    fileSearch,

    latestRequestedPattern,
    lifecycleGeneration,
    abortCurrentSearch,
    dispatch,
  );
  usePatternChangeHandler(
    enabled,
    pattern,
    state,
    latestRequestedPattern,
    lifecycleGeneration,
    abortCurrentSearch,
    dispatch,
  );
  useInitializationHandler(
    state,
    config,
    cwd,
    fileSearch,
    lifecycleGeneration,
    dispatch,
  );

  useSearchHandler(
    state,
    config,
    fileSearch,
    latestRequestedPattern,
    lifecycleGeneration,

    searchAbortController,
    dispatch,
  );
}
