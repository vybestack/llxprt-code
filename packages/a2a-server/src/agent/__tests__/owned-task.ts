/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import { Task } from '../task.js';

export function createOwnedTask(
  taskId: string,
  contextId: string,
  agent: Agent,
): Task {
  return new Task(
    taskId,
    contextId,
    (input, options) => agent.stream(input, options),
    (text) => agent.injectSteer(text),
    () => agent.getModel(),
    () => agent.getProvider(),
    () => agent.listTools(),
    () => agent.mcp.listServers(),
    (id, decision, payload, requiresConfirmation) =>
      agent.tools.respondToConfirmation(
        id,
        decision,
        payload,
        requiresConfirmation,
      ),
    () => agent.dispose(),
  );
}
