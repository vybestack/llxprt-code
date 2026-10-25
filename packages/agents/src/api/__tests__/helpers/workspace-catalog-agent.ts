/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';
import type { Agent } from '../../agent.js';
import { createAgent } from '../../createAgent.js';
import { awaitMcpDiscoveryReady } from './mcp-discovery-ready.js';
import {
  startCatalogFixture,
  type PhysicalCatalogFixture,
} from './workspace-catalog-http-fixture.js';

export interface WorkspaceCatalogAgent {
  readonly agent: Agent;
  /** The workspace directory the catalog server reads and writes. */
  readonly catalogDirectory: string;
  readonly server: PhysicalCatalogFixture;
  /** Releases held server requests, then closes the agent and the server. */
  readonly closeCatalog: () => Promise<void>;
}

/**
 * One `createAgent` root whose workspace holds the physical HTTP catalog
 * server's files, with MCP discovery settled. Route A and B build their MCP
 * runtime over the OS keychain, which has no test input, so the catalog
 * scenarios use `createAgent` with the public `mcpTokenStorage` input. Call
 * `useFakeResponsesReplay` in the enclosing `describe`.
 */
export async function openWorkspaceCatalogAgent(options: {
  readonly authority: CredentialAuthority;
  readonly serverNames?: readonly string[];
}): Promise<WorkspaceCatalogAgent> {
  const catalogDirectory = await realpath(
    await mkdtemp(join(tmpdir(), 'workspace-catalog-')),
  );
  const server = await startCatalogFixture(catalogDirectory);
  const serverNames = options.serverNames ?? ['physical'];
  let agent: Agent | undefined;
  const closeCatalog = async (): Promise<void> => {
    server.release();
    await runCleanupSteps([
      () => agent?.dispose(),
      () => server.stop(),
      () => rm(catalogDirectory, { recursive: true, force: true }),
    ]);
  };
  try {
    agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: catalogDirectory,
      interactive: true,
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpServers: Object.fromEntries(
        serverNames.map((name) => [name, { httpUrl: server.url, trust: true }]),
      ),
      mcpTokenStorage: createTestOAuthBinding().tokenStorage,
      credentialAuthority: options.authority,
    });
    await awaitMcpDiscoveryReady(agent);
  } catch (primary) {
    return cleanupAfterFailure(primary, closeCatalog);
  }
  return { agent, catalogDirectory, server, closeCatalog };
}
