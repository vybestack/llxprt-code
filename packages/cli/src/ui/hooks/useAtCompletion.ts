/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useReducer, useRef } from 'react';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { AsyncFzf } from 'fzf';
import type {
  Config,
  FileFilteringOptions,
  FileSearch,
  MCPResource,
} from '@vybestack/llxprt-code-core';
import { FileSearchFactory, escapePath } from '@vybestack/llxprt-code-core';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import { MAX_SUGGESTIONS_TO_SHOW } from '../components/SuggestionsDisplay.js';

const DEFAULT_SEARCH_TIMEOUT_MS = 5000;

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
  config: Config | undefined,
): FileFilteringOptions | undefined {
  return config?.getFileFilteringOptions();
}

function getResourceRegistry(config: Config | undefined) {
  if (config === undefined) {
    return undefined;
  }

  const configWithOptionalRegistry = config as {
    getResourceRegistry?: Config['getResourceRegistry'];
  };
  return configWithOptionalRegistry.getResourceRegistry?.();
}

function getSubagentManager(config: Config | undefined) {
  if (config === undefined) {
    return undefined;
  }

  const configWithOptionalSubagents = config as {
    getSubagentManager?: Config['getSubagentManager'];
  };
  return configWithOptionalSubagents.getSubagentManager?.();
}

function hasResourceIdentity(resource: MCPResource): boolean {
  return resource.serverName.length > 0 && resource.uri.length > 0;
}

function buildResourceCandidates(
  config: Config | undefined,
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
  config: Config | undefined,
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
  config: Config | undefined,
  cwd: string,
): Promise<FileSearch> {
  const filteringOptions = fileFilteringOptions(config);
  const searcher = FileSearchFactory.create({
    projectRoot: cwd,
    ignoreDirs: [],
    useGitignore: filteringOptions?.respectGitIgnore ?? true,
    useGeminiignore: filteringOptions?.respectGitIgnore ?? true,
    cache: true,
    cacheTtl: 30, // 30 seconds
    enableRecursiveFileSearch: config?.getEnableRecursiveFileSearch() ?? true,
    enableFuzzySearch: !(config?.getFileFilteringDisableFuzzySearch() ?? false),
    maxFiles: filteringOptions?.maxFileCount,
  });
  await searcher.initialize();
  return searcher;
}

async function performSearch(
  fileSearch: FileSearch,
  pattern: string,
  config: Config | undefined,
  controller: AbortController,
  clearSlowSearchTimer: () => void,
  dispatch: React.Dispatch<AtCompletionAction>,
): Promise<void> {
  const timeoutMs =
    fileFilteringOptions(config)?.searchTimeout ?? DEFAULT_SEARCH_TIMEOUT_MS;

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    try {
      await setTimeoutPromise(timeoutMs, undefined, {
        signal: controller.signal,
      });
      controller.abort();
    } catch {
      // ignore
    }
  })();

  try {
    const results = await fileSearch.search(pattern, {
      signal: controller.signal,
      maxResults: MAX_SUGGESTIONS_TO_SHOW * 3,
    });

    clearSlowSearchTimer();

    if (controller.signal.aborted) {
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

    dispatch({
      type: 'SEARCH_SUCCESS',
      payload: [
        ...fileSuggestions,
        ...resourceSuggestions,
        ...subagentSuggestions,
      ],
    });
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      dispatch({ type: 'ERROR' });
    }
  } finally {
    controller.abort();
  }
}

export interface UseAtCompletionProps {
  enabled: boolean;
  pattern: PatternInput;
  config: Config | undefined;
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
  config: Config | undefined,
  dispatch: React.Dispatch<AtCompletionAction>,
): void {
  useEffect(() => {
    dispatch({ type: 'RESET' });
  }, [cwd, config, dispatch]);
}

function usePatternChangeHandler(
  enabled: boolean,
  pattern: PatternInput,
  state: AtCompletionState,
  dispatch: React.Dispatch<AtCompletionAction>,
): void {
  useEffect(() => {
    if (!enabled) {
      // reset when first getting out of completion suggestions
      if (
        state.status === AtCompletionStatus.READY ||
        state.status === AtCompletionStatus.ERROR
      ) {
        dispatch({ type: 'RESET' });
      }
      return;
    }
    if (pattern === null) {
      dispatch({ type: 'RESET' });
      return;
    }

    if (state.status === AtCompletionStatus.IDLE) {
      dispatch({ type: 'INITIALIZE' });
    } else if (
      (state.status === AtCompletionStatus.READY ||
        state.status === AtCompletionStatus.SEARCHING) &&
      pattern.toLowerCase() !== state.pattern // Only search if the pattern has changed
    ) {
      dispatch({ type: 'SEARCH', payload: pattern.toLowerCase() });
    }
  }, [enabled, pattern, state.status, state.pattern, dispatch]);
}

function useInitializationHandler(
  state: AtCompletionState,
  config: Config | undefined,
  cwd: string,
  fileSearch: React.MutableRefObject<FileSearch | null>,
  dispatch: React.Dispatch<AtCompletionAction>,
): void {
  useEffect(() => {
    if (state.status !== AtCompletionStatus.INITIALIZING) {
      return;
    }

    const initialize = async (): Promise<void> => {
      try {
        const searcher = await createFileSearcher(config, cwd);
        fileSearch.current = searcher;
        dispatch({ type: 'INITIALIZE_SUCCESS' });
        if (state.pattern !== null) {
          dispatch({ type: 'SEARCH', payload: state.pattern });
        }
      } catch {
        dispatch({ type: 'ERROR' });
      }
    };

    void initialize();
  }, [state.status, state.pattern, config, cwd, fileSearch, dispatch]);
}

function useSearchHandler(
  state: AtCompletionState,
  config: Config | undefined,
  fileSearch: React.MutableRefObject<FileSearch | null>,
  dispatch: React.Dispatch<AtCompletionAction>,
): void {
  const searchAbortController = useRef<AbortController | null>(null);
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

    const controller = new AbortController();
    searchAbortController.current = controller;

    slowSearchTimer.current = setTimeout(() => {
      dispatch({ type: 'SET_LOADING', payload: true });
    }, 200);

    void performSearch(
      fileSearch.current,
      state.pattern,
      config,
      controller,
      () => {
        if (slowSearchTimer.current !== null) {
          clearTimeout(slowSearchTimer.current);
          slowSearchTimer.current = null;
        }
      },
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
  }, [state.status, state.pattern, config, fileSearch, dispatch]);
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

  useSyncSuggestions(state.suggestions, setSuggestions);
  useSyncLoadingState(state.isLoading, setIsLoadingSuggestions);
  useResetOnCwdChange(cwd, config, dispatch);
  usePatternChangeHandler(enabled, pattern, state, dispatch);
  useInitializationHandler(state, config, cwd, fileSearch, dispatch);
  useSearchHandler(state, config, fileSearch, dispatch);
}
