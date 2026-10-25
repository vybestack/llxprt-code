import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
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
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, vi } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import {
  listenCutoverFixtureServer,
  startCutoverFixtureServer,
} from './helpers/mcp-cutover-server-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('explicit MCP construction ownership', () => {
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

  it('requires a retained handle when the caller requests MCP ownership', async () => {
    const config = new Config({
      sessionId: 'missing-mcp-owner',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test-model',
    });
    const callerSettings = createSessionSettingsFixture(config);
    await expect(
      Reflect.apply(fromConfig, undefined, [
        config,
        callerSettings.settingsService,
        { mcpOwnership: 'caller' },
        callerSettings.settingsOwner,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        builtCredentials().authority,
      ]),
    ).rejects.toThrow('Caller-owned MCP requires an explicit runtime handoff');
    expect(builtCredentials().keySnapshot()).toStrictEqual([]);
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
    const first = await createTestMcpRuntime(
      { oauth: createTestOAuthBinding(), config },
      {},
    );
    const second = await createTestMcpRuntime(
      {
        oauth: createTestOAuthBinding(),
        config,
        policy: { owner: first.policyOwner, ownership: 'caller' },
      },
      {},
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
    const adoptedSettings1 = createSessionSettingsFixture(config);
    await expect(
      fromConfig(
        config,
        adoptedSettings1.settingsService,
        {},
        adoptedSettings1.settingsOwner,
        undefined,
        undefined,
        new MessageBus(),
        first,
      ),
    ).rejects.toThrow(
      'MCP runtime handoff must retain its Config and MessageBus',
    );
    expect(first.isStopped()).toBe(false);
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
    const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {};
    const builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...builtCallerOverrides,
      workingDir: builtCallerDirectory,
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
    const builtCallerOwner = await createCapturedSessionOwner(
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
      await capturedSessionClient(builtCallerOwner).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }

    try {
      expect(builtCallerMcp).toBeInstanceOf(McpRuntimeOwner);
      expect(builtCallerMcp.initialize()).toBe(builtCallerMcp.initialize());
      await expect(
        fromConfig(
          builtCallerConfig,
          builtCallerSettings,
          {},
          builtCallerSettingsOwner,
          builtCallerManager,
          undefined,
          undefined,
          undefined,
          undefined,
          capturedSessionClient(builtCallerOwner),
        ),
      ).rejects.toThrow('MCP runtime handoff');
      await expect(
        Reflect.apply(fromConfig, undefined, [
          builtCallerConfig,
          builtCallerSettings,
          { mcpOwnership: 'caller' },
          builtCallerSettingsOwner,
          builtCallerManager,
          undefined,
          undefined,
          undefined,
          undefined,
          capturedSessionClient(builtCallerOwner),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ]),
      ).rejects.toThrow(
        'Caller-owned MCP requires an explicit runtime handoff',
      );
      const agent = await fromConfig(
        builtCallerConfig,
        builtCallerSettings,
        {},
        builtCallerSettingsOwner,
        builtCallerManager,
        undefined,
        builtCallerPolicy.session.messageBus,
        builtCallerMcp,
        undefined,
        capturedSessionClient(builtCallerOwner),
      );
      await agent.dispose();
      expect(builtCallerMcp.isStopped()).toBe(false);
    } finally {
      await builtCallerMcp.dispose();
      await builtCallerConfig.dispose();
      await builtCallerClose();
    }
  });

  it('borrows the original credential and browser owner for manual reconnect', async () => {
    const fixture = startCutoverFixtureServer('http', () => 1);
    await listenCutoverFixtureServer(fixture);
    const binding = createTestOAuthBinding();
    const browsers: string[] = [];

    const builtReleases: Array<() => Promise<void>> = [];
    try {
      const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
        new URL('./fixtures/' + 'plain-text.jsonl', import.meta.url),
      );
      const builtCallerDirectory = await realpath(
        await mkdtemp(join(tmpdir(), 'explicit-caller-')),
      );
      const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
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
      };
      const builtCallerSelection: AgentConfig = {
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        ...builtCallerOverrides,
        workingDir: builtCallerDirectory,
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
      const builtCallerTokenizer =
        configureProviderTokenizer(builtCallerManager);
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
      const builtCallerOwner = await createCapturedSessionOwner(
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
        await capturedSessionClient(builtCallerOwner).startChat();
      } catch (primary) {
        await cleanupAfterFailure(primary, builtCallerClose);
      }

      builtReleases.push(builtCallerClose);
      await builtCallerMcp.awaitDiscovery();
      const agent = await fromConfig(
        builtCallerConfig,
        builtCallerSettings,
        {},
        builtCallerSettingsOwner,
        builtCallerManager,
        undefined,
        builtCallerPolicy.session.messageBus,
        builtCallerMcp,
        undefined,
        capturedSessionClient(builtCallerOwner),
      );
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
      expect(builtCallerMcp.isStopped()).toBe(false);
    } finally {
      await runCleanupSteps(builtReleases);

      fixture.server.closeAllConnections();
      await new Promise<void>((resolve) =>
        fixture.server.close(() => resolve()),
      );
    }
  });
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
