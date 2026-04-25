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

  return results.map(
    (result: { item: ResourceSuggestionCandidate }) => result.item.suggestion,
  );
}

async function searchSubagentCandidates(
  pattern: string,
  candidates: SubagentSuggestionCandidate[],
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

  return results.map(
    (result: { item: SubagentSuggestionCandidate }) => result.item.suggestion,
  );
}

export interface UseAtCompletionProps {
  enabled: boolean;
  pattern: PatternInput;
  config: Config | undefined;
  cwd: string;
  setSuggestions: (suggestions: Suggestion[]) => void;
  setIsLoadingSuggestions: (isLoading: boolean) => void;
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
  const searchAbortController = useRef<AbortController | null>(null);
  const slowSearchTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setSuggestions(state.suggestions);
  }, [state.suggestions, setSuggestions]);

  useEffect(() => {
    setIsLoadingSuggestions(state.isLoading);
  }, [state.isLoading, setIsLoadingSuggestions]);

  useEffect(() => {
    dispatch({ type: 'RESET' });
  }, [cwd, config]);

  // Reacts to user input (`pattern`) ONLY.
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
  }, [enabled, pattern, state.status, state.pattern]);

  // The "Worker" that performs async operations based on status.
  useEffect(() => {
    const initialize = async () => {
      try {
        const filteringOptions = fileFilteringOptions(config);
        const searcher = FileSearchFactory.create({
          projectRoot: cwd,
          ignoreDirs: [],
          useGitignore: filteringOptions?.respectGitIgnore ?? true,
          useGeminiignore: filteringOptions?.respectGitIgnore ?? true,
          cache: true,
          cacheTtl: 30, // 30 seconds
          enableRecursiveFileSearch:
            config?.getEnableRecursiveFileSearch() ?? true,
          enableFuzzySearch: !(
            config?.getFileFilteringDisableFuzzySearch() ?? false
          ),
          maxFiles: filteringOptions?.maxFileCount,
        });
        await searcher.initialize();
        fileSearch.current = searcher;
        dispatch({ type: 'INITIALIZE_SUCCESS' });
        if (state.pattern !== null) {
          dispatch({ type: 'SEARCH', payload: state.pattern });
        }
      } catch (_) {
        dispatch({ type: 'ERROR' });
      }
    };

    const search = async () => {
      if (!fileSearch.current || state.pattern === null) {
        return;
      }

      if (slowSearchTimer.current) {
        clearTimeout(slowSearchTimer.current);
      }

      const controller = new AbortController();
      searchAbortController.current = controller;

      slowSearchTimer.current = setTimeout(() => {
        dispatch({ type: 'SET_LOADING', payload: true });
      }, 200);

      const timeoutMs =
        fileFilteringOptions(config)?.searchTimeout ??
        DEFAULT_SEARCH_TIMEOUT_MS;

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
        const results = await fileSearch.current.search(state.pattern, {
          signal: controller.signal,
          maxResults: MAX_SUGGESTIONS_TO_SHOW * 3,
        });

        clearTimeout(slowSearchTimer.current);

        if (controller.signal.aborted) {
          return;
        }

        const fileSuggestions = results.map((p) => ({
          label: p,
          value: escapePath(p),
        }));

        const resourceCandidates = buildResourceCandidates(config);
        const resourceSuggestions = await searchResourceCandidates(
          state.pattern,
          resourceCandidates,
        );

        const subagentCandidates = await buildSubagentCandidates(config);
        const subagentSuggestions = await searchSubagentCandidates(
          state.pattern,
          subagentCandidates,
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
    };

    if (state.status === AtCompletionStatus.INITIALIZING) {
      void initialize();
    } else if (state.status === AtCompletionStatus.SEARCHING) {
      void search();
    }

    return () => {
      searchAbortController.current?.abort();
      if (slowSearchTimer.current) {
        clearTimeout(slowSearchTimer.current);
      }
    };
  }, [state.status, state.pattern, config, cwd]);
}
