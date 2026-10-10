/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceTrustReader } from '@vybestack/llxprt-code-core';

import { resolveSessionTargetDir } from './zed-session-config.js';

import type * as acp from '@agentclientprotocol/sdk';
import type { Config } from '@vybestack/llxprt-code-core';
import { StandardFileSystemService } from '@vybestack/llxprt-code-core';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { ClientCapabilitiesWithSession } from './acp-types.js';
import { AcpFileSystemService } from './fileSystemService.js';
import {
  createZedSessionConfig,
  type ZedHostInputs,
  type ZedSessionSelection,
} from './zed-session-agent.js';

export function createZedWorkspace(
  hostConfig: Config,
  hostInputs: ZedHostInputs,
  connection: acp.AgentSideConnection,
  capabilities: ClientCapabilitiesWithSession | undefined,
  sessionId: string,
  cwd: string | undefined,
  trust: WorkspaceTrustReader,
  selection: ZedSessionSelection,
) {
  const localFileSystemService = new StandardFileSystemService();
  const sessionFileSystemService = capabilities?.fs
    ? new AcpFileSystemService(
        connection,
        sessionId,
        capabilities.fs,
        localFileSystemService,
      )
    : localFileSystemService;
  const sessionConfig = createZedSessionConfig(
    hostConfig,
    sessionId,
    resolveSessionTargetDir(hostConfig, cwd),
    hostInputs,
    selection,
  );
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: sessionConfig.getTargetDir(),
    includeDirectories: sessionConfig.getConfiguredIncludeDirectories(),
    isTrusted: () => trust.isTrustedFolder(),
    ...(capabilities?.fs
      ? {
          fileSystem: {
            service: sessionFileSystemService,
            ownership: 'workspace',
          },
        }
      : {}),
  });
  return { sessionConfig, filesystem };
}
