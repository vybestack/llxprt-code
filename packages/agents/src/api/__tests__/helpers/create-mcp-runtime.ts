/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpClientManager } from '@vybestack/llxprt-code-mcp';
import { defaultFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import {
  defaultWorkspaceOwnership,
  type McpRuntimeAcquisition,
  type McpRuntimeOperations,
} from '../../mcp-runtime-construction.js';

export type McpRuntimeTestAcquisition = Partial<
  Omit<McpRuntimeAcquisition, 'oauth' | 'config'>
> &
  Pick<McpRuntimeAcquisition, 'oauth' | 'config'>;

export type McpRuntimeTestOperations = Partial<McpRuntimeOperations>;

/**
 * The only test code that knows the shape of `McpRuntimeOwner.create`.
 * An omitted member takes the value the constructor applied before every
 * member became a required key.
 */
export function createTestMcpRuntime(
  acquisition: McpRuntimeTestAcquisition,
  operations: McpRuntimeTestOperations,
): Promise<McpRuntimeOwner> {
  const { managerFactory = McpClientManager } = acquisition;
  return McpRuntimeOwner.create(
    {
      oauth: acquisition.oauth,
      config: acquisition.config,
      managerFactory,
      extensionLoader: acquisition.extensionLoader,
      policy: acquisition.policy,
      lspOwner: acquisition.lspOwner,
      lspOwnership:
        acquisition.lspOwnership ??
        defaultWorkspaceOwnership(acquisition.lspOwner),
      filesystemOwner: acquisition.filesystemOwner,
      filesystemOwnership:
        acquisition.filesystemOwnership ??
        defaultWorkspaceOwnership(acquisition.filesystemOwner),
      filesystemService: acquisition.filesystemService,
      memoryOwner: acquisition.memoryOwner,
      definitionOwner: acquisition.definitionOwner,
      definitionOwnership:
        acquisition.definitionOwnership ??
        defaultWorkspaceOwnership(acquisition.definitionOwner),
      trustPort: acquisition.trustPort,
      trustCleanup: acquisition.trustCleanup,
      idePort: acquisition.idePort,
    },
    {
      emitFeedback: operations.emitFeedback ?? defaultFeedbackSink,
      skillOperations: operations.skillOperations,
      mcpSettings: operations.mcpSettings,
    },
  );
}
