import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCleanupSteps } from '../../../agents/src/core/subagent-cleanup.js';

import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { createTestMcpRuntime } from '../../../agents/src/api/__tests__/helpers/create-mcp-runtime.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from '../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { openWorkspaceCatalogAgent } from '../../../agents/src/api/__tests__/helpers/workspace-catalog-agent.js';
import { type Agent } from '@vybestack/llxprt-code-agents';
import {
  startCatalogFixture,
  waitForFixtureFile,
} from '../../../agents/src/api/__tests__/helpers/workspace-catalog-http-fixture.js';
import { buildSlashCommandRuntimeForTest } from '../__tests__/slash-command-runtime-fixture.js';
import { createMockCommandContext } from '../__tests__/mockCommandContext.js';
import { renderHook, waitFor } from '../__tests__/render.js';
import { useTestHarnessForAtCompletion } from '../ui/hooks/__tests__/useAtCompletion-test-helpers.js';
import { McpPromptLoader } from './McpPromptLoader.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('production CLI workspace MCP consumers', () => {
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
  const builtCredentials = useOwnedCredentials();
  let workspaceDirectory: string;
  let workspaceAgent: Agent;
  let workspaceCommands: ReturnType<typeof buildSlashCommandRuntimeForTest>;
  let setWorkspaceTrustedFolder: (trusted: boolean) => Promise<void>;
  let closeWorkspace: () => Promise<void>;
  async function openWorkspace(): Promise<void> {
    const catalog = await openWorkspaceCatalogAgent({
      authority: builtCredentials().authority,
    });
    const { agent, catalogDirectory } = catalog;
    const declarations = new Config({
      sessionId: randomUUID(),
      targetDir: catalogDirectory,
      cwd: catalogDirectory,
      debugMode: false,
      model: 'fake-model',
      folderTrust: true,
      telemetry: { enabled: false },
    });
    workspaceDirectory = catalogDirectory;
    workspaceAgent = agent;
    workspaceCommands = buildSlashCommandRuntimeForTest(declarations, agent);
    setWorkspaceTrustedFolder = (trusted) =>
      agent.ide.setTrustedFolderLive(trusted);
    let closing: Promise<void> | undefined;
    closeWorkspace = () =>
      (closing ??= runCleanupSteps([
        () => catalog.closeCatalog(),
        () => declarations.dispose(),
      ]));
  }

  it('loads and invokes physical prompts through the same root as public Agent details', async () => {
    await openWorkspace();
    try {
      const details = await workspaceAgent.mcp.details({
        includePrompts: true,
      });
      const commands = await new McpPromptLoader(
        workspaceCommands,
      ).loadCommands(new AbortController().signal);
      expect(commands.map((command) => command.name)).toStrictEqual(
        details.servers
          .flatMap((server) => server.prompts ?? [])
          .map((prompt) => prompt.name),
      );
      const command = commands.find(
        (candidate) => candidate.name === 'quantity',
      );
      if (!command?.action) throw new Error('Missing physical CLI prompt');
      await writeFile(join(workspaceDirectory, 'quantity'), '13');
      expect(
        await command.action(createMockCommandContext(), ''),
      ).toMatchObject({
        type: 'submit_prompt',
        content: JSON.stringify('Quantity squared is 169'),
      });
      await workspaceAgent.mcp.refresh('physical');
      expect(
        await command.action(createMockCommandContext(), ''),
      ).toMatchObject({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('withdrawn'),
      });
      const refreshed = await new McpPromptLoader(
        workspaceCommands,
      ).loadCommands(new AbortController().signal);
      expect(refreshed.map((candidate) => candidate.name)).toContain(
        'quantity',
      );
      await setWorkspaceTrustedFolder(false);
      expect(
        await new McpPromptLoader(workspaceCommands).loadCommands(
          new AbortController().signal,
        ),
      ).toStrictEqual([]);
    } finally {
      await closeWorkspace();
    }
  }, 30000);

  it('forwards command cancellation to the physical prompt transport', async () => {
    await openWorkspace();
    try {
      const commands = await new McpPromptLoader(
        workspaceCommands,
      ).loadCommands(new AbortController().signal);
      const command = commands.find(
        (candidate) => candidate.name === 'quantity',
      );
      if (!command?.action) throw new Error('Missing physical CLI prompt');
      const controller = new AbortController();
      const pending = command.action(
        createMockCommandContext({ signal: controller.signal }),
        '--hold=yes',
      );
      expect(
        await waitForFixtureFile(join(workspaceDirectory, 'entered')),
      ).toBe('prompts/get');
      controller.abort(new Error('CLI command cancelled'));
      expect(await pending).toMatchObject({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('CLI command cancelled'),
      });
      await waitFor(async () =>
        expect(
          await readFile(join(workspaceDirectory, 'requests'), 'utf8'),
        ).toContain('notifications/cancelled'),
      );
    } finally {
      await closeWorkspace();
    }
  }, 30000);

  it('keeps same-label CLI roots independent across sibling facade disposal', async () => {
    await openWorkspace();
    const firstAgent = workspaceAgent;
    const closeFirst = closeWorkspace;
    await openWorkspace();
    try {
      await writeFile(join(workspaceDirectory, 'quantity'), '23');
      const commands = await new McpPromptLoader(
        workspaceCommands,
      ).loadCommands(new AbortController().signal);
      const command = commands.find(
        (candidate) => candidate.name === 'quantity',
      );
      if (!command?.action) throw new Error('Missing sibling CLI prompt');
      await firstAgent.dispose();
      expect(
        await command.action(createMockCommandContext(), ''),
      ).toMatchObject({
        type: 'submit_prompt',
        content: JSON.stringify('Quantity squared is 529'),
      });
      const identity = workspaceAgent.mcp.findResource(
        'physical:fixture:///quantity',
      );
      expect(
        workspaceCommands
          .listResources()
          .find((resource) => resource.uri === identity?.uri),
      ).toBe(identity);
    } finally {
      await closeFirst();
      await closeWorkspace();
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
    const root = await createTestMcpRuntime(
      { oauth: createTestOAuthBinding(), config },
      {},
    );
    try {
      await root.initialize();
      await waitFor(() =>
        expect(root.listResources().map((resource) => resource.uri)).toContain(
          'fixture:///quantity',
        ),
      );
      await writeFile(join(directory, 'quantity'), '29');
      expect(
        await root.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '29' }] });
      const prompt = root
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
    await openWorkspace();
    const view = renderHook(() =>
      useTestHarnessForAtCompletion(
        true,
        'physical:fixture',
        workspaceCommands,
        workspaceDirectory,
      ),
    );
    try {
      await waitFor(() =>
        expect(
          view.result.current.suggestions.map((suggestion) => suggestion.value),
        ).toContain('physical:fixture:///quantity'),
      );
      const resource = workspaceAgent.mcp.findResource(
        'physical:fixture:///quantity',
      );
      if (!resource) throw new Error('Missing public resource identity');
      await writeFile(join(workspaceDirectory, 'quantity'), '19');
      expect(
        await workspaceAgent.mcp.readResource(
          resource.serverName,
          resource.uri,
        ),
      ).toMatchObject({ contents: [{ text: '19' }] });
    } finally {
      view.unmount();
      await closeWorkspace();
    }
  }, 30000);
});
