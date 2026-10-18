/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createAgent } from '@vybestack/llxprt-code-agents';

import type { ExecutionEventBus } from '@a2a-js/sdk/server';
import type { AgentSettings } from '../types.js';
import {
  createTaskAgentConfig,
  loadEnvironment,
  setTargetDir,
} from '../config/config.js';
import { loadSettings } from '../config/settings.js';
import { loadExtensions } from '../config/extension.js';
import { Task } from './task.js';

export async function acquireTaskSession(
  taskId: string,
  contextId: string,
  agentSettings: AgentSettings,
  eventBus: ExecutionEventBus | undefined,
): Promise<Task> {
  const workspaceRoot = setTargetDir(agentSettings);
  loadEnvironment();
  const settings = loadSettings(workspaceRoot);
  const extensions = loadExtensions(workspaceRoot, {
    folderTrust: settings.folderTrust,
  });
  const agent = await createAgent(
    createTaskAgentConfig(settings, extensions, taskId),
  );
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
    eventBus,
    agentSettings.autoExecute,
  );
}
