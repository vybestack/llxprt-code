/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type { WorkspaceTrustReadPort } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { McpConstructionResources } from './mcp-construction-resources.js';
import type { McpOwnerHandoff } from './mcp-runtime-construction.js';

export function composeMcpLsp(
  resources: McpConstructionResources,
  config: Config,
  handoff: McpOwnerHandoff<WorkspaceLspOwner>,
  trust: WorkspaceTrustReadPort,
): WorkspaceLspOwner {
  if (handoff.kind === 'supplied') return handoff.owner;
  const owner = new WorkspaceLspOwner(
    config.getLspConfig(),
    config.getTargetDir(),
    () => trust.isTrustedFolder(),
  );
  resources.retain(() => owner.dispose());
  return owner;
}
