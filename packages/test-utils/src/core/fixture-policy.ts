/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpClientManager } from '@vybestack/llxprt-code-mcp';
import { WorkspaceMcpCatalogOwner } from '@vybestack/llxprt-code-core';
import { createMcpApprovalPolicy } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { persistPolicyToToml } from '@vybestack/llxprt-code-core/policy/config.js';
import type { ConfigInitializationDependencies } from '@vybestack/llxprt-code-core/config/configTypes.js';

export function fixtureApprovalPolicy(policyOwner: {
  readonly session: {
    readonly decisions: Pick<
      Parameters<typeof createMcpApprovalPolicy>[0],
      'evaluate'
    >;
    readonly confirmation: Pick<
      Parameters<typeof createMcpApprovalPolicy>[0],
      'addRule'
    >;
  };
}): NonNullable<ConfigInitializationDependencies['mcpApprovalPolicy']> {
  return createMcpApprovalPolicy(
    { ...policyOwner.session.decisions, ...policyOwner.session.confirmation },
    persistPolicyToToml,
    () => {},
  );
}

export function buildFixtureCatalogOwner(
  config: { isTrustedFolder(): boolean },
  manager: () => McpClientManager,
): WorkspaceMcpCatalogOwner {
  return new WorkspaceMcpCatalogOwner(
    () => config.isTrustedFolder(),
    (server, uri, signal) => {
      const client = manager().getClient(server);
      if (!client) throw new Error(`MCP server ${server} is unavailable`);
      return client.readResource(uri, signal);
    },
  );
}
