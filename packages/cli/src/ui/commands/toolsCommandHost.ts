/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { ToolsCommandOperations } from './toolsCommand.js';

export function bindToolsCommand(
  agent: Agent | null,
): ToolsCommandOperations | null {
  if (agent === null) return null;

  return {
    listTools: () => agent.tools.list(),
    readSetting: (key) => agent.getEphemeralSetting(key),
    writeSetting: (key, value) => agent.setEphemeralSetting(key, value),
    refreshToolSchema: () => agent.agentClient.setTools(),
  };
}
