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
    sessionOverrides: _sessionOverrides,
    oauthSettings: _oauthSettings,
    providerContributions: _providerContributions,
    parentTrustPort,
    onApproval,
    onOAuthPrompt,
    mcpHost: hostInput,
    mcpTokenStorage,
    lspOwner,
    lspOwnership,
    definitionOwner,
    definitionOwnership,
    memoryOwner,
    executeShellCommand: _executeShellCommand,
    filesystemService: _filesystemService,
    filesystemOwner,
    filesystemOwnership,
    editorCallbacks,
    toolSchedulerFactory,
    tokenizerFactory: _tokenizerFactory,
    contentGeneratorFactory: _contentGeneratorFactory,
    tokenStore,
    credentialAuthority: _credentialAuthority,
    mediaOwner: suppliedMediaOwner,
    ...validatable
  } = rawConfig;
  validateHostTransports(_filesystemService, _executeShellCommand);
  if (parentTrustPort !== undefined && trustPort !== undefined)
    throw new Error('Agent cannot combine borrowed and inherited trust');
  if (
    _filesystemService !== undefined &&
    (filesystemOwner !== undefined || filesystemOwnership === 'caller')
  )
    throw new Error(
      'Filesystem transport requires an Agent-owned workspace root',
    );
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
    tokenStore,
    suppliedMediaOwner,
  };
}

export function agentMcpAssemblyOptions(
  raw: AgentConfig,
  construction: ReturnType<typeof parseAgentConstruction>,
  trustPort: AgentConfig['trustPort'],
): McpAssemblyOptions &
  Pick<AgentConfig, 'imageOperation' | 'credentialAuthority'> {
  return {
    imageOperation: raw.imageOperation,
    credentialAuthority: raw.credentialAuthority,
    trustPort,
    idePort: raw.idePort,
    mcpHost: { ...construction.hostInput },
    mcpTokenStorage: construction.mcpTokenStorage,
    lspOwner: construction.lspOwner,
    lspOwnership: construction.lspOwnership,
    definitionOwner: raw.definitionOwner,
    definitionOwnership: raw.definitionOwnership,
    memoryOwner: construction.memoryOwner,
    filesystemService: raw.filesystemService,
    filesystemOwner: construction.filesystemOwner,
    filesystemOwnership: construction.filesystemOwnership,
  };
}

function validateHostTransports(filesystem: unknown, shell: unknown): void {
  if (shell !== undefined && typeof shell !== 'function')
    throw new Error(
      'Invalid host transport: shell execution must be a function',
    );
  if (filesystem !== undefined && !isFilesystemTransport(filesystem))
    throw new Error(
      'Invalid host transport: filesystem requires text read and write operations',
    );
}

function isFilesystemTransport(
  value: unknown,
): value is NonNullable<AgentConfig['filesystemService']> {
  if (typeof value !== 'object' || value === null) return false;
  if (!('readTextFile' in value) || !('writeTextFile' in value)) return false;
  return (
    typeof value.readTextFile === 'function' &&
    typeof value.writeTextFile === 'function'
  );
}
