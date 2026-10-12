/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  WorkspaceTrustControlPort,
  ProfileDefinitionReads,
  SubagentDefinitionReads,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { SubagentOrchestrator } from '../../../core/subagentOrchestrator.js';
import { TaskTool } from '../../../tools/task.js';

export function createObservedChildTask(
  agent: Agent,
  foregroundConfig: Config,
  subagents: Pick<SubagentDefinitionReads, 'loadSubagent' | 'listSubagents'>,
  profiles: Pick<ProfileDefinitionReads, 'loadProfile'>,
  observeSettings: (settings: SettingsService) => void,
  workspacePaths: WorkspacePathOperations,
  instructions: InstructionReadOperations,
  readMcpInstructions: () => string | undefined,
  settingsOwner: SessionSettingsOwner,
  workspaceTrust: WorkspaceTrustControlPort,
): TaskTool {
  const createChildSettings = (): SettingsService => {
    const child = settingsOwner.createChildStore();
    observeSettings(child);
    return child;
  };
  const readTaskPolicy = () => settingsOwner.readTaskPolicy();
  const readRunPolicy = () => settingsOwner.readSubagentRunPolicy();
  const readGovernance = () =>
    settingsOwner.readToolGovernance(foregroundConfig.getExcludeTools() ?? []);
  return new TaskTool(foregroundConfig, {
    instructions,
    workspaceTrust,
    createChildSettings,
    readTaskPolicy,
    readRunPolicy,
    readGovernance,
    messageBus: agent.getMessageBus(),
    toolRegistry: agent.agentClient.tools,
    workspacePaths,
    readMcpInstructions,
    orchestratorFactory: (messageBus) =>
      new SubagentOrchestrator({
        instructions,
        workspaceTrust,
        subagentManager: subagents,
        profileManager: profiles,
        foregroundConfig,
        createChildSettings,
        readRunPolicy,
        workspacePaths,
        readMcpInstructions,
        messageBus,
        toolRegistry: agent.agentClient.tools,
      }),
  });
}
