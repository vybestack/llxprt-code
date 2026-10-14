import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { randomUUID } from 'node:crypto';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { cleanupAfterFailure } from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { setTimeout as sleep } from 'node:timers/promises';

import { beforeAll, afterAll, describe, expect, it, spyOn } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { fromConfig } from '../fromConfig.js';

import { CoreToolHostAdapter } from '@vybestack/llxprt-code-core';
import { ReadFileTool } from '@vybestack/llxprt-code-tools';

async function waitForRoots(
  file: string,
  matches: (value: string) => boolean,
): Promise<string> {
  for (let turn = 0; turn < 400; turn++) {
    let content = '';
    try {
      content = await readFile(file, 'utf8');
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
    const lines = content.trim().split('\n');
    const latest = lines[lines.length - 1];
    if (matches(latest)) return latest;
    await sleep(20);
  }
  throw new Error(
    `MCP roots observation did not arrive: ${await readFile(file, 'utf8')}`,
  );
}

describe('production filesystem roots', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'workspace-owner-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const credentials = useOwnedCredentials();
  it('publishes live MCP roots and trust changes without affecting a same-label sibling', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'mcp-roots-')),
    );
    const aDir = join(directory, 'first');
    const bDir = join(directory, 'second');
    const extra = join(directory, 'extra');
    await Promise.all([mkdir(aDir), mkdir(bDir), mkdir(extra)]);
    const firstLog = join(directory, 'first.jsonl');
    const secondLog = join(directory, 'second.jsonl');
    const script = fileURLToPath(
      new URL('./helpers/mcp-roots-server-fixture.ts', import.meta.url),
    );
    const first = await buildCliStyleConfig('plain-text.jsonl', {
      sessionId: 'same-label',
      workingDir: aDir,
      folderTrust: true,
      harness: { includeProcessCwd: false },
      mcpServers: {
        roots: { command: process.execPath, args: [script, firstLog] },
      },
    });
    const second = await buildCliStyleConfig('plain-text.jsonl', {
      sessionId: 'same-label',
      workingDir: bDir,
      folderTrust: true,
      harness: { includeProcessCwd: false },
      mcpServers: {
        roots: { command: process.execPath, args: [script, secondLog] },
      },
    });
    const agent = await fromConfig({
      settingsOwner: first.settingsOwner,
      settingsService: first.settingsService,
      config: first.config,
      providerManager: first.providerManager,
      agentClient: first.agentClient,
      mcpRuntime: first.mcpRuntime,
    });
    try {
      const originalSibling = await waitForRoots(secondLog, (value) =>
        value.includes(pathToFileURL(bDir).href),
      );
      expect(
        await waitForRoots(firstLog, (value) =>
          value.includes(pathToFileURL(aDir).href),
        ),
      ).toContain(pathToFileURL(aDir).href);
      agent.workspace.addDirectory(extra);
      expect(first.mcpRuntime.workspacePaths.directories()).toContain(extra);
      expect(
        await waitForRoots(firstLog, (value) =>
          value.includes(pathToFileURL(extra).href),
        ),
      ).toContain(pathToFileURL(extra).href);
      first.mcpRuntime.workspaceFilesystem.setDirectories([aDir]);
      expect(
        await waitForRoots(
          firstLog,
          (value) =>
            value.includes(pathToFileURL(aDir).href) &&
            !value.includes(pathToFileURL(extra).href),
        ),
      ).not.toContain(pathToFileURL(extra).href);
      await first.mcpRuntime.trust.setTrustedFolderLive(false);
      expect(first.mcpRuntime.workspacePaths.contains(extra)).toBe(false);
      expect(() => agent.workspace.addDirectory(extra)).toThrow('trusted');
      const status = first.mcpRuntime.status();
      if (!status) throw new Error('Missing MCP runtime status');
      const states = status.serverStates;
      expect(
        [...states.values()].every((state) => state.status === 'disconnected'),
      ).toBe(true);
      expect(
        (await readFile(secondLog, 'utf8'))
          .trim()
          .split('\n')
          .every((value) => value === originalSibling),
      ).toBe(true);
      expect(second.mcpRuntime.workspacePaths.contains(bDir)).toBe(true);
    } finally {
      await agent.dispose();
      await first.cleanup();
      await second.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('replacement clients read current owner directories rather than an initial snapshot', async () => {
    const builtPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const builtDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const builtConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: 'same-label',
        workingDir: builtDirectory,
      }),
    );
    const builtSettings = new SettingsService();
    const builtPolicy = new RuntimePolicyOwner(builtConfig);
    const builtMessageBus = builtPolicy.session.messageBus;
    const builtMcp = await McpRuntimeOwner.create(
      {
        openBrowser: async () => {
          throw new Error('Unexpected browser request');
        },
        tokenStorage: new MCPOAuthTokenStorage({
          getCredentials: async () => null,
          setCredentials: async () => {
            throw new Error('Unexpected token write');
          },
          deleteCredentials: async () => {},
          listServers: async () => [],
          getAllCredentials: async () => new Map(),
          clearAll: async () => {},
        }),
      },
      builtConfig,
      builtMessageBus,
      undefined,
      undefined,
      undefined,
      builtPolicy,
      'runtime',
    );

    const builtRuntimeId = 'engine-' + randomUUID();
    const builtRelease = new AcquisitionRelease();
    const builtSettingsOwner = new SessionSettingsOwner(builtSettings);
    builtRelease.acquire('settings', () => builtSettingsOwner.dispose());
    builtSettingsOwner.initializeProviderSelection(
      builtConfig.getProvider(),
      builtConfig.getModel(),
    );
    builtSettingsOwner.bindTelemetry(builtConfig);
    const builtFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [builtRuntimeId, builtConfig.getSessionId()])
      builtRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtFiles, scope),
      );
    const builtManager = acquirePreferredProviderManager(
      builtConfig,
      builtSettings,
      builtSettingsOwner,
      builtFiles,
      builtRuntimeId,
      credentials().authority,
      builtRelease,
    );
    const {
      tokenizerFactory: builtTokenizer,
      contentGeneratorFactory: builtContent,
    } = configureProviderRuntimeFactories(builtConfig, builtManager);
    const builtOAuth = acquirePreferredOAuth(
      undefined,
      builtMessageBus,
      builtConfig,
      builtSettings,
      builtManager,
      builtRuntimeId,
      builtMcp.profileDefinitions,
      credentials().authority,
      builtRelease,
    );
    const builtMedia = new SessionMediaOwner(
      builtConfig.projectTempDir,
      1024 * 1024,
    );
    const builtOwner = await SessionClientOwner.create(
      builtConfig,
      assembleTaskSchemaPolicy(builtSettings),
      builtManager,
      buildAgentClientFactory(),
      builtMedia.store,
      builtMcp.readInstructions,
      builtMcp.workspacePaths,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
    );
    builtOwner.bindMcpRuntime(builtMcp);
    builtOwner.bindHooks();
    const builtClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtOwner.dispose(),
        () => builtRelease.close(),
        () => builtMedia.dispose(),
        () => builtMcp.dispose(),
        () => builtConfig.dispose(),
        () => rm(builtDirectory, { recursive: true, force: true }),
      ],
      builtPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        builtConfig,
        builtSettings,
        builtSettingsOwner,
        builtManager,
        builtOAuth,
        builtRuntimeId,
        builtTokenizer,
      );
      await builtMcp.initialize();
      await builtOwner.initializeTools();
      await builtOwner.refreshAuth();
      await builtOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtClose);
    }

    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'replacement-roots-')),
    );
    const before = builtOwner.getAgentClient();
    try {
      builtMcp.workspaceFilesystem.addDirectory(directory);
      await builtOwner.refreshAuth();
      expect(before).not.toBe(builtOwner.getAgentClient());
      expect(builtOwner.workspaceDirectories()).toContain(directory);
      await builtOwner.getAgentClient().startChat();
      const generate = FakeProvider.prototype.generateChatCompletion;
      const requests: string[] = [];
      const observation = spyOn(
        FakeProvider.prototype,
        'generateChatCompletion',
      ).mockImplementation(async function* (this: FakeProvider, input) {
        requests.push(JSON.stringify(input));
        yield* generate.call(this, input);
      });
      for await (const event of builtOwner
        .getAgentClient()
        .sendMessageStream(
          'Observe current workspace',
          new AbortController().signal,
          'workspace-added',
        )) {
        if (event.type === 'error') throw new Error(JSON.stringify(event));
      }
      expect(requests.join('\n')).toContain(directory);
      requests.length = 0;
      builtMcp.workspaceFilesystem.setDirectories([builtConfig.getTargetDir()]);
      await builtOwner.refreshAuth();
      expect(builtOwner.workspaceDirectories()).not.toContain(directory);
      await builtOwner.getAgentClient().startChat();
      for await (const event of builtOwner
        .getAgentClient()
        .sendMessageStream(
          'Observe removed workspace',
          new AbortController().signal,
          'workspace-removed',
        )) {
        if (event.type === 'error') throw new Error(JSON.stringify(event));
      }
      expect(requests.join('\n')).not.toContain(directory);
      observation.mockRestore();
    } finally {
      await builtClose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { name: 'utf8', bytes: Buffer.from('Plain UTF-8 λ') },
    {
      name: 'utf8-bom',
      bytes: Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('UTF-8 BOM λ'),
      ]),
    },
    {
      name: 'utf16le',
      bytes: Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from('UTF-16 λ', 'utf16le'),
      ]),
    },
  ])(
    'keeps default public read_file decoding before and after adoption: $name',
    async ({ bytes }) => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'public-bom-')),
      );
      const file = join(directory, 'input.txt');
      await writeFile(file, bytes);
      const built = await buildCliStyleConfig('plain-text.jsonl', {
        workingDir: directory,
      });
      const tool = new ReadFileTool(
        new CoreToolHostAdapter(
          built.config,
          built.mcpRuntime.workspacePaths,
          built.mcpRuntime.workspaceFiles,
          built.mcpRuntime.workspaceIgnore,
          built.mcpRuntime.workspaceScans,
          () => built.settingsOwner.readToolExecutionPolicy(),
          built.mcpRuntime.trust,
          RootTelemetry.prepare({
            enabled: false,
            sessionId: 'isolated-caller-fixture',
            maxBytes: 1024,
            maxFiles: 1,
          }),
        ),
      );
      const before = await tool
        .build({ absolute_path: file })
        .execute(new AbortController().signal);
      const agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.providerManager,
        agentClient: built.agentClient,
        mcpRuntime: built.mcpRuntime,
      });
      try {
        const reader = agent.tools.get('read_file');
        if (!reader) throw new Error('Missing public read_file');
        const after = await reader.buildAndExecute(
          { file_path: file },
          new AbortController().signal,
        );
        expect(before.error).toBeUndefined();
        expect(after.error).toBeUndefined();
        expect(after.llmContent).toContain('λ');
        expect(after.llmContent).toBe(before.llmContent);
      } finally {
        await agent.dispose();
        await built.cleanup();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}
