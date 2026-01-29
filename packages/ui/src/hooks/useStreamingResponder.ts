import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import type { Role, StreamState, ToolCall } from './useChatStore';
import type { ConfigSession } from '../features/config/configSession';
import type { AdapterEvent, ToolConfirmationEvent } from '../features/config';
import { sendMessageWithSession } from '../features/config';
import type {
  ToolCallRequestInfo,
  CompletedToolCall,
} from '@vybestack/llxprt-code-core';
import type { ScheduleFn } from './useToolScheduler';
import { getLogger } from '../lib/logger';

const logger = getLogger('nui:streaming-responder');

type StateSetter<T> = Dispatch<SetStateAction<T>>;

interface RefHandle<T> {
  current: T;
}

interface StreamContext {
  modelMessageId: string | null;
  thinkingMessageId: string | null;
  /** Track tool calls by their backend callId */
  toolCalls: Map<string, string>;
}

function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

type ToolCallUpdate = Partial<Omit<ToolCall, 'id' | 'kind' | 'callId'>>;

function handleAdapterEvent(
  event: AdapterEvent,
  context: StreamContext,
  appendMessage: (role: Role, text: string) => string,
  appendToMessage: (id: string, text: string) => void,
  appendToolCall: (
    callId: string,
    name: string,
    params: Record<string, unknown>,
  ) => string,
  updateToolCall: (callId: string, update: ToolCallUpdate) => void,
  setResponderWordCount: StateSetter<number>,
  scheduleTools: ScheduleFn,
  signal: AbortSignal,
  onConfirmationNeeded?: (event: ToolConfirmationEvent) => void,
): StreamContext {
  if (event.type === 'text_delta') {
    const text = event.text;
    // Skip empty or whitespace-only text when starting a new message
    if (context.modelMessageId === null) {
      if (text.trim() === '') {
        return context;
      }
      const id = appendMessage('model', text);
      setResponderWordCount((count) => count + countWords(text));
      return { ...context, modelMessageId: id };
    }
    appendToMessage(context.modelMessageId, text);
    setResponderWordCount((count) => count + countWords(text));
    return context;
  }
  if (event.type === 'thinking_delta') {
    const text = event.text;
    // Skip empty or whitespace-only text when starting a new message
    if (context.thinkingMessageId === null) {
      if (text.trim() === '') {
        return context;
      }
      const id = appendMessage('thinking', text);
      setResponderWordCount((count) => count + countWords(text));
      return { ...context, thinkingMessageId: id };
    }
    appendToMessage(context.thinkingMessageId, text);
    setResponderWordCount((count) => count + countWords(text));
    return context;
  }
  if (event.type === 'tool_pending') {
    // Create a new ToolCall entry in UI
    const entryId = appendToolCall(event.id, event.name, event.params);
    const newToolCalls = new Map(context.toolCalls);
    newToolCalls.set(event.id, entryId);

    // Schedule the tool call via the scheduler (handles confirmation flow)
    const request: ToolCallRequestInfo = {
      callId: event.id,
      name: event.name,
      args: event.params,
      isClientInitiated: false,
      prompt_id: `nui-${Date.now()}`,
    };
    scheduleTools(request, signal);

    // Reset message IDs since model output may continue after tool
    return {
      modelMessageId: null,
      thinkingMessageId: null,
      toolCalls: newToolCalls,
    };
  }
  if (event.type === 'tool_result') {
    // Update existing tool call with result
    updateToolCall(event.id, {
      status: event.success ? 'complete' : 'error',
      output: event.output,
      errorMessage: event.errorMessage,
    });
    return context;
  }
  if (event.type === 'tool_confirmation') {
    // Update tool call with confirmation details
    updateToolCall(event.id, {
      status: 'confirming',
      confirmation: {
        confirmationType: event.confirmationType,
        question: event.question,
        preview: event.preview,
        canAllowAlways: event.canAllowAlways,
      },
    });
    // Notify UI that confirmation is needed
    if (onConfirmationNeeded) {
      onConfirmationNeeded(event);
    }
    return context;
  }
  if (event.type === 'tool_cancelled') {
    updateToolCall(event.id, { status: 'cancelled' });
    return context;
  }
  if (event.type === 'error') {
    appendMessage('system', `Error: ${event.message}`);
    return context;
  }
  // Handle complete and unknown events - no action needed
  return context;
}

export type UseStreamingResponderFunction = (
  prompt: string,
  session: ConfigSession | null,
) => Promise<void>;

/**
 * Callback to handle completed tools - sends responses back to the model
 */
export type OnToolsCompleteCallback = (
  session: ConfigSession,
  completedTools: CompletedToolCall[],
  signal: AbortSignal,
) => Promise<void>;

export function useStreamingResponder(
  appendMessage: (role: Role, text: string) => string,
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
  setResponderWordCount: StateSetter<number>,
  setStreamState: StateSetter<StreamState>,
  streamRunId: RefHandle<number>,
  mountedRef: RefHandle<boolean>,
  abortRef: RefHandle<AbortController | null>,
  scheduleTools: ScheduleFn,
  onConfirmationNeeded?: (event: ToolConfirmationEvent) => void,
): UseStreamingResponderFunction {
  return useCallback(
    async (prompt: string, session: ConfigSession | null) => {
      // Validate session exists
      if (session === null) {
        appendMessage(
          'system',
          'No active session. Load a profile first with /profile load <name>',
        );
        return;
      }

      streamRunId.current += 1;
      const currentRun = streamRunId.current;

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setStreamState('busy');

      let context: StreamContext = {
        modelMessageId: null,
        thinkingMessageId: null,
        toolCalls: new Map(),
      };

      let hasScheduledTools = false;

      try {
        // Stream messages from the model
        for await (const event of sendMessageWithSession(
          session,
          prompt,
          controller.signal,
        )) {
          if (!mountedRef.current || streamRunId.current !== currentRun) {
            break;
          }
          // Track if any tools were scheduled
          if (event.type === 'tool_pending') {
            hasScheduledTools = true;
          }
          context = handleAdapterEvent(
            event,
            context,
            appendMessage,
            appendToMessage,
            appendToolCall,
            updateToolCall,
            setResponderWordCount,
            scheduleTools,
            controller.signal,
            onConfirmationNeeded,
          );
        }
        // Tool execution is handled by the scheduler via callbacks
        // The scheduler will call onAllToolCallsComplete when tools finish
        // If tools were scheduled, DON'T set idle here - let the tool completion callback do it
      } catch (error) {
        if (!controller.signal.aborted) {
          const message =
            error instanceof Error ? error.message : String(error);
          appendMessage('system', `Error: ${message}`);
        }
      } finally {
        // Only set idle if no tools were scheduled (tools will set idle when complete)
        // Also set idle if aborted or component unmounted
        const wasAborted = controller.signal.aborted;
        const isCurrent = streamRunId.current === currentRun;

        if (
          mountedRef.current &&
          isCurrent &&
          (wasAborted || !hasScheduledTools)
        ) {
          setStreamState('idle');
        }
        // Only clear abortRef if no tools were scheduled
        // If tools are scheduled, we need to keep the controller for continuation
        if (abortRef.current === controller && !hasScheduledTools) {
          abortRef.current = null;
        }
      }
    },
    [
      appendMessage,
      appendToMessage,
      appendToolCall,
      updateToolCall,
      abortRef,
      mountedRef,
      setResponderWordCount,
      setStreamState,
      streamRunId,
      scheduleTools,
      onConfirmationNeeded,
    ],
  );
}

/**
 * Continue streaming after tools complete - sends tool responses to model
 * Returns true if new tools were scheduled, false if conversation turn is complete
 */
export async function continueStreamingAfterTools(
  session: ConfigSession,
  completedTools: CompletedToolCall[],
  signal: AbortSignal,
  appendMessage: (role: Role, text: string) => string,
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
  setResponderWordCount: StateSetter<number>,
  scheduleTools: ScheduleFn,
  setStreamState: StateSetter<StreamState>,
  onConfirmationNeeded?: (event: ToolConfirmationEvent) => void,
): Promise<boolean> {
  logger.debug(
    'continueStreamingAfterTools called',
    'toolCount:',
    completedTools.length,
  );

  // Collect all response parts from completed tools
  const responseParts = completedTools.flatMap(
    (tool) => tool.response.responseParts,
  );

  logger.debug(
    'continueStreamingAfterTools: collected response parts',
    'count:',
    responseParts.length,
  );

  if (responseParts.length === 0) {
    // No response parts to send - this might happen if all tools had validation errors
    // Check if there were any errors we should report
    const errors = completedTools
      .filter((tool) => tool.response.error)
      .map((tool) => tool.response.error?.message);

    logger.debug(
      'continueStreamingAfterTools: no response parts',
      'errorCount:',
      errors.length,
    );

    if (errors.length > 0) {
      // Append error messages to chat so user can see what went wrong
      for (const error of errors) {
        if (error) {
          appendMessage('system', `Tool error: ${error}`);
        }
      }
    }

    setStreamState('idle');
    return false;
  }

  // Send tool responses back to model
  const client = session.getClient();
  const promptId = `nui-continuation-${Date.now()}`;
  const stream = client.sendMessageStream(responseParts, signal, promptId);

  let context: StreamContext = {
    modelMessageId: null,
    thinkingMessageId: null,
    toolCalls: new Map(),
  };

  let hasScheduledTools = false;

  try {
    for await (const coreEvent of stream) {
      if (signal.aborted) {
        break;
      }
      // Transform and handle the event
      const { transformEvent } = await import(
        '../features/config/llxprtAdapter'
      );
      const event = transformEvent(coreEvent);

      // Track if any tools were scheduled during continuation
      if (event.type === 'tool_pending') {
        hasScheduledTools = true;
      }

      context = handleAdapterEvent(
        event,
        context,
        appendMessage,
        appendToMessage,
        appendToolCall,
        updateToolCall,
        setResponderWordCount,
        scheduleTools,
        signal,
        onConfirmationNeeded,
      );
    }
  } catch (error) {
    // Handle errors during continuation streaming
    if (!signal.aborted) {
      const message = error instanceof Error ? error.message : String(error);
      appendMessage('system', `Continuation error: ${message}`);
    }
  } finally {
    // Only set idle if no new tools were scheduled and not aborted
    // If tools were scheduled, the scheduler will handle setting idle when they complete
    if (!hasScheduledTools && !signal.aborted) {
      setStreamState('idle');
    }
  }

  return hasScheduledTools;
}
