/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { UseAgentEventStreamArgs } from '../../useAgentEventStream.js';

export type AgentStreamOperations = Pick<
  UseAgentEventStreamArgs,
  'stream' | 'setDisplayCallbacks' | 'setEditorCallbacks'
>;

/**
 * Binds the three Agent operations useAgentEventStream consumes. The hook's
 * registration effect is keyed on the operations' identity, so callers must
 * build this once per agent (outside renderHook callbacks, or memoized inside
 * a hook body) and pass the same references on every render. The operations
 * resolve the agent member at call time so tests may replace members on the
 * agent after creating the bindings.
 */
export function agentStreamOperations(agent: Agent): AgentStreamOperations {
  return {
    stream: (input, options) => agent.stream(input, options),
    setDisplayCallbacks: (callbacks) =>
      agent.tools.setDisplayCallbacks(callbacks),
    setEditorCallbacks: (callbacks) =>
      agent.tools.setEditorCallbacks(callbacks),
  };
}
