/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LspServiceClient } from '@vybestack/llxprt-code-ide-integration';
import type {
  AnyDeclarativeTool,
  ToolSelection,
} from '@vybestack/llxprt-code-tools';
import type { WorkspaceTrustReadPort } from '../services/workspace-trust-reader.js';
import type { Config } from '../config/config.js';
import { WorkspaceLspOwner } from '../lsp/workspace-lsp-owner.js';

export function createLspFixture(
  config: Config,
  trust: WorkspaceTrustReadPort,
): {
  readonly lspService: LspServiceClient | undefined;
  readonly lspRoot: WorkspaceLspOwner;
} {
  const settings = config.getLspConfig();
  const lspService =
    settings === undefined
      ? undefined
      : new LspServiceClient(settings, config.getTargetDir());
  const lspRoot = new WorkspaceLspOwner(
    settings,
    config.getTargetDir(),
    () => trust.isTrustedFolder(),
    lspService,
    'runtime',
  );
  return { lspService, lspRoot };
}

export function getRegisteredLspNavigationTools(
  selection: Pick<ToolSelection, 'getAllTools'>,
): Array<AnyDeclarativeTool & { serverName: string }> {
  const tools = selection
    .getAllTools()
    .filter(
      (tool): tool is AnyDeclarativeTool & { serverName: string } =>
        'serverName' in tool && tool.serverName === 'lsp-navigation',
    );
  if (tools.length === 0) {
    throw new Error('LSP navigation tools are not registered yet');
  }
  return tools;
}
