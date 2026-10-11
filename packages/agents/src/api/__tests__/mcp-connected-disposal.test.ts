/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { get } from 'node:http';
import { buildAgent } from './helpers/agentHarness.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { fromConfig } from '../fromConfig.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  return { promise, release };
}

async function authorize(authorization: string): Promise<void> {
  const url = new URL(authorization);
  const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
  callback.searchParams.set('state', url.searchParams.get('state') ?? '');
  callback.searchParams.set('code', 'connected-owner-code');
  await new Promise<void>((resolveRequest, reject) => {
    const request = get(callback, (response) => {
      response.resume();
      response.on('end', resolveRequest);
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

function serverConfig(evidence: string) {
  return {
    command: process.execPath,
    args: [
      resolveRepositoryFixture(
        import.meta.url,
        'scripts/tests/mcp-standalone-stdio-fixture.ts',
      ),
      evidence,
    ],
    oauth: {
      enabled: true,
      clientId: 'connected-owner',
      authorizationUrl: 'https://connected-owner.test/authorize',
      tokenUrl: 'https://connected-owner.test/token',
    },
  };
}

describe('connected MCP disposal', () => {
  let directory = '';
  const evidence = (): string => directory;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-connected-disposal-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('stops owned connected MCP before joining a manual authentication request', async () => {
    const entered = gate();
    const released = gate();
    const built = await buildAgent('plain-text.jsonl', {
      folderTrust: true,
      mcpServers: { local: serverConfig(evidence()) },
      mcpHost: { openBrowser: authorize },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    const readiness = [];
    for await (const event of built.agent.stream('unused', {
      signal: AbortSignal.abort(),
    })) {
      readiness.push(event);
    }
    expect(readiness).toStrictEqual([{ type: 'done', reason: 'aborted' }]);
    const network = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      entered.release();
      await released.promise;
      return new Response(null, { status: 401 });
    });
    let authentication: Promise<unknown> | undefined;
    let disposal: Promise<void> | undefined;
    try {
      expect(
        built.agent.agentClient.tools
          .getAllTools()
          .filter(
            (tool) => 'serverName' in tool && tool.serverName === 'local',
          ),
      ).toHaveLength(1);
      authentication = built.agent.mcp
        .authenticate('local')
        .catch((error: unknown) => error);
      await Promise.race([
        entered.promise,
        authentication.then(() => {
          throw new Error('Authentication did not reach token request');
        }),
      ]);
      disposal = built.agent.dispose();
      expect(built.agent.dispose()).toBe(disposal);
      expect(() => built.agent.agentClient.tools.getAllTools()).toThrow(
        'closed',
      );
      released.release();
      expect(await authentication).toHaveProperty('name', 'AbortError');
      await disposal;
    } finally {
      released.release();
      await authentication;
      await disposal;
      await built.cleanup();
      network.mockRestore();
    }
  }, 30000);

  it('adopts one connected catalog and leaves its transport usable after facade disposal', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      folderTrust: true,
      mcpServers: { local: serverConfig(evidence()) },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    await built.mcpRuntime.awaitDiscovery();
    const catalog = built.mcpRuntime.toolSelection;
    const prompt = built.mcpRuntime.listPrompts('local')[0];
    const before = await readFile(join(evidence(), 'requests'), 'utf8');
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      messageBus: built.messageBus,
    });
    try {
      expect(agent.getMessageBus()).toBe(built.messageBus);
      expect(new Set([built.mcpRuntime.toolSelection, catalog]).size).toBe(1);
      expect(
        before.split('\n').filter((line) => line === 'tools/list'),
      ).toHaveLength(1);
      expect(await readFile(join(evidence(), 'requests'), 'utf8')).toBe(before);
      await agent.dispose();
      expect(
        catalog
          .getAllTools()
          .filter(
            (tool) => 'serverName' in tool && tool.serverName === 'local',
          ),
      ).toHaveLength(1);
      const result = await prompt.invoke({ value: 'seven' });
      expect(result.messages[0]?.content).toMatchObject({
        text: 'Explain seven',
      });
      expect(await readFile(join(evidence(), 'requests'), 'utf8')).toBe(
        `${before}prompts/get\n`,
      );
    } finally {
      await agent.dispose();
      await built.config.dispose();
      await built.cleanup();
    }
  }, 30000);
});
