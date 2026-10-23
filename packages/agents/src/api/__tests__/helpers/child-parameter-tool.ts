import { fixtureAgentResources } from './agent-resource-capture.js';
import { createTestChildOrchestrator } from '../../../core/__tests__/child-launch-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type {
  ProfileDefinitionReads,
  SubagentDefinitionReads,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
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
    readTaskPolicy,

    readGovernance,
    messageBus: fixtureAgentResources(agent).messageBus,
    toolRegistry: fixtureAgentResources(agent).publishedClient(agent).tools,

    launchChild: (request, signal) =>
      ((messageBus) =>
        createTestChildOrchestrator({
          credentialAuthority: new CredentialAuthority(),
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
          toolRegistry:
            fixtureAgentResources(agent).publishedClient(agent).tools,
        }))(fixtureAgentResources(agent).messageBus).launch(request, signal),
  });
}
