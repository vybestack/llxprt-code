/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LiveOutputUpdate } from '@vybestack/llxprt-code-tools';
import { createStreamNormalizer } from '@vybestack/llxprt-code-tools/utils/textDelta.js';
import type { SubAgentScope } from '../core/subagent.js';
import type { startTaskHeartbeat, TaskHeartbeat } from './taskHeartbeat.js';

/**
 * Result of {@link setupTaskStreaming}: the closing-tag emitter (flushes the
 * stream normalizer and emits `</subagent>`), plus the liveness heartbeat
 * handle whose lifecycle is tied to the streaming session.
 */
export interface TaskStreamingHandle {
  emitClosingSubagentTag: () => void;
  heartbeat: TaskHeartbeat;
}

/**
 * Wires the public live-output stream for a synchronous Task: emits the
 * opening `<subagent>` tag, installs the `scope.onMessage` relay (which
 * forwards normalized deltas and resets the heartbeat on real progress), and
 * starts the periodic liveness heartbeat (issue #2540).
 *
 * The heartbeat emits typed `status` snapshots distinct from content:
 * `accumulateLiveOutput` ignores them, the subagent message channel skips
 * them, and the public AgentToolInvocation adapter does not forward them as
 * text. Real progress resets heartbeat timing so the next quiet window
 * (not the just-arrived message) schedules the next heartbeat.
 *
 * Returns a no-op-shaped handle when no `updateOutput` observer is supplied
 * (the heartbeat start helper already short-circuits in that case).
 */
export function setupTaskStreaming(
  subagentName: string,
  agentId: string,
  scope: SubAgentScope,
  updateOutput: ((update: LiveOutputUpdate) => void) | undefined,
  startHeartbeat: typeof startTaskHeartbeat,
): TaskStreamingHandle {
  let xmlOutputOpen = false;
  const normalizer = createStreamNormalizer();
  const emitAppend = (data: string): void => {
    updateOutput?.({ mode: 'append', data });
  };
  const emitClosingSubagentTag = (): void => {
    if (!xmlOutputOpen) {
      return;
    }
    const flushed = normalizer.flush();
    if (flushed !== undefined) {
      emitAppend(flushed);
    }
    emitAppend(`</subagent name="${subagentName}" id="${agentId}">\n`);
    xmlOutputOpen = false;
  };

  if (updateOutput) {
    emitAppend(`<subagent name="${subagentName}" id="${agentId}">\n`);
    xmlOutputOpen = true;

    const existingHandler = scope.onMessage;
    scope.onMessage = (message: string) => {
      heartbeat.reset();
      const delta = normalizer.push(message);
      if (delta !== undefined) {
        emitAppend(delta);
      }
      existingHandler?.(message);
    };
  }

  // Start the heartbeat AFTER stream initialization so an exception during
  // opening-tag emission cannot leave a running timer with no handle to
  // stop it.
  const heartbeat = startHeartbeat(updateOutput);

  return { emitClosingSubagentTag, heartbeat };
}
