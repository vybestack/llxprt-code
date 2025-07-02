/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from 'react';

import { type GenerateContentResponseUsageMetadata } from '@google/genai';

// --- Interface Definitions ---

export interface CumulativeStats {
  turnCount: number;
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount: number;
  toolUsePromptTokenCount: number;
  thoughtsTokenCount: number;
  apiTimeMs: number;
}

interface SessionStatsState {
  sessionStartTime: Date;
  cumulative: CumulativeStats;
  currentTurn: CumulativeStats;
  currentResponse: CumulativeStats;
}

// Interface for the dispatch functions
interface SessionStatsDispatch {
  startNewTurn: () => void;
  addUsage: (
    metadata: GenerateContentResponseUsageMetadata & { apiTimeMs?: number },
  ) => void;
}

// --- Context Definitions ---

const SessionStatsStateContext = createContext<SessionStatsState | undefined>(
  undefined,
);

const SessionStatsDispatchContext = createContext<
  SessionStatsDispatch | undefined
>(undefined);

// --- Helper Functions ---

/**
 * A small, reusable helper function to sum token counts.
 * It unconditionally adds all token values from the source to the target.
 * @param target The object to add the tokens to (e.g., cumulative, currentTurn).
 * @param source The metadata object from the API response.
 */
const addTokens = (
  target: CumulativeStats,
  source: GenerateContentResponseUsageMetadata & { apiTimeMs?: number },
) => {
  target.candidatesTokenCount += source.candidatesTokenCount ?? 0;
  target.thoughtsTokenCount += source.thoughtsTokenCount ?? 0;
  target.totalTokenCount += source.totalTokenCount ?? 0;
  target.apiTimeMs += source.apiTimeMs ?? 0;
  target.promptTokenCount += source.promptTokenCount ?? 0;
  target.cachedContentTokenCount += source.cachedContentTokenCount ?? 0;
  target.toolUsePromptTokenCount += source.toolUsePromptTokenCount ?? 0;
};

// Type for queued usage metadata
type QueuedUsage = GenerateContentResponseUsageMetadata & {
  apiTimeMs?: number;
};

// --- Provider Component ---

export const SessionStatsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [stats, setStats] = useState<SessionStatsState>({
    sessionStartTime: new Date(),
    cumulative: {
      turnCount: 0,
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
      cachedContentTokenCount: 0,
      toolUsePromptTokenCount: 0,
      thoughtsTokenCount: 0,
      apiTimeMs: 0,
    },
    currentTurn: {
      turnCount: 0,
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
      cachedContentTokenCount: 0,
      toolUsePromptTokenCount: 0,
      thoughtsTokenCount: 0,
      apiTimeMs: 0,
    },
    currentResponse: {
      turnCount: 0,
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
      cachedContentTokenCount: 0,
      toolUsePromptTokenCount: 0,
      thoughtsTokenCount: 0,
      apiTimeMs: 0,
    },
  });

  // Debounce infrastructure for batching metadata updates
  const DEBOUNCE_DELAY = 500; // 500ms debounce for batching updates
  const queueRef = useRef<QueuedUsage[]>([]);
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isFlushingRef = useRef(false);

  // Store the flush function in a ref to make it truly stable
  const flushRef = useRef<() => void>();
  
  // Define the flush implementation
  flushRef.current = () => {
    if (queueRef.current.length === 0 || isFlushingRef.current) {
      return;
    }

    isFlushingRef.current = true;
    const queuedItems = [...queueRef.current];
    queueRef.current = [];
    
    // Clear the timer reference immediately
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    setStats((prevState) => {
      const newCumulative = { ...prevState.cumulative };
      const newCurrentTurn = { ...prevState.currentTurn };
      const newCurrentResponse = {
        turnCount: 0,
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
        cachedContentTokenCount: 0,
        toolUsePromptTokenCount: 0,
        thoughtsTokenCount: 0,
        apiTimeMs: 0,
      };

      // Process all queued items
      for (const metadata of queuedItems) {
        addTokens(newCurrentTurn, metadata);
        addTokens(newCumulative, metadata);
        // For currentResponse, only the last item matters (overwrite behavior)
        if (metadata === queuedItems[queuedItems.length - 1]) {
          addTokens(newCurrentResponse, metadata);
        }
      }

      return {
        ...prevState,
        cumulative: newCumulative,
        currentTurn: newCurrentTurn,
        currentResponse: newCurrentResponse,
      };
    });

    // Reset flushing flag after state update completes
    // Use Promise.resolve() instead of setTimeout for microtask timing
    Promise.resolve().then(() => {
      isFlushingRef.current = false;
    });
  };

  // Create a stable flush function that calls the ref
  const flush = useCallback(() => {
    flushRef.current?.();
  }, []);

  // A single, internal worker function to handle all metadata aggregation.
  const addUsage = useCallback(
    (
      metadata: GenerateContentResponseUsageMetadata & { apiTimeMs?: number },
    ) => {
      // Prevent queuing during flush to avoid infinite loops
      if (isFlushingRef.current) {
        return;
      }

      // Add to queue instead of updating state immediately
      queueRef.current.push(metadata);

      // Clear existing timer if present
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
      }

      // Schedule flush with proper debounce delay
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null; // Clear reference before flush
        flush();
      }, DEBOUNCE_DELAY);
    },
    [flush], // Include flush in dependencies since it's stable
  );

  const startNewTurn = useCallback(() => {
    // Prevent starting new turn during flush
    if (isFlushingRef.current) {
      return;
    }

    // Flush any pending updates before starting a new turn
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      flush();
    }

    setStats((prevState) => ({
      ...prevState,
      cumulative: {
        ...prevState.cumulative,
        turnCount: prevState.cumulative.turnCount + 1,
      },
      currentTurn: {
        turnCount: 0, // Reset for the new turn's accumulation.
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
        cachedContentTokenCount: 0,
        toolUsePromptTokenCount: 0,
        thoughtsTokenCount: 0,
        apiTimeMs: 0,
      },
      currentResponse: {
        turnCount: 0,
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
        cachedContentTokenCount: 0,
        toolUsePromptTokenCount: 0,
        thoughtsTokenCount: 0,
        apiTimeMs: 0,
      },
    }));
  }, [flush]); // Include flush in dependencies since it's stable

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      // Flush any remaining metadata before unmount
      if (queueRef.current.length > 0 && !isFlushingRef.current) {
        flushRef.current?.();
      }
      queueRef.current = [];
      isFlushingRef.current = false;
    };
  }, []); // Empty deps for mount/unmount only

  const dispatchValue = useMemo(
    () => ({
      startNewTurn,
      addUsage,
    }),
    [startNewTurn, addUsage],
  );

  return (
    <SessionStatsStateContext.Provider value={stats}>
      <SessionStatsDispatchContext.Provider value={dispatchValue}>
        {children}
      </SessionStatsDispatchContext.Provider>
    </SessionStatsStateContext.Provider>
  );
};

// --- Consumer Hooks ---

export const useSessionStatsState = () => {
  const context = useContext(SessionStatsStateContext);
  if (context === undefined) {
    throw new Error(
      'useSessionStatsState must be used within a SessionStatsProvider',
    );
  }
  return context;
};

export const useSessionStatsDispatch = () => {
  const context = useContext(SessionStatsDispatchContext);
  if (context === undefined) {
    throw new Error(
      'useSessionStatsDispatch must be used within a SessionStatsProvider',
    );
  }
  return context;
};

// --- Deprecated Hook ---
/**
 * @deprecated Please use `useSessionStatsState` and `useSessionStatsDispatch` instead.
 */
export const useSessionStats = () => {
  const stats = useSessionStatsState();
  const dispatch = useSessionStatsDispatch();
  return { ...dispatch, stats };
};
