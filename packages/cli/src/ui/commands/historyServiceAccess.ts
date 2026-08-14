/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared access to the live HistoryService from a slash command.
 *
 * Commands cannot reach the history service directly: it hangs off the agent
 * client, which does not exist before a session starts even though the declared
 * types say otherwise. This module holds the single honest accessor so each new
 * command does not re-derive the same nullish guards.
 */

import type {
  ChronologyTraceEntry,
  IContent,
} from '@vybestack/llxprt-code-core';
import type { CommandContext } from './types.js';

/**
 * Structural view of the members commands consume. Declared structurally rather
 * than importing the class so the CLI does not depend on core's concrete
 * HistoryService type.
 */
export interface HistoryServiceView {
  getAll: () => unknown;
  getChronologyTrace: () => readonly ChronologyTraceEntry[];
  getRawHistory: () => readonly IContent[];
}

type AgentClientWithHistory = {
  getHistoryService?: () => HistoryServiceView | null;
};

type ConfigWithMaybeAgentClient = NonNullable<
  CommandContext['services']['config']
> & {
  getAgentClient: () => AgentClientWithHistory | null | undefined;
};

function hasCallableGetAgentClient(
  config: CommandContext['services']['config'],
): config is ConfigWithMaybeAgentClient {
  return typeof config?.getAgentClient === 'function';
}

/**
 * Resolves the live history service, or null when no session is established.
 *
 * The declared agent-client type is non-null, but at runtime it is absent
 * before a session starts. The result is deliberately re-typed as nullable so
 * the guards here are meaningful rather than dead code.
 */
export function getHistoryServiceFromConfig(
  config: CommandContext['services']['config'],
): HistoryServiceView | null {
  if (!hasCallableGetAgentClient(config)) {
    return null;
  }
  const agentClient = config.getAgentClient() as
    | AgentClientWithHistory
    | null
    | undefined;
  if (
    agentClient === null ||
    agentClient === undefined ||
    typeof agentClient.getHistoryService !== 'function'
  ) {
    return null;
  }
  return agentClient.getHistoryService();
}
