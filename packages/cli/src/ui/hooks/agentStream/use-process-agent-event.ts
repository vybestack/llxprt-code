/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { useCallback, useRef } from 'react';
import type { UseSubmitQueryDeps } from './useSubmitQuery.js';
import type { useStreamEventHandlers } from './useStreamEventHandlers.js';
import type { AgentEventRouter } from './useAgentEventStream.js';
import { dispatchAgentEvent } from './agentEventDispatcher.js';
import { isCurrentTurn } from './submitQueryTurnLifecycle.js';
import type { ObservationCallbacks } from '../../../observation/jspWiring.js';

export function useProcessAgentEvent(
  deps: UseSubmitQueryDeps,
  handlers: Pick<
    ReturnType<typeof useStreamEventHandlers>,
    | 'handleStreamAttemptDiscarded'
    | 'handleUserCancelledEvent'
    | 'handleErrorEvent'
    | 'handleChatCompressionEvent'
    | 'handleFinishedNotice'
    | 'handleMaxSessionTurnsEvent'
    | 'handleContextWindowWillOverflowEvent'
    | 'handleCitationEvent'
  >,
  activeTurnRef: React.MutableRefObject<boolean>,
  observation: ObservationCallbacks,
) {
  // Latest-ref pattern: store deps+handlers in a ref so the useCallback
  // never needs to change identity (avoids recreating every render).
  const latestDeps = useRef({ ...deps, observation });
  latestDeps.current = { ...deps, observation };
  const latestHandlers = useRef(handlers);
  latestHandlers.current = handlers;
  return useCallback<AgentEventRouter>(
    (event, userMessageTimestamp, signal) => {
      if (!isCurrentTurn(latestDeps.current, signal)) {
        return;
      }
      // P07: live phase tracking for granular cancellation classification is
      // routed OUTSIDE this handler's call site (via the
      // onAgentEventObserved callback in useAgentEventStream, invoked directly
      // outside the generic catch — D8). It must NOT live inside
      // processAgentEvent, where it could be swallowed by this handler's
      // callers. See useAgentStreamOrchestration.useEventStreamForAgent.
      // Release the interactive active-turn gate and responding state BEFORE
      // dispatching fallible event rendering for terminal public Agent
      // error/idle-timeout events. If rendering throws, the gate must already
      // be released so follow-up submissions are not queued while the
      // iterator/promise settles (issue #2954). The dispatcher preserves the
      // existing error-queue-clearing / idle-timeout-queue-preservation
      // semantics via handleErrorEvent's clearQueue option.
      const isTerminal =
        event.type === 'error' || event.type === 'idle-timeout';
      if (isTerminal) {
        activeTurnRef.current = false;
        latestDeps.current.setIsResponding(false);
      }
      latestDeps.current.observation.observeAgentEvent(event);
      dispatchAgentEvent(
        event,
        {
          addItem: latestDeps.current.addItem,
          setLastPromptTokenCount: latestDeps.current.setLastPromptTokenCount,
          flushPendingHistoryItem: latestDeps.current.flushPendingHistoryItem,
          pendingHistoryItemRef: latestDeps.current.pendingHistoryItemRef,
          loopDetectedRef: latestDeps.current.loopDetectedRef,
          lastModelInfoRef: latestDeps.current.lastModelInfoRef,
          lastModelIdentityRef: latestDeps.current.lastModelIdentityRef,
          setLastAgentActivityTime: latestDeps.current.setLastAgentActivityTime,
          setThought: latestDeps.current.setThought,
          ...latestHandlers.current,
        },
        userMessageTimestamp,
      );
    },
    [activeTurnRef],
  );
}
