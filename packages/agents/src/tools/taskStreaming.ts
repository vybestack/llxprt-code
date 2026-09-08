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
 * Escapes a string for use inside a double-quoted XML attribute value. The
 * ampersand MUST be replaced first so the entities produced for the other
 * characters are not re-escaped.
 */
function escapeXmlAttributeValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
 *
 * The subagent name and agent id are XML-attribute-escaped once at setup and
 * used in both wrapper tags, and the pre-existing `scope.onMessage` is
 * restored when the closing tag is emitted (issue #3288). Restoration runs
 * before any emission so a throwing `updateOutput` consumer cannot leave the
 * relay installed, and it only undoes this relay's own installation, so a
 * handler installed by anyone else survives the close.
 */
export function setupTaskStreaming(
  subagentName: string,
  agentId: string,
  scope: SubAgentScope,
  updateOutput: ((update: LiveOutputUpdate) => void) | undefined,
  startHeartbeat: typeof startTaskHeartbeat,
): TaskStreamingHandle {
  const escapedName = escapeXmlAttributeValue(subagentName);
  const escapedAgentId = escapeXmlAttributeValue(agentId);
  let xmlOutputOpen = false;
  let restoreScopeHandler: (() => void) | undefined;
  const normalizer = createStreamNormalizer();
  const emitAppend = (data: string): void => {
    updateOutput?.({ mode: 'append', data });
  };
  const emitClosingSubagentTag = (): void => {
    const wasOpen = xmlOutputOpen;
    xmlOutputOpen = false;
    const restore = restoreScopeHandler;
    restoreScopeHandler = undefined;
    restore?.();
    if (!wasOpen) {
      return;
    }
    const flushed = normalizer.flush();
    if (flushed !== undefined) {
      emitAppend(flushed);
    }
    emitAppend(`</subagent name="${escapedName}" id="${escapedAgentId}">\n`);
  };

  if (updateOutput) {
    emitAppend(`<subagent name="${escapedName}" id="${escapedAgentId}">\n`);
    xmlOutputOpen = true;

    const existingHandler = scope.onMessage;
    const relay = (message: string): void => {
      if (xmlOutputOpen) {
        heartbeat.reset();
        const delta = normalizer.push(message);
        if (delta !== undefined) {
          emitAppend(delta);
        }
      }
      existingHandler?.(message);
    };
    restoreScopeHandler = (): void => {
      // Only this relay's own installation is undone: a handler installed by
      // someone else while the task ran owns the slot and must survive close.
      if (scope.onMessage === relay) {
        scope.onMessage = existingHandler;
      }
    };
    scope.onMessage = relay;
  }

  // Start the heartbeat AFTER stream initialization so an exception during
  // opening-tag emission cannot leave a running timer with no handle to
  // stop it.
  const heartbeat = startHeartbeat(updateOutput);

  return { emitClosingSubagentTag, heartbeat };
}
