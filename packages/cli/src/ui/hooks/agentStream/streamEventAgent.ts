/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';

export type StreamEventAgent = Pick<
  Agent,
  | 'getProviderContextLimit'
  | 'getProvider'
  | 'getModel'
  | 'getCurrentSequenceModel'
  | 'getActiveProfileName'
> & {
  readonly tools: Pick<Agent['tools'], 'get'>;
  readonly mcp: Pick<Agent['mcp'], 'findResource' | 'readResource'>;
};

export function createStreamEventAgent(
  agent: StreamEventAgent,
): StreamEventAgent {
  return {
    getProviderContextLimit: () => agent.getProviderContextLimit(),
    getProvider: () => agent.getProvider(),
    getModel: () => agent.getModel(),
    getCurrentSequenceModel: () => agent.getCurrentSequenceModel(),
    getActiveProfileName: () => agent.getActiveProfileName(),
    tools: { get: (name) => agent.tools.get(name) },
    mcp: {
      findResource: (identifier) => agent.mcp.findResource(identifier),
      readResource: (server, uri) => agent.mcp.readResource(server, uri),
    },
  };
}
