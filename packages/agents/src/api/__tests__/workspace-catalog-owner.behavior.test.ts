/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCliStyleConfig,
  type BuiltCliConfig,
} from './helpers/buildCliStyleConfig.js';
import { fromConfig } from '../fromConfig.js';
import {
  startCatalogFixture,
  waitForFixtureFile,
  type PhysicalCatalogFixture,
} from './helpers/workspace-catalog-http-fixture.js';

interface CatalogAgentFixture {
  readonly directory: string;
  readonly server: PhysicalCatalogFixture;
  readonly built: BuiltCliConfig;
  close(): Promise<void>;
}

async function openFixture(
  serverNames: string[] = ['physical'],
): Promise<CatalogAgentFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-catalog-'));
  const server = await startCatalogFixture(directory);
  const built = await buildCliStyleConfig('plain-text.jsonl', {
    workingDir: directory,
    folderTrust: true,
    mcpServers: Object.fromEntries(
      serverNames.map((name) => [name, { httpUrl: server.url, trust: true }]),
    ),
    telemetry: { enabled: false },
    recording: { enabled: false },
  });
  await built.mcpRuntime.awaitDiscovery();
  return {
    directory,
    server,
    built,
    close: async (): Promise<void> => {
      server.release();
      await built.cleanup();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('workspace catalog ownership through public Agent operations', () => {
  it('withdraws physical prompt and resource declarations while trust is revoked', async () => {
    const fixture = await openFixture();
    const agent = await fromConfig({
      settingsOwner: fixture.built.settingsOwner,
      settingsService: fixture.built.settingsService,
      config: fixture.built.config,
      agentClient: fixture.built.agentClient,
      providerManager: fixture.built.providerManager,
      mcpRuntime: fixture.built.mcpRuntime,
    });
    try {
      const visible = await agent.mcp.details({
        includePrompts: true,
        includeResources: true,
      });
      expect(
        visible.servers
          .flatMap((server) => server.prompts ?? [])
          .map((prompt) => prompt.name),
      ).toContain('quantity');
      await fixture.built.mcpRuntime.trust.setTrustedFolderLive(false);
      const withdrawn = await agent.mcp.details({
        includePrompts: true,
        includeResources: true,
      });
      expect(
        withdrawn.servers.flatMap((server) => server.prompts ?? []),
      ).toStrictEqual([]);
      expect(
        withdrawn.servers.flatMap((server) => server.resources ?? []),
      ).toStrictEqual([]);
    } finally {
      await agent.dispose();
      await fixture.close();
    }
  }, 30000);

  it('keeps same-label physical workspace resources and prompts independent', async () => {
    const first = await openFixture();
    const second = await openFixture();
    try {
      await writeFile(join(second.directory, 'quantity'), '11');
      expect(
        await first.built.mcpRuntime.readResource(
          'physical',
          'fixture:///quantity',
        ),
      ).toMatchObject({ contents: [{ text: '7' }] });
      expect(
        await second.built.mcpRuntime.readResource(
          'physical',
          'fixture:///quantity',
        ),
      ).toMatchObject({ contents: [{ text: '11' }] });
      const firstPrompt = first.built.mcpRuntime
        .listPrompts('physical')
        .find((prompt) => prompt.name === 'quantity');
      const secondPrompt = second.built.mcpRuntime
        .listPrompts('physical')
        .find((prompt) => prompt.name === 'quantity');
      if (firstPrompt === undefined || secondPrompt === undefined)
        throw new Error('Missing independent physical prompts');
      expect((await firstPrompt.invoke({})).messages[0]?.content).toMatchObject(
        { text: 'Quantity squared is 49' },
      );
      expect(
        (await secondPrompt.invoke({})).messages[0]?.content,
      ).toMatchObject({ text: 'Quantity squared is 121' });
      await first.built.mcpRuntime.dispose();
      expect(
        await second.built.mcpRuntime.readResource(
          'physical',
          'fixture:///quantity',
        ),
      ).toMatchObject({ contents: [{ text: '11' }] });
      expect(
        (await secondPrompt.invoke({})).messages[0]?.content,
      ).toMatchObject({ text: 'Quantity squared is 121' });
    } finally {
      await first.close();
      await second.close();
    }
  }, 30000);

  it('refreshes a server without withdrawing a sibling with a shared label prefix', async () => {
    const fixture = await openFixture(['physical', 'physical:peer']);
    try {
      const sibling = fixture.built.mcpRuntime
        .listPrompts('physical:peer')
        .find((prompt) => prompt.serverName === 'physical:peer');
      if (!sibling)
        throw new Error('Sibling physical prompt was not published');
      await fixture.built.mcpRuntime.refresh('physical');
      expect((await sibling.invoke({})).messages[0]?.content).toMatchObject({
        text: 'Quantity squared is 49',
      });
      expect(
        fixture.built.mcpRuntime
          .listResources()
          .map((resource) => resource.serverName),
      ).toContain('physical:peer');
    } finally {
      await fixture.close();
    }
  }, 30000);

  it('projects physical tools, prompts and resources without locating catalogs through Config', async () => {
    const fixture = await openFixture();
    const agent = await fromConfig({
      settingsOwner: fixture.built.settingsOwner,
      settingsService: fixture.built.settingsService,
      config: fixture.built.config,
      agentClient: fixture.built.agentClient,
      providerManager: fixture.built.providerManager,
      mcpRuntime: fixture.built.mcpRuntime,
    });
    const forbidden = ['getPromptRegistry', 'getResourceRegistry'];
    for (const name of forbidden)
      Object.defineProperty(fixture.built.config, name, {
        configurable: true,
        value: (): never => {
          throw new Error('Config must not locate a workspace catalog');
        },
      });
    try {
      const detail = await agent.mcp.details({
        includeTools: true,
        includePrompts: true,
        includeResources: true,
      });
      expect(
        detail.servers[0]?.prompts?.map((prompt) => prompt.name),
      ).toContain('quantity');
      expect(
        detail.servers[0]?.resources?.map((resource) => resource.uri),
      ).toContain('fixture:///quantity');
      const tool = agent.tools
        .list()
        .find((candidate) => candidate.name.includes('multiply'));
      if (!tool) throw new Error('Physical MCP tool was not published');
      const handle = agent.tools.get(tool.name);
      if (!handle) throw new Error('Physical MCP tool was not selectable');
      await handle.buildAndExecute({ factor: 6 }, new AbortController().signal);
      expect(await readFile(join(fixture.directory, 'product'), 'utf8')).toBe(
        '42',
      );
      expect(
        await agent.mcp.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '7' }] });
      await agent.dispose();
      expect(
        await fixture.built.mcpRuntime.readResource(
          'physical',
          'fixture:///quantity',
        ),
      ).toMatchObject({ contents: [{ text: '7' }] });
      await fixture.built.mcpRuntime.trust.setTrustedFolderLive(false);
      expect(
        fixture.built.mcpRuntime.findResource('physical:fixture:///quantity'),
      ).toBeUndefined();
    } finally {
      for (const name of forbidden)
        Reflect.deleteProperty(fixture.built.config, name);
      await agent.dispose();
      await fixture.close();
    }
  }, 30000);

  it('cancels an admitted physical resource request when the workspace closes', async () => {
    const fixture = await openFixture();
    try {
      const work = fixture.built.mcpRuntime.readResource(
        'physical',
        'fixture:///held',
      );
      const outcome = work.then(
        () => 'fulfilled',
        () => 'rejected',
      );
      expect(await waitForFixtureFile(join(fixture.directory, 'entered'))).toBe(
        'resources/read',
      );
      const closing = fixture.built.mcpRuntime.dispose();
      await expect(
        fixture.built.mcpRuntime.readResource(
          'physical',
          'fixture:///quantity',
        ),
      ).rejects.toThrow('stopped');
      await closing;
      expect(await outcome).toBe('rejected');
      const requests = await readFile(
        join(fixture.directory, 'requests'),
        'utf8',
      );
      expect(requests.split('\n')).toContain('notifications/cancelled');
    } finally {
      await fixture.close();
    }
  }, 30000);

  it('cancels retained physical prompt invocation and denies reuse after root disposal', async () => {
    const fixture = await openFixture();
    try {
      const prompt = fixture.built.mcpRuntime
        .listPrompts('physical')
        .find((prompt) => prompt.serverName === 'physical');
      if (!prompt) throw new Error('Physical prompt was not published');
      expect((await prompt.invoke({})).messages[0]?.content).toMatchObject({
        text: 'Quantity squared is 49',
      });
      const outcome = prompt.invoke({ hold: 'yes' }).then(
        () => 'fulfilled',
        () => 'rejected',
      );
      expect(await waitForFixtureFile(join(fixture.directory, 'entered'))).toBe(
        'prompts/get',
      );
      await fixture.built.mcpRuntime.dispose();
      expect(await outcome).toBe('rejected');
      await expect(prompt.invoke({})).rejects.toThrow('stopped');
      expect(
        (await readFile(join(fixture.directory, 'requests'), 'utf8')).split(
          '\n',
        ),
      ).toContain('notifications/cancelled');
    } finally {
      await fixture.close();
    }
  }, 30000);

  it.each([0, 1])(
    'retains caller catalogs after borrowed facade disposal order %i',
    async (first) => {
      const fixture = await openFixture();
      const options = {
        settingsService: fixture.built.settingsService,
        config: fixture.built.config,
        agentClient: fixture.built.agentClient,
        providerManager: fixture.built.providerManager,
        mcpRuntime: fixture.built.mcpRuntime,
      };
      const facades = [await fromConfig(options), await fromConfig(options)];
      try {
        const prompt = fixture.built.mcpRuntime
          .listPrompts('physical')
          .find((prompt) => prompt.serverName === 'physical');
        if (!prompt) throw new Error('Physical prompt was not published');
        await facades[first].dispose();
        const other = facades[1 - first];
        expect(
          await other.mcp.readResource('physical', 'fixture:///quantity'),
        ).toMatchObject({ contents: [{ text: '7' }] });
        await other.dispose();
        expect((await prompt.invoke({})).messages[0]?.content).toMatchObject({
          text: 'Quantity squared is 49',
        });
        await expect(
          facades[first].mcp.readResource('physical', 'fixture:///quantity'),
        ).rejects.toThrow('closed');
        await fixture.built.mcpRuntime.refresh('physical');
        await expect(prompt.invoke({})).rejects.toThrow('withdrawn');
        expect(
          fixture.built.mcpRuntime
            .listPrompts('physical')
            .map((current) => current.name),
        ).toContain('quantity');
      } finally {
        for (const facade of facades) await facade.dispose();
        await fixture.close();
      }
    },
    30000,
  );
});
