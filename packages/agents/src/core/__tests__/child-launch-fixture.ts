/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { InteractiveAuthPromptOperation } from '@vybestack/llxprt-code-core/runtime/contracts/InteractiveAuthPrompt.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type {
  WorkspaceTrustControlPort,
  ProfileDefinitionReads,
  SubagentDefinitionReads,
  AgentRuntimeFactoryBindings,
} from '@vybestack/llxprt-code-core';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentRunPolicy } from '@vybestack/llxprt-code-core/session/session-settings-policies.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ChildAgentAssembly } from '../../api/child-agent-assembly.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { SubAgentScope } from '../subagent.js';

export interface TestChildLaunchOptions {
  readonly credentialAuthority?: CredentialAuthority;
  readonly requestInteractiveAuth?: InteractiveAuthPromptOperation;
  instructions: InstructionReadOperations;
  toolRegistry?: ToolSelection;
  readMcpInstructions: () => string | undefined;
  workspacePaths: WorkspacePathOperations;
  subagentManager: Pick<
    SubagentDefinitionReads,
    'loadSubagent' | 'listSubagents'
  >;
  profileManager: Pick<ProfileDefinitionReads, 'loadProfile'>;
  foregroundConfig: Config;
  readonly hookOwner?: SessionHookOwner;
  readonly workspaceTrust?: WorkspaceTrustControlPort;
  createChildSettings: () => SettingsService;
  readonly telemetry?: RootTelemetry;
  readRunPolicy: () => SubagentRunPolicy;
  runtimeFactoryBindings?: AgentRuntimeFactoryBindings;
  runtimeLoader?: typeof loadAgentRuntime;
  scopeFactory?: typeof SubAgentScope.create;
  idFactory?: () => string;
  messageBus: MessageBus;
}

export function createTestChildOrchestrator(
  options: TestChildLaunchOptions,
): SubagentOrchestrator {
  return new SubagentOrchestrator({
    sessionId: options.foregroundConfig.getSessionId(),
    profileManager: options.profileManager,
    subagentManager: options.subagentManager,
    readRunPolicy: options.readRunPolicy,
    idFactory: options.idFactory,
    assembleChild: (data) => {
      const authority = options.credentialAuthority;
      if (authority === undefined)
        throw new Error(
          'Child assembly requires captured credential authority',
        );
      return new ChildAgentAssembly(
        data,
        authority,
        options.messageBus,
        options.requestInteractiveAuth,
        options.profileManager,
        options.subagentManager,
        options.telemetry,
        options.createChildSettings,
        options.foregroundConfig,
        options.instructions,
        options.workspacePaths,
        options.readMcpInstructions,
        options.workspaceTrust,
        options.toolRegistry,
        options.hookOwner,
        options.runtimeFactoryBindings?.agentClientFactory,
        options.runtimeLoader ?? loadAgentRuntime,
        options.scopeFactory ?? SubAgentScope.create.bind(SubAgentScope),
      ).assemble();
    },
  });
}
