/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@vybestack/llxprt-code-core';
import { initializeTestConfig } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from '../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import {
  startCatalogFixture,
  waitForFixtureFile,
} from '../../../agents/src/api/__tests__/helpers/workspace-catalog-http-fixture.js';
import { buildSlashCommandRuntime } from '../ui/cliUiRuntime.js';
import { createMockCommandContext } from '../__tests__/mockCommandContext.js';
import { renderHook, waitFor } from '../__tests__/render.js';
import { useTestHarnessForAtCompletion } from '../ui/hooks/__tests__/useAtCompletion-test-helpers.js';
import { McpPromptLoader } from './McpPromptLoader.js';

async function openWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), 'cli-mcp-catalog-'));
  const server = await startCatalogFixture(directory);
  const built = await buildCliStyleConfig('plain-text.jsonl', {
    workingDir: directory,
    folderTrust: true,
    mcpServers: { physical: { httpUrl: server.url, trust: true } },
    telemetry: { enabled: false },
    recording: { enabled: false },
  });
  await built.mcpRuntime.awaitDiscovery();
  const agent = await fromConfig({
    settingsService: built.settingsService,
    config: built.config,
    agentClient: built.agentClient,
    providerManager: built.providerManager,
    mcpRuntime: built.mcpRuntime,
  });
  return {
    directory,
    built,
    agent,
    runtime: buildSlashCommandRuntime(built.config, agent),
    close: async (): Promise<void> => {
      server.release();
      await agent.dispose();
      await built.cleanup();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('production CLI workspace MCP consumers', () => {
  it('loads and invokes physical prompts through the same root as public Agent details', async () => {
    const fixture = await openWorkspace();
    try {
      const details = await fixture.agent.mcp.details({ includePrompts: true });
      const commands = await new McpPromptLoader(fixture.runtime).loadCommands(
        new AbortController().signal,
      );
      expect(commands.map((command) => command.name)).toStrictEqual(
        details.servers
          .flatMap((server) => server.prompts ?? [])
          .map((prompt) => prompt.name),
      );
      const command = commands.find(
        (candidate) => candidate.name === 'quantity',
      );
      if (!command?.action) throw new Error('Missing physical CLI prompt');
      await writeFile(join(fixture.directory, 'quantity'), '13');
      expect(
        await command.action(createMockCommandContext(), ''),
      ).toMatchObject({
        type: 'submit_prompt',
        content: JSON.stringify('Quantity squared is 169'),
      });
      await fixture.agent.mcp.refresh('physical');
      expect(
        await command.action(createMockCommandContext(), ''),
      ).toMatchObject({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('withdrawn'),
      });
      const refreshed = await new McpPromptLoader(fixture.runtime).loadCommands(
        new AbortController().signal,
      );
      expect(refreshed.map((candidate) => candidate.name)).toContain(
        'quantity',
      );
      await fixture.built.mcpRuntime.trust.setTrustedFolderLive(false);
      expect(
        await new McpPromptLoader(fixture.runtime).loadCommands(
          new AbortController().signal,
        ),
      ).toStrictEqual([]);
    } finally {
      await fixture.close();
    }
  }, 30000);

  it('forwards command cancellation to the physical prompt transport', async () => {
    const fixture = await openWorkspace();
    try {
      const commands = await new McpPromptLoader(fixture.runtime).loadCommands(
        new AbortController().signal,
      );
      const command = commands.find(
        (candidate) => candidate.name === 'quantity',
      );
      if (!command?.action) throw new Error('Missing physical CLI prompt');
      const controller = new AbortController();
      const pending = command.action(
        createMockCommandContext({ signal: controller.signal }),
        '--hold=yes',
      );
      expect(await waitForFixtureFile(join(fixture.directory, 'entered'))).toBe(
        'prompts/get',
      );
      controller.abort(new Error('CLI command cancelled'));
      expect(await pending).toMatchObject({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('CLI command cancelled'),
      });
      await waitFor(async () =>
        expect(
          await readFile(join(fixture.directory, 'requests'), 'utf8'),
        ).toContain('notifications/cancelled'),
      );
    } finally {
      await fixture.close();
    }
  }, 30000);

  it('keeps same-label CLI roots independent across sibling facade disposal', async () => {
    const first = await openWorkspace();
    const second = await openWorkspace();
    try {
      await writeFile(join(second.directory, 'quantity'), '23');
      const commands = await new McpPromptLoader(second.runtime).loadCommands(
        new AbortController().signal,
      );
      const command = commands.find(
        (candidate) => candidate.name === 'quantity',
      );
      if (!command?.action) throw new Error('Missing sibling CLI prompt');
      await first.agent.dispose();
      await first.built.mcpRuntime.dispose();
      expect(
        await command.action(createMockCommandContext(), ''),
      ).toMatchObject({
        type: 'submit_prompt',
        content: JSON.stringify('Quantity squared is 529'),
      });
      const identity = second.agent.mcp.findResource(
        'physical:fixture:///quantity',
      );
      expect(
        second.runtime
          .listResources()
          .find((resource) => resource.uri === identity?.uri),
      ).toBe(identity);
    } finally {
      await first.close();
      await second.close();
    }
  }, 30000);

  it('retains a real fixture root whose resource transport is its exact manager', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cli-fixture-catalog-'));
    const server = await startCatalogFixture(directory);
    const config = new Config({
      sessionId: 'catalog-fixture',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'fixture',
      folderTrust: true,
      mcpServers: { physical: { httpUrl: server.url, trust: true } },
      telemetry: { enabled: false },
    });
    const root = await initializeTestConfig(config);
    try {
      await waitFor(() =>
        expect(
          root.catalogOwner.resourceSelection
            .listResources()
            .map((resource) => resource.uri),
        ).toContain('fixture:///quantity'),
      );
      await writeFile(join(directory, 'quantity'), '29');
      expect(
        await root.catalogOwner.resourceSelection.readResource(
          'physical',
          'fixture:///quantity',
        ),
      ).toMatchObject({ contents: [{ text: '29' }] });
      const prompt = root.catalogOwner.promptSelection
        .listPrompts('physical')
        .find((candidate) => candidate.name === 'quantity');
      if (!prompt) throw new Error('Fixture manager did not publish a prompt');
      expect((await prompt.invoke({})).messages[0].content).toMatchObject({
        text: 'Quantity squared is 841',
      });
      await root.dispose();
      await expect(prompt.invoke({})).rejects.toThrow('stopped');
    } finally {
      server.release();
      await root.dispose();
      await config.dispose();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);

  it('completes physical resource identities and reads through the public Agent workspace', async () => {
    const fixture = await openWorkspace();
    const view = renderHook(() =>
      useTestHarnessForAtCompletion(
        true,
        'physical:fixture',
        fixture.runtime,
        fixture.directory,
      ),
    );
    try {
      await waitFor(() =>
        expect(
          view.result.current.suggestions.map((suggestion) => suggestion.value),
        ).toContain('physical:fixture:///quantity'),
      );
      const resource = fixture.agent.mcp.findResource(
        'physical:fixture:///quantity',
      );
      if (!resource) throw new Error('Missing public resource identity');
      await writeFile(join(fixture.directory, 'quantity'), '19');
      expect(
        await fixture.agent.mcp.readResource(resource.serverName, resource.uri),
      ).toMatchObject({ contents: [{ text: '19' }] });
    } finally {
      view.unmount();
      await fixture.close();
    }
  }, 30000);
});
