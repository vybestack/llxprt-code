import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../../agents/src/api/model-selection.js';
import { AgentConfig } from '../../../agents/src/api/config-types.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { McpRuntimeOwner } from '@vybestack/llxprt-code-agents';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  startCatalogFixture,
  waitForFixtureFile,
} from '../../../agents/src/api/__tests__/helpers/workspace-catalog-http-fixture.js';
import { buildSlashCommandRuntime } from '../ui/cliUiRuntime.js';
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
  const builtCredentials = useOwnedCredentials();
  let workspaceDirectory: string;
  let workspaceAgent: Agent;
  let workspaceCommands: ReturnType<typeof buildSlashCommandRuntime>;
  let setWorkspaceTrustedFolder: (trusted: boolean) => Promise<void>;
  let closeWorkspaceRoot: () => Promise<void>;
  let closeWorkspace: () => Promise<void>;
  async function openWorkspace(): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'cli-mcp-catalog-'));
    const server = await startCatalogFixture(directory);

    const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../agents/src/api/__tests__/fixtures/' + 'plain-text.jsonl',
        import.meta.url,
      ),
    );
    const builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
      workingDir: directory,
      folderTrust: true,
      mcpServers: { physical: { httpUrl: server.url, trust: true } },
      telemetry: { enabled: false },
      recording: { enabled: false },
    };
    const builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...builtCallerOverrides,
      workingDir:
        builtCallerOverrides.workingDir === undefined
          ? builtCallerDirectory
          : await realpath(builtCallerOverrides.workingDir),
    };
    const builtCallerParameters = {
      ...toConfigParameters(builtCallerSelection),
      ...{},
    };
    builtCallerParameters.interactive = true;

    builtCallerParameters.includeDirectories = [
      ...(builtCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const builtCallerConfig = new Config(builtCallerParameters);
    const builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const builtCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtCallerConfig.getInitialSettings(),
    ))
      builtCallerSettings.set(key, value);
    const builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
    injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
    const builtCallerMcp = await buildTestMcpRuntime(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      builtCallerOverrides,
      undefined,
      builtCallerPolicy,
      undefined,
    );
    const builtCallerRuntimeId = 'caller-' + randomUUID();
    const builtCallerRelease = new AcquisitionRelease();
    const builtCallerSettingsOwner = new SessionSettingsOwner(
      builtCallerSettings,
    );
    builtCallerRelease.acquire('settings', () =>
      builtCallerSettingsOwner.dispose(),
    );
    builtCallerSettingsOwner.initializeProviderSelection(
      builtCallerConfig.getProvider(),
      builtCallerConfig.getModel(),
    );
    builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
    const builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      builtCallerRuntimeId,
      builtCallerConfig.getSessionId(),
    ])
      builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtCallerFiles, scope),
      );
    const builtCallerManager = acquirePreferredProviderManager(
      builtCallerConfig,
      builtCallerSettings,
      builtCallerSettingsOwner,
      builtCallerFiles,
      builtCallerRuntimeId,
      builtCredentials().authority,
      builtCallerRelease,
    );
    const builtCallerTokenizer = configureProviderTokenizer(builtCallerManager);
    const builtCallerContent = createRuntimeContentGeneratorFactory();
    const builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      builtCallerPolicy.session.messageBus,
      builtCallerConfig,
      builtCallerSettings,
      builtCallerManager,
      builtCallerRuntimeId,
      builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      builtCallerRelease,
      undefined,
    );
    const builtCallerMedia = new SessionMediaOwner(
      builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const builtCallerOwner = await SessionClientOwner.create(
      builtCallerConfig,
      assembleTaskSchemaPolicy(builtCallerSettings),
      builtCallerManager,
      builtCallerFactories.agentClientFactory,
      builtCallerMedia.store,
      builtCallerMcp.readInstructions,
      builtCallerMcp.workspacePaths,
      builtCallerSettingsOwner,
      builtCallerContent,
      builtCallerTokenizer,
    );
    builtCallerOwner.bindMcpRuntime(builtCallerMcp);
    builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
      builtCallerOAuth.composeRetryOperations(provider),
    );
    builtCallerOwner.bindHooks();
    const builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtCallerOwner.dispose(),
        () => builtCallerRelease.close(),
        () => builtCallerMedia.dispose(),
        () => builtCallerMcp.dispose(),
        () => builtCallerConfig.dispose(),
        () => rm(builtCallerDirectory, { recursive: true, force: true }),
      ],
      builtCallerPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerSettingsOwner,
        builtCallerManager,
        builtCallerOAuth,
        builtCallerRuntimeId,
        builtCallerTokenizer,
        undefined,
      );
      await builtCallerMcp.initialize();
      const activation = await executeProviderActivation(
        builtCallerConfig,
        builtCallerSelection.activation ?? {
          provider: builtCallerConfig.getProvider(),
          model: builtCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          builtCallerConfig,
          builtCallerSettings,
          builtCallerManager,
          builtCallerOAuth,
          () => 'agent',
          () => builtCallerOwner.refreshAuth(),
          builtCallerSettingsOwner,
        ),
        builtCallerSettings,
        builtCallerManager,
        (method) => builtCallerOwner.refreshAuth(method),
        assembleModelSelection(builtCallerSettingsOwner),
      );
      requireCallerActivation(activation);
      await builtCallerOwner.initializeTools();
      await builtCallerOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }

    await builtCallerMcp.awaitDiscovery();
    const agent = await fromConfig(
      builtCallerConfig,
      builtCallerSettings,
      {},
      undefined,
      builtCallerManager,
      undefined,
      undefined,
      builtCallerMcp,
      undefined,
      builtCallerOwner.getAgentClient(),
    );
    workspaceDirectory = directory;
    workspaceAgent = agent;
    workspaceCommands = buildSlashCommandRuntime(builtCallerConfig, agent);
    setWorkspaceTrustedFolder = (trusted) =>
      builtCallerMcp.trust.setTrustedFolderLive(trusted);
    closeWorkspaceRoot = () => builtCallerMcp.dispose();
    let closing: Promise<void> | undefined;
    closeWorkspace = () =>
      (closing ??= runCleanupSteps([
        () => server.release(),
        () => agent.dispose(),
        builtCallerClose,
        () => server.stop(),
        () => rm(directory, { recursive: true, force: true }),
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
    const closeFirstRoot = closeWorkspaceRoot;
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
      await closeFirstRoot();
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
    const root = await McpRuntimeOwner.create(createTestOAuthBinding(), config);
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

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
