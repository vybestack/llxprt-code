/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';

export type TaskRuntime = Pick<
  Agent,
  'stream' | 'injectSteer' | 'getModel' | 'getProvider' | 'listTools'
> & {
  listMcpServers: Agent['mcp']['listServers'];
  respondToConfirmation: Agent['tools']['respondToConfirmation'];
};

export function createTaskRuntime(agent: Agent): TaskRuntime {
  return {
    stream: (input, options) => agent.stream(input, options),
    injectSteer: (text) => agent.injectSteer(text),
    getModel: () => agent.getModel(),
    getProvider: () => agent.getProvider(),
    listTools: () => agent.listTools(),
    listMcpServers: () => agent.mcp.listServers(),
    respondToConfirmation: (id, decision, payload, requiresConfirmation) =>
      agent.tools.respondToConfirmation(
        id,
        decision,
        payload,
        requiresConfirmation,
      ),
  };
}
