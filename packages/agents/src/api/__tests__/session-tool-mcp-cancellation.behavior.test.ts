/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import {
  startCatalogFixture,
  waitForFixtureFile,
} from './helpers/workspace-catalog-http-fixture.js';

async function runCancellation(closeOwner: boolean): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'physical-tool-cancel-'));
  const server = await startCatalogFixture(directory);
  const built = await buildCliStyleConfig('plain-text.jsonl', {
    workingDir: directory,
    folderTrust: true,
    telemetry: { enabled: false },
    recording: { enabled: false },
    mcpServers: { physical: { httpUrl: server.url, trust: true } },
  });
  const agent = await fromConfig({
    settingsOwner: built.settingsOwner,
    settingsService: built.settingsService,
    config: built.config,
    providerManager: built.providerManager,
    mcpRuntime: built.mcpRuntime,
  });
  const controller = new AbortController();
  try {
    await built.mcpRuntime.awaitDiscovery();
    const declaration = agent.tools
      .list()
      .find((tool) => tool.serverToolName === 'multiply');
    if (declaration === undefined)
      throw new Error('Missing actual MCP declaration');
    const tool = agent.agentClient.tools.getTool(declaration.name);
    if (tool === undefined) throw new Error('Missing actual MCP capability');
    const operation = tool.build({ factor: 99 }).execute(controller.signal);
    const settled = operation.then(
      () => undefined,
      (error: unknown) => error,
    );
    await waitForFixtureFile(join(directory, 'tool-entered'));
    if (closeOwner) {
      await agent.dispose();
    } else {
      controller.abort(new Error('Caller cancelled physical multiplication'));
    }
    expect(await settled).toBeInstanceOf(Error);
    await waitForFixtureFile(join(directory, 'tool-cancelled'));
    const requests = (
      await readFile(join(directory, 'requests'), 'utf8')
    ).split('\n');
    expect(requests.filter((method) => method === 'tools/call')).toHaveLength(
      1,
    );
    expect(
      requests.filter((method) => method === 'notifications/cancelled'),
    ).toHaveLength(1);
    await expect(readFile(join(directory, 'product'), 'utf8')).rejects.toThrow(
      'ENOENT',
    );
    if (closeOwner) {
      await expect(
        tool.validateBuildAndExecute(
          { factor: 2 },
          new AbortController().signal,
        ),
      ).rejects.toThrow('closed');
    }
  } finally {
    server.release();
    await agent.dispose();
    await built.cleanup();
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('physical MCP tool cancellation', () => {
  it('forwards caller cancellation into the actual MCP JSON-RPC work', async () => {
    await expect(runCancellation(false)).resolves.toBeUndefined();
  });
  it('forwards session closure into the actual MCP JSON-RPC work and withdraws retained dispatch', async () => {
    await expect(runCancellation(true)).resolves.toBeUndefined();
  });
});
