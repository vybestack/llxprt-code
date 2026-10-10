/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';

import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import {
  listenCutoverFixtureServer,
  startCutoverFixtureServer,
} from './helpers/mcp-cutover-server-fixture.js';

import { describe, expect, it, vi } from 'bun:test';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { fromConfig } from '../fromConfig.js';
import { Config } from '@vybestack/llxprt-code-core';

describe('explicit MCP construction ownership', () => {
  it('requires a retained handle when the caller requests MCP ownership', async () => {
    const config = new Config({
      sessionId: 'missing-mcp-owner',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test-model',
    });
    await expect(
      Reflect.apply(fromConfig, undefined, [
        {
          ...createSessionSettingsFixture(config),
          config,
          mcpOwnership: 'caller',
        },
      ]),
    ).rejects.toThrow('Caller-owned MCP requires an explicit runtime handoff');
    expect(config.hasInitializationStarted()).toBe(false);
  });

  it('retains failed root initialization and rejects a mismatched adoption bus without poisoning an independent root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-retained-owner-'));
    await mkdir(join(directory, '.agents', 'skills', 'handoff'), {
      recursive: true,
    });
    await writeFile(
      join(directory, '.agents', 'skills', 'handoff', 'SKILL.md'),
      '---\nname: handoff\ndescription: retained handoff skill\n---\nOwned workspace instructions',
    );
    const config = new Config({
      sessionId: 'mcp-owner-handoff',
      skillsSupport: true,
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'test-model',
    });
    const first = await McpRuntimeOwner.create(
      createTestOAuthBinding(),
      config,
    );
    const second = await McpRuntimeOwner.create(
      createTestOAuthBinding(),
      config,
      first.messageBus,
      undefined,
      undefined,
      undefined,
      first.policyOwner,
    );
    const primary = new Error('IDE acquisition failed');
    const acquisition = vi
      .spyOn(IdeClient, 'create')
      .mockRejectedValue(primary);
    const initialization = first.initialize();
    const observedFailure = initialization.catch((error: unknown) => error);
    const rootPromises = new Set([initialization, first.initialize()]);
    expect(rootPromises.size).toBe(1);
    const failure = await observedFailure;
    acquisition.mockRestore();
    expect(failure).toBe(primary);
    expect(await first.initialize().catch((error: unknown) => error)).toBe(
      failure,
    );
    await expect(
      fromConfig({
        ...createSessionSettingsFixture(config),
        config,
        mcpRuntime: first,
        messageBus: new MessageBus(),
      }),
    ).rejects.toThrow(
      'MCP runtime handoff must retain its Config and MessageBus',
    );
    expect(config.hasInitializationStarted()).toBe(false);
    await second.initialize();
    expect(second.isStopped()).toBe(false);
    expect(second.trust).toBe(first.trust);
    expect(second.messageBus).toBe(first.messageBus);
    expect(second.toolSelection.getAllToolNames()).toContain('activate_skill');
    const published = second.toolSelection.getTool('activate_skill');
    if (!published)
      throw new Error('Independent root did not publish its skill tool');
    const activation = await published
      .build({ name: 'handoff' })
      .execute(new AbortController().signal);
    expect(activation.llmContent).toContain('Owned workspace instructions');
    expect(first.isStopped()).toBe(false);
    await second.dispose();
    await expect(first.dispose()).rejects.toThrow(
      'Workspace runtime cleanup failed',
    );
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  it('retains initialization and requires the owner when adopting initialized state', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      expect(built.mcpRuntime).toBeInstanceOf(McpRuntimeOwner);
      expect(built.mcpRuntime.initialize()).toBe(built.mcpRuntime.initialize());
      await expect(
        fromConfig({
          settingsOwner: built.settingsOwner,
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          config: built.config,
        }),
      ).rejects.toThrow('MCP runtime handoff');
      await expect(
        Reflect.apply(fromConfig, undefined, [
          {
            settingsOwner: built.settingsOwner,
            settingsService: built.settingsService,
            agentClient: built.agentClient,
            providerManager: built.providerManager,
            config: built.config,
            mcpOwnership: 'caller',
          },
        ]),
      ).rejects.toThrow(
        'Caller-owned MCP requires an explicit runtime handoff',
      );
      const agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: built.messageBus,
      });
      await agent.dispose();
      expect(built.mcpRuntime.isStopped()).toBe(false);
    } finally {
      await built.mcpRuntime.dispose();
      await built.config.dispose();
      await built.cleanup();
    }
  });

  it('borrows the original credential and browser owner for manual reconnect', async () => {
    const fixture = startCutoverFixtureServer('http', () => 1);
    await listenCutoverFixtureServer(fixture);
    const binding = createTestOAuthBinding();
    const browsers: string[] = [];
    let built: Awaited<ReturnType<typeof buildCliStyleConfig>> | undefined;
    try {
      built = await buildCliStyleConfig('plain-text.jsonl', {
        folderTrust: true,
        mcpServers: {
          same: {
            url: `${fixture.base}/mcp`,
            type: 'http',
            oauth: {
              enabled: false,
              authorizationUrl: `${fixture.base}/authorize`,
              tokenUrl: `${fixture.base}/token`,
              registrationUrl: `${fixture.base}/register`,
            },
          },
        },
        mcpTokenStorage: binding.tokenStorage,
        mcpHost: {
          openBrowser: async (value) => {
            browsers.push(value);
            const url = new URL(value);
            url.searchParams.set('owner', 'borrower');
            const response = await fetch(url);
            await response.text();
          },
        },
      });
      await built.mcpRuntime.awaitDiscovery();
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
        expect(browsers).toHaveLength(0);
        await agent.mcp.authenticate('same');
        expect(browsers).toHaveLength(1);
        expect(
          (await binding.tokenStorage.getCredentials('same'))?.token
            .accessToken,
        ).toBe('borrower');
        expect(fixture.traffic).toContain('Bearer borrower');
      } finally {
        await agent.dispose();
      }
      expect(built.mcpRuntime.isStopped()).toBe(false);
    } finally {
      await built?.cleanup();
      await built?.config.dispose();
      fixture.server.closeAllConnections();
      await new Promise<void>((resolve) =>
        fixture.server.close(() => resolve()),
      );
    }
  });
});
