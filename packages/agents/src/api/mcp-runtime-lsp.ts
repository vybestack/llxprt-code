/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type { WorkspaceTrustReadPort } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { McpConstructionResources } from './mcp-construction-resources.js';

export function composeMcpLsp(
  resources: McpConstructionResources,
  config: Config,
  supplied: WorkspaceLspOwner | undefined,
  ownership: 'runtime' | 'caller',
  trust: WorkspaceTrustReadPort,
): WorkspaceLspOwner {
  const owner =
    supplied ??
    new WorkspaceLspOwner(config.getLspConfig(), config.getTargetDir(), () =>
      trust.isTrustedFolder(),
    );
  if (ownership === 'runtime') resources.retain(() => owner.dispose());
  return owner;
}
