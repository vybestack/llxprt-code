#!/usr/bin/env bun

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
import {
  ACTIVATE_MCP_SERVER_TOOL_NAME,
  ToolRegistry,
  type CallableTool,
} from '@vybestack/llxprt-code-tools';
import { syncActivateMcpServerTool } from '../packages/core/src/config/mcp-lazy-tool-sync.ts';
import { isErrnoException, messageOf } from './utils/error-guards.ts';

const SERVER_NAME = 'coherence-server';
const COMPILED_CHECK_TIMEOUT_MS = 120_000;

function createCallableTool(): CallableTool {
  return {
    async tool() {
      return {};
    },
    async callTool() {
      return [];
    },
  };
}

function createMessageBus() {
  return {
    async requestConfirmation() {
      return true;
    },
  };
}

export async function verifySourceLazyMcpCoherence(): Promise<void> {
  const messageBus = createMessageBus();
  const registry = new ToolRegistry(
    {
      getEphemeralSettings: () => ({ 'mcp.lazy': true }),
    },
    messageBus,
  );
  registry.registerTool(
    new DiscoveredMCPTool(
      createCallableTool(),
      SERVER_NAME,
      'fixture-tool',
      'Build coherence fixture',
      { type: 'object' },
    ),
  );

  const deferredBeforeActivation = registry.listDeferredMcpServers();
  if (
    deferredBeforeActivation.length !== 1 ||
    deferredBeforeActivation[0] !== SERVER_NAME
  ) {
    throw new Error(
      `Source registry did not defer ${SERVER_NAME}: ${JSON.stringify(deferredBeforeActivation)}`,
    );
  }

  await syncActivateMcpServerTool(registry, messageBus, async () => undefined);
  if (registry.getTool(ACTIVATE_MCP_SERVER_TOOL_NAME) === undefined) {
    throw new Error(
      'Source lazy-MCP synchronization did not register its tool',
    );
  }

  registry.activateMcpServer(SERVER_NAME);
  await syncActivateMcpServerTool(registry, messageBus, async () => undefined);
  if (registry.getTool(ACTIVATE_MCP_SERVER_TOOL_NAME) !== undefined) {
    throw new Error(
      'Source lazy-MCP synchronization left a stale activation tool',
    );
  }
}

export function verifyCompiledLazyMcpCoherence(
  repoRoot: string,
  timeoutMs = COMPILED_CHECK_TIMEOUT_MS,
): void {
  const syncModuleUrl = pathToFileURL(
    resolve(repoRoot, 'packages/core/dist/src/config/mcp-lazy-tool-sync.js'),
  ).href;
  const program = `
    import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
    import {
      ACTIVATE_MCP_SERVER_TOOL_NAME,
      ToolRegistry,
    } from '@vybestack/llxprt-code-tools';
    import { syncActivateMcpServerTool } from ${JSON.stringify(syncModuleUrl)};

    const serverName = ${JSON.stringify(SERVER_NAME)};
    const messageBus = { async requestConfirmation() { return true; } };
    const registry = new ToolRegistry(
      { getEphemeralSettings: () => ({ 'mcp.lazy': true }) },
      messageBus,
    );
    registry.registerTool(new DiscoveredMCPTool(
      { async tool() { return {}; }, async callTool() { return []; } },
      serverName,
      'fixture-tool',
      'Build coherence fixture',
      { type: 'object' },
    ));

    const deferred = registry.listDeferredMcpServers();
    if (deferred.length !== 1 || deferred[0] !== serverName) {
      throw new Error(
        'Compiled registry did not defer ' + serverName + ': ' +
        JSON.stringify(deferred),
      );
    }
    await syncActivateMcpServerTool(registry, messageBus, async () => undefined);
    if (registry.getTool(ACTIVATE_MCP_SERVER_TOOL_NAME) === undefined) {
      throw new Error('Compiled lazy-MCP synchronization did not register its tool');
    }
    registry.activateMcpServer(serverName);
    await syncActivateMcpServerTool(registry, messageBus, async () => undefined);
    if (registry.getTool(ACTIVATE_MCP_SERVER_TOOL_NAME) !== undefined) {
      throw new Error('Compiled lazy-MCP synchronization left a stale activation tool');
    }
  `;

  const result = spawnSync('node', ['--input-type=module', '--eval', program], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (result.error !== undefined) {
    const signal = result.signal ?? 'none';
    if (isErrnoException(result.error, 'ETIMEDOUT')) {
      throw new Error(
        `Compiled lazy-MCP coherence check timed out after ${timeoutMs} ms (signal ${signal})`,
        { cause: result.error },
      );
    }
    throw new Error(
      `Failed to start compiled lazy-MCP coherence check: ${messageOf(result.error)} (signal ${signal})`,
      { cause: result.error },
    );
  }
  if (result.signal !== null) {
    throw new Error(
      `Compiled lazy-MCP coherence check was terminated by signal ${result.signal}`,
    );
  }
  if (result.status === null) {
    throw new Error(
      'Compiled lazy-MCP coherence check exited without a status code',
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Compiled lazy-MCP coherence check failed (${result.status}):\n${result.stderr}`,
    );
  }
}

export async function verifyLazyMcpBuildCoherence(
  repoRoot = process.cwd(),
): Promise<void> {
  await verifySourceLazyMcpCoherence();
  verifyCompiledLazyMcpCoherence(repoRoot);
}

if (import.meta.main) {
  await verifyLazyMcpBuildCoherence();
  console.log('Verified source and compiled lazy-MCP registry coherence.');
}
