/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpAssemblyOptions } from './mcpOAuthAssembly.js';
import type { ParsedAgentConfig } from './config-schema.js';
import type { AgentConfig } from './config-types.js';
import { AgentConfigSchema } from './config-schema.js';
import {
  resolveAuthType,
  generateRuntimeId,
  validateAgentRuntimeId,
} from './agentBootstrap.js';

export interface AgentConstructionInput {
  trustPort: AgentConfig['trustPort'];
  idePort: AgentConfig['idePort'];
  parsed: ParsedAgentConfig;
  resolvedAuth: ReturnType<typeof resolveAuthType>;
  runtimeId: string;
  hostInput: AgentConfig['mcpHost'];
  suppliedMediaOwner: AgentConfig['mediaOwner'];
  onApproval: AgentConfig['onApproval'];
  onOAuthPrompt: AgentConfig['onOAuthPrompt'];
  mcpTokenStorage: AgentConfig['mcpTokenStorage'];
  lspOwner: AgentConfig['lspOwner'];
  lspOwnership: AgentConfig['lspOwnership'];
  definitionOwner: AgentConfig['definitionOwner'];
  definitionOwnership: AgentConfig['definitionOwnership'];
  memoryOwner: AgentConfig['memoryOwner'];
  filesystemOwner: AgentConfig['filesystemOwner'];
  filesystemOwnership: AgentConfig['filesystemOwnership'];
  editorCallbacks: AgentConfig['editorCallbacks'];
  toolSchedulerFactory: AgentConfig['toolSchedulerFactory'];
  runtimeFactoryBindings: AgentConfig['runtimeFactoryBindings'];
  runtimeActivationBindings: AgentConfig['runtimeActivationBindings'];
  tokenStore: AgentConfig['tokenStore'];
}

export function parseAgentConstruction(
  rawConfig: AgentConfig,
): AgentConstructionInput {
  const {
    trustPort,
    idePort,
    githubBrokerClient: _githubBrokerClient,
    disposeGitHubBroker: _disposeGitHubBroker,
    imageOperation: _imageOperation,
    onApproval,
    onOAuthPrompt,
    mcpHost: hostInput,
    mcpTokenStorage,
    lspOwner,
    lspOwnership,
    definitionOwner,
    definitionOwnership,
    memoryOwner,
    filesystemOwner,
    filesystemOwnership,
    editorCallbacks,
    toolSchedulerFactory,
    runtimeFactoryBindings,
    runtimeActivationBindings,
    tokenStore,
    mediaOwner: suppliedMediaOwner,
    ...validatable
  } = rawConfig;
  const parsed = AgentConfigSchema.parse(validatable);
  const resolvedAuth = resolveAuthType(parsed.auth);
  const runtimeId = parsed.sessionId ?? generateRuntimeId();
  validateAgentRuntimeId(runtimeId);

  return {
    parsed,
    resolvedAuth,
    runtimeId,
    trustPort,
    idePort,
    onApproval,
    onOAuthPrompt,
    hostInput,
    mcpTokenStorage,
    lspOwner,
    lspOwnership,
    definitionOwner,
    definitionOwnership,
    memoryOwner,
    filesystemOwner,
    filesystemOwnership,
    editorCallbacks,
    toolSchedulerFactory,
    runtimeFactoryBindings,
    runtimeActivationBindings,
    tokenStore,
    suppliedMediaOwner,
  };
}

export function agentMcpAssemblyOptions(
  raw: AgentConfig,
  construction: ReturnType<typeof parseAgentConstruction>,
): McpAssemblyOptions & Pick<AgentConfig, 'imageOperation'> {
  return {
    imageOperation: raw.imageOperation,
    trustPort: raw.trustPort,
    idePort: raw.idePort,
    mcpHost: { ...construction.hostInput },
    mcpTokenStorage: construction.mcpTokenStorage,
    lspOwner: construction.lspOwner,
    lspOwnership: construction.lspOwnership,
    definitionOwner: raw.definitionOwner,
    definitionOwnership: raw.definitionOwnership,
    memoryOwner: construction.memoryOwner,
    filesystemOwner: construction.filesystemOwner,
    filesystemOwnership: construction.filesystemOwnership,
  };
}
