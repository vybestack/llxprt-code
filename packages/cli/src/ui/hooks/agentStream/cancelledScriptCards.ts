/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core';
import {
  applyToolScriptEvent,
  formatToolScriptCard,
  type ToolScriptRunView,
} from '@vybestack/llxprt-code-agents';
import type { SubscribeChildTools } from '../../../runtime/interactiveToolScheduler.js';
import type { UseHistoryManagerReturn } from '../useHistoryManager.js';
import type {
  MarkToolsAsDisplayClearedFn,
  TrackedCancelledToolCall,
  TrackedExecutingToolCall,
  TrackedToolCall,
} from '../useReactToolScheduler.js';
import { mapToDisplay } from '../toolMapping.js';

const SCRIPT_TOOL = 'execute_tool_script';

function cancelledCard(
  call: TrackedExecutingToolCall,
  run: ToolScriptRunView,
): TrackedCancelledToolCall {
  const source = call.request.args['source'];
  return {
    status: 'cancelled',
    request: call.request,
    tool: call.tool,
    invocation: call.invocation,
    response: {
      callId: call.request.callId,
      responseParts: [],
      resultDisplay: formatToolScriptCard(
        run,
        typeof source === 'string' ? { source } : {},
      ),
      error: undefined,
      errorType: undefined,
      agentId: call.request.agentId,
    },
  };
}

/**
 * A code mode run cancelled with its turn (Escape) gets no tool completion:
 * the agent loop stops waiting for a cancelled batch, so the running
 * `execute_tool_script` call would vanish from the screen. The run itself
 * still reports `finished` with CANCELLED through the child display; this
 * turns that record into a cancelled script card for the call the CLI was
 * showing (issue #4084). A subagent's runs are left to its own display.
 */
export function useCancelledScriptCards(
  subscribeChildTools: SubscribeChildTools,
  toolCalls: readonly TrackedToolCall[],
  addItem: UseHistoryManagerReturn['addItem'],
  markToolsAsDisplayCleared: MarkToolsAsDisplayClearedFn,
): void {
  const running = useRef(new Map<string, TrackedExecutingToolCall>());
  // Kept across resubscriptions, so a run outlives a change of subscriber.
  const runs = useRef(new Map<string, ToolScriptRunView>());
  const latest = useRef({ addItem, markToolsAsDisplayCleared });
  latest.current = { addItem, markToolsAsDisplayCleared };

  useEffect(() => {
    for (const call of toolCalls)
      if (call.request.name === SCRIPT_TOOL && call.status === 'executing')
        running.current.set(call.request.callId, call);
  }, [toolCalls]);

  useEffect(
    () =>
      subscribeChildTools({
        onToolScriptEvent: (event) => {
          const current = runs.current.get(event.runId);
          // A run that started before this display subscribed has no card.
          if (event.phase !== 'started' && current === undefined) return;
          const run = applyToolScriptEvent(current, event);
          if (event.phase !== 'finished') {
            runs.current.set(event.runId, run);
            return;
          }
          runs.current.delete(event.runId);
          const call = running.current.get(run.parentCallId);
          running.current.delete(run.parentCallId);
          if (
            call === undefined ||
            event.errorCode !== 'CANCELLED' ||
            run.agentId !== DEFAULT_AGENT_ID
          )
            return;
          latest.current.addItem(
            mapToDisplay(cancelledCard(call, run)),
            Date.now(),
          );
          latest.current.markToolsAsDisplayCleared([call.request.callId]);
        },
      }),
    [subscribeChildTools],
  );
}
