/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { AcquisitionRelease } from '../lifecycle/acquisition-release.js';
import { WorkspaceToolCatalogOwner } from '../services/workspace-tool-catalog-owner.js';
import { RuntimePolicyOwner } from '../policy/policy-owner.js';
import { createMcpApprovalPolicy } from '../policy/mcp-approval.js';
import { initializeParser } from '../utils/shell-parser.js';
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

export function installLspToolCatalog(): (
  config: Config,
  lsp: WorkspaceLspOwner,
) => Promise<WorkspaceToolCatalogOwner> {
  const releases: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of releases.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'LSP tool fixture cleanup failed');
  });
  return async (config, lsp) => {
    const journal = new AcquisitionRelease();
    const close = (): Promise<void> => journal.rollback();
    releases.push(close);
    try {
      const policy = new RuntimePolicyOwner(config);
      journal.acquire('policy', () => policy.dispose());
      const catalog = new WorkspaceToolCatalogOwner(
        config,
        policy.session.messageBus,
        policy.trust,
      );
      journal.acquire('files', () => catalog.dispose());
      journal.acquire('files', () => lsp.dispose());
      await initializeParser();
      await catalog.initialize();
      const approval = createMcpApprovalPolicy(
        { ...policy.session.decisions, ...policy.session.confirmation },
        async () => {},
        () => {},
      );
      await lsp.initialize(catalog.publication, approval);
      return catalog;
    } catch (primary) {
      releases.splice(releases.indexOf(close), 1);
      try {
        await close();
      } catch (cleanup) {
        throw new AggregateError(
          [primary, cleanup],
          'Fixture initialization cleanup failed',
        );
      }
      throw primary;
    }
  };
}
