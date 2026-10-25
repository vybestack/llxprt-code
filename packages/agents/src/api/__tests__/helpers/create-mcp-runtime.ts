/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  WorkspaceDefinitionOwner,
  WorkspaceIdePort,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { SessionMcpSettingsReads } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { FileSystemService } from '@vybestack/llxprt-code-core/services/fileSystemService.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import {
  McpClientManager,
  type McpOAuthBinding,
} from '@vybestack/llxprt-code-mcp';
import {
  defaultFeedbackSink,
  type HostFeedbackSink,
} from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import type { MemoryHandoff } from '../../mcpOAuthAssembly.js';
import { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { defaultWorkspaceOwnership } from '../../mcp-runtime-construction.js';

export interface McpPolicyHandoff {
  readonly owner: RuntimePolicyOwner;
  readonly ownership: 'runtime' | 'caller';
}

export interface McpRuntimeTestAcquisition {
  readonly oauth: McpOAuthBinding;
  readonly config: Config;
  readonly managerFactory?: typeof McpClientManager | undefined;
  readonly extensionLoader?: ExtensionLoader | undefined;
  readonly policy?: McpPolicyHandoff | undefined;
  readonly lspOwner?: WorkspaceLspOwner | undefined;
  readonly lspOwnership?: 'runtime' | 'caller' | undefined;
  readonly filesystemOwner?: WorkspaceFilesystemOwner | undefined;
  readonly filesystemOwnership?: 'runtime' | 'caller' | undefined;
  readonly filesystemService?: FileSystemService | undefined;
  readonly memoryOwner?: MemoryHandoff | undefined;
  readonly definitionOwner?: WorkspaceDefinitionOwner | undefined;
  readonly definitionOwnership?: 'runtime' | 'caller' | undefined;
  readonly trustPort?: WorkspaceTrustControlPort | undefined;
  readonly trustCleanup?: (() => Promise<void>) | undefined;
  readonly idePort?: WorkspaceIdePort | undefined;
}

export interface McpRuntimeTestOperations {
  readonly emitFeedback?: HostFeedbackSink | undefined;
  readonly skillOperations?: WorkspaceSkillAssemblyOperations | undefined;
  readonly mcpSettings?: SessionMcpSettingsReads | undefined;
}

/**
 * The only test code that knows the positional order of
 * `McpRuntimeOwner.create`. An omitted member takes the value the
 * constructor applies today when its position is missing.
 */
export function createTestMcpRuntime(
  acquisition: McpRuntimeTestAcquisition,
  operations: McpRuntimeTestOperations,
): Promise<McpRuntimeOwner> {
  const {
    policy,
    managerFactory = McpClientManager,
    lspOwnership = defaultWorkspaceOwnership(acquisition.lspOwner),
    filesystemOwnership = defaultWorkspaceOwnership(
      acquisition.filesystemOwner,
    ),
    definitionOwnership = defaultWorkspaceOwnership(
      acquisition.definitionOwner,
    ),
  } = acquisition;
  const { emitFeedback = defaultFeedbackSink } = operations;
  return McpRuntimeOwner.create(
    acquisition.oauth,
    acquisition.config,
    policy?.owner.session.messageBus,
    { emitFeedback },
    managerFactory,
    acquisition.extensionLoader,
    policy?.owner,
    policy?.ownership,
    acquisition.lspOwner,
    lspOwnership,
    acquisition.filesystemOwner,
    filesystemOwnership,
    acquisition.memoryOwner,
    acquisition.definitionOwner,
    definitionOwnership,
    acquisition.trustPort,
    acquisition.idePort,
    acquisition.trustCleanup,
    operations.skillOperations,
    operations.mcpSettings,
    acquisition.filesystemService,
  );
}
