import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPDiscoveryState, McpClient } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { beforeAll, afterAll, describe, expect, it, spyOn } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { AgentConfig } from '../config-types.js';
import { fromConfig } from '../fromConfig.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { awaitMcpDiscoveryReady } from './helpers/mcp-discovery-ready.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('MCP Agent operations', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  async function openRuntimeOwner(overrides: Partial<AgentConfig>): Promise<{
    readonly mcp: McpRuntimeOwner;
    readonly close: () => Promise<void>;
  }> {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'mcp-runtime-owner-')),
    );
    const config = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        ...overrides,
        workingDir: directory,
      }),
      interactive: true,
    });
    const policy = new RuntimePolicyOwner(config);
    const mcp = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      overrides,
      undefined,
      policy,
    );
    const close = (): Promise<void> =>
      runCleanupSteps([
        () => mcp.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    try {
      await mcp.initialize();
    } catch (primary) {
      return cleanupAfterFailure(primary, close);
    }
    return { mcp, close };
  }

  it('joins configured discovery when disposing the retained MCP owner', async () => {
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolveEntered) => {
      signalEntered = resolveEntered;
    });
    let release!: () => void;
    const pending = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const connection = spyOn(McpClient.prototype, 'connect').mockImplementation(
      async () => {
        signalEntered();
        await pending;
      },
    );
    const owner = await openRuntimeOwner({
      folderTrust: true,
      mcpServers: {
        held: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
      },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    const { mcp } = owner;
    try {
      await entered;
      expect(mcp.status()?.discoveryState).toBe(MCPDiscoveryState.IN_PROGRESS);
      let disposed = false;
      const disposal = mcp.dispose().then(() => {
        disposed = true;
      });
      await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
      expect(disposed).toBe(false);
      release();
      await disposal;
      expect(mcp.isStopped()).toBe(true);
    } finally {
      release();
      connection.mockRestore();
      await owner.close();
    }
  }, 30000);

  it('uses retained MCP discovery and refresh for an adopted Agent without Config runtime delegates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-agent-operations-'));
    const workspace = await realpath(
      await mkdtemp(join(tmpdir(), 'mcp-agent-operations-workspace-')),
    );
    const config = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: workspace,
        interactive: true,
        folderTrust: true,
        mcpServers: {
          arithmetic: {
            command: process.execPath,
            args: [
              resolveRepositoryFixture(
                import.meta.url,
                'scripts/tests/mcp-standalone-stdio-fixture.ts',
              ),
              directory,
            ],
          },
        },
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
    );
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    const obsolete = [
      'getMcpRuntimeStatus',
      'refreshMcpServers',
      'awaitMcpDiscoveryGate',
      'getMcpClientManager',
    ];
    for (const name of obsolete) {
      Object.defineProperty(config, name, {
        configurable: true,
        value: () => {
          throw new Error(
            'Agent must not locate the MCP runtime through Config',
          );
        },
      });
    }
    const agent = await fromConfig(
      config,
      settings,
      { activation: { provider: 'fake', model: 'fake-model' } },
      credentials().authority,
    );
    try {
      await awaitMcpDiscoveryReady(agent);
      const controller = new AbortController();
      controller.abort();
      const events = [];
      for await (const event of agent.stream('unused', {
        signal: controller.signal,
      })) {
        events.push(event);
      }
      expect(events).toStrictEqual([{ type: 'done', reason: 'aborted' }]);
      expect(agent.mcp.discoveryState()).toBe('ready');
      Object.defineProperty(config, 'getResourceRegistry', {
        configurable: true,
        value: () => {
          throw new Error('Lookup must retain its original resource catalog');
        },
      });
      try {
        expect(
          agent.mcp.findResource('arithmetic:fixture:///arithmetic'),
        ).toMatchObject({
          serverName: 'arithmetic',
          uri: 'fixture:///arithmetic',
        });
        expect(
          agent.mcp.findResource('absent:fixture:///arithmetic'),
        ).toBeUndefined();
      } finally {
        Reflect.deleteProperty(config, 'getResourceRegistry');
      }
      expect(
        await agent.mcp.readResource('arithmetic', 'fixture:///arithmetic'),
      ).toMatchObject({
        contents: [{ text: 'Addition combines quantities.' }],
      });
      await expect(
        agent.mcp.readResource('absent', 'fixture:///arithmetic'),
      ).rejects.toThrow('not available');
      await agent.mcp.refresh('arithmetic');
      const requests = await readFile(join(directory, 'requests'), 'utf8');
      expect(
        requests.split('\n').filter((line) => line === 'tools/list'),
      ).toHaveLength(2);
      await agent.dispose();
      expect(() =>
        agent.mcp.findResource('arithmetic:fixture:///arithmetic'),
      ).toThrow('closed');
      await expect(
        agent.mcp.readResource('arithmetic', 'fixture:///arithmetic'),
      ).rejects.toThrow('closed');
    } finally {
      for (const name of obsolete) Reflect.deleteProperty(config, name);
      await runCleanupSteps([
        () => agent.dispose(),
        () => config.dispose(),
        () => rm(workspace, { recursive: true, force: true }),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }, 30000);
});
