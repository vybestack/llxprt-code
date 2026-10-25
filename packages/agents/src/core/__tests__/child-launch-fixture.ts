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
import { afterEach } from 'bun:test';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentRunPolicy } from '@vybestack/llxprt-code-core/session/session-settings-policies.js';
import {
  loadAgentRuntime,
  type ToolSelectedRuntimeLoader,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { buildAgentClientFactory } from '../../api/agentBootstrap.js';
import { ChildAgentAssembly } from '../../api/child-agent-assembly.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { SubAgentScope } from '../subagent.js';
import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';

let hookRoots: readonly SessionHookOwner[] = [];
afterEach(async () => {
  const retiring = hookRoots;
  hookRoots = [];
  await Promise.all(retiring.map((root) => root.dispose()));
});

export interface TestChildLaunchOptions {
  readonly credentialAuthority: CredentialAuthority;
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
  runtimeLoader?: ToolSelectedRuntimeLoader;
  scopeFactory?: typeof SubAgentScope.create;
  idFactory?: () => string;
  messageBus: MessageBus;
}

export function createTestChildOrchestrator(
  options: TestChildLaunchOptions,
): SubagentOrchestrator {
  const tools = options.toolRegistry;
  const suppliedOwners =
    options.telemetry !== undefined && options.workspaceTrust !== undefined;
  const sessionSettings = suppliedOwners
    ? undefined
    : createSessionSettingsFixture(options.foregroundConfig);
  const trust = options.workspaceTrust ?? sessionSettings?.workspaceTrust;
  const telemetry =
    options.telemetry ?? sessionSettings?.settingsOwner.telemetry;
  if (trust === undefined || telemetry === undefined)
    throw new Error('Child launch fixture could not construct its owners');
  const hooks =
    options.hookOwner ??
    new SessionHookOwner(
      readHookDefinitions(options.foregroundConfig),
      hookSessionRuntime(options.foregroundConfig, trust, telemetry),
      options.foregroundConfig.getEnableHooks(),
      options.messageBus,
    );
  if (options.hookOwner === undefined) hookRoots = [...hookRoots, hooks];
  return new SubagentOrchestrator({
    sessionId: options.foregroundConfig.getSessionId(),
    profileManager: options.profileManager,
    subagentManager: options.subagentManager,
    readRunPolicy: options.readRunPolicy,
    idFactory: options.idFactory,
    assembleChild: (data) => {
      if (tools === undefined)
        throw new Error(
          'Child launch fixture requires an explicit toolRegistry',
        );
      return new ChildAgentAssembly(
        data,
        {
          authority: options.credentialAuthority,
          createChildSettings: options.createChildSettings,
          foregroundConfig: options.foregroundConfig,
        },
        {
          runtimeLoader: options.runtimeLoader ?? loadAgentRuntime,
          scopeFactory:
            options.scopeFactory ?? SubAgentScope.create.bind(SubAgentScope),
        },
        options.runtimeFactoryBindings?.agentClientFactory ??
          buildAgentClientFactory(),
        {
          messageBus: options.messageBus,
          requestInteractiveAuth: options.requestInteractiveAuth,
          profileReads: options.profileManager,
          subagentReads: options.subagentManager,
          telemetry,
          instructions: options.instructions,
          workspacePaths: options.workspacePaths,
          readMcpInstructions: options.readMcpInstructions,
          trust,
          tools,
          hooks,
        },
      ).assemble();
    },
  });
}
