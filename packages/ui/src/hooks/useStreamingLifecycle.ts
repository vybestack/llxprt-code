import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useRef } from 'react';
import type { ConfigSession } from '../features/config/configSession';
import type { ToolConfirmationEvent } from '../features/config';
import type { ToolCall } from './useChatStore';
import { useStreamingResponder } from './useStreamingResponder';
import type { ScheduleFn } from './useToolScheduler';

interface UseStreamingLifecycleResult {
  streamRunId: RefObject<number>;
  mountedRef: RefObject<boolean>;
  abortRef: RefObject<AbortController | null>;
  cancelStreaming: () => void;
  startStreamingResponder: (
    prompt: string,
    session: ConfigSession | null,
  ) => Promise<void>;
}

export function useStreamingLifecycle(
  appendMessage: (
    role: 'user' | 'model' | 'thinking' | 'system',
    text: string,
    profileName?: string,
  ) => string,
  appendToMessage: (id: string, text: string) => void,
  appendToolCall: (
    callId: string,
    name: string,
    params: Record<string, unknown>,
  ) => string,
  updateToolCall: (
    callId: string,
    update: Partial<Omit<ToolCall, 'id' | 'kind' | 'callId'>>,
  ) => void,
  setResponderWordCount: Dispatch<SetStateAction<number>>,
  setStreamState: Dispatch<SetStateAction<'idle' | 'busy'>>,
  scheduleTools: ScheduleFn,
  onConfirmationNeeded?: (event: ToolConfirmationEvent) => void,
  profileName?: string,
): UseStreamingLifecycleResult {
  const streamRunId = useRef(0);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const startStreamingResponder = useStreamingResponder(
    appendMessage,
    appendToMessage,
    appendToolCall,
    updateToolCall,
    setResponderWordCount,
    setStreamState,
    streamRunId,
    mountedRef,
    abortRef,
    scheduleTools,
    onConfirmationNeeded,
    profileName,
  );

  const cancelStreaming = useCallback(() => {
    streamRunId.current += 1;
    abortRef.current?.abort();
    setStreamState('idle');
  }, [setStreamState]);

  return {
    streamRunId,
    mountedRef,
    abortRef,
    cancelStreaming,
    startStreamingResponder,
  };
}
