/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { McpConstructionResources } from './mcp-construction-resources.js';

export function assembleMcpFilesystem(
  config: Config,
  supplied: WorkspaceFilesystemOwner | undefined,
  ownership: 'runtime' | 'caller',
  resources: McpConstructionResources,
  trust: WorkspaceTrustControlPort,
): { filesystem: WorkspaceFilesystemOwner; unsubscribe: () => void } {
  if (ownership === 'caller' && supplied === undefined)
    throw new Error(
      'Caller-owned filesystem requires an explicit workspace root',
    );
  const filesystem =
    supplied ??
    new WorkspaceFilesystemOwner({
      targetDir: config.getTargetDir(),
      customExcludes: config.customExcludes,
      includeDirectories: config.getConfiguredIncludeDirectories(),
      isTrusted: () => trust.isTrustedFolder(),
    });
  if (ownership === 'runtime') resources.retain(() => filesystem.dispose());
  const unsubscribe = trust.subscribeTrustChange(() =>
    filesystem.notifyTrustChanged(),
  );
  resources.retain(unsubscribe);
  return { filesystem, unsubscribe };
}
