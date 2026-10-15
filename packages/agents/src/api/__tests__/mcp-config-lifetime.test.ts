import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
} from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { existsSync } from 'node:fs';
import { waitFor } from '@vybestack/llxprt-code-test-utils';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('MCP Config lifetime deletion', () => {
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
  let builtCallerConfig: Config;
  let builtCallerSettings: SettingsService;
  let builtCallerSettingsOwner: SessionSettingsOwner;
  let builtCallerPolicy: RuntimePolicyOwner;
  let builtCallerMcp: McpRuntimeOwner;
  let builtCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let builtCallerOwner: SessionClientOwner;
  let builtCallerClose: () => Promise<void>;
  let builtCallerFactories: AgentRuntimeFactoryBindings;
  let builtCallerRelease: AcquisitionRelease;
  let builtCallerFiles: ProviderFileLifecycle;
  let builtCallerRuntimeId: string;
  let builtCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let builtCallerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  let builtCallerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

  async function openbuiltCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
    suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
    skillSettings: Pick<
      ConfigParameters,
      'enableExtensionReloading' | 'storageRoot'
    > = {},
    extensionLoader?: ExtensionLoader,
    skillOperations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'builtCaller-adoption-')),
    );
    const selection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...overrides,
      workingDir:
        overrides.workingDir === undefined
          ? directory
          : await realpath(overrides.workingDir),
    };
    const parameters = { ...toConfigParameters(selection), ...skillSettings };
    parameters.interactive = true;
    if (overrides.hooks !== undefined) parameters.enableHooks = true;
    if (
      overrides.filesystemOwner === undefined &&
      (overrides.harness?.includeProcessCwd ?? true)
    )
      parameters.includeDirectories = [
        ...(parameters.includeDirectories ?? []),
        process.cwd(),
      ];
    builtCallerConfig = new Config(parameters);
    builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    builtCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtCallerConfig.getInitialSettings(),
    ))
      builtCallerSettings.set(key, value);
    builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
    injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
    builtCallerMcp = await buildTestMcpRuntime(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      builtCallerPolicy,
      skillOperations,
    );
    acquirebuiltCallerProviders();
    const media = new SessionMediaOwner(
      builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    builtCallerOwner = await SessionClientOwner.create(
      builtCallerConfig,
      assembleTaskSchemaPolicy(builtCallerSettings),
      builtCallerManager,
      builtCallerFactories.agentClientFactory,
      media.store,
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
    builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtCallerOwner.dispose(),
        () => builtCallerRelease.close(),
        () => media.dispose(),
        () => builtCallerMcp.dispose(),
        () => builtCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
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
      );
      await builtCallerMcp.initialize();
      await activatebuiltCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }
  }
  function acquirebuiltCallerProviders(): void {
    builtCallerRuntimeId = 'builtCaller-' + randomUUID();
    builtCallerRelease = new AcquisitionRelease();
    builtCallerSettingsOwner = new SessionSettingsOwner(builtCallerSettings);
    builtCallerRelease.acquire('settings', () =>
      builtCallerSettingsOwner.dispose(),
    );
    builtCallerSettingsOwner.initializeProviderSelection(
      builtCallerConfig.getProvider(),
      builtCallerConfig.getModel(),
    );
    builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
    builtCallerFiles = new ProviderFileLifecycle({
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
    builtCallerManager = acquirePreferredProviderManager(
      builtCallerConfig,
      builtCallerSettings,
      builtCallerSettingsOwner,
      builtCallerFiles,
      builtCallerRuntimeId,
      builtCredentials().authority,
      builtCallerRelease,
    );
    const factories = configureProviderRuntimeFactories(
      builtCallerConfig,
      builtCallerManager,
    );
    builtCallerTokenizer = factories.tokenizerFactory;
    builtCallerContent = factories.contentGeneratorFactory;
    builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      builtCallerPolicy.session.messageBus,
      builtCallerConfig,
      builtCallerSettings,
      builtCallerManager,
      builtCallerRuntimeId,
      builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      builtCallerRelease,
    );
  }
  async function activatebuiltCallerClient(
    intent: ProviderActivationIntent = {
      provider: builtCallerConfig.getProvider(),
      model: builtCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      builtCallerConfig,
      intent,
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
  }

  it('closes owner instruction and resource admission without disposing caller Config', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      await builtCallerMcp.dispose();
      expect(() => builtCallerMcp.readInstructions()).toThrow('stopped');
      expect(() => builtCallerMcp.findResource('missing')).toThrow('stopped');
      await expect(
        builtCallerMcp.readResource('missing', 'uri'),
      ).rejects.toThrow('stopped');
      expect(builtCallerConfig.getTargetDir()).toBeTruthy();
      await expect(
        builtCallerMcp.trust.setTrustedFolderLive(false),
      ).rejects.toThrow('disposed');
      expect(builtCallerMcp.isStopped()).toBe(true);
    } finally {
      await builtCallerClose();
    }
  }, 30000);

  it('revokes trust and disposes while a real stdio discovery response is blocked', async () => {
    const evidence = join(tmpdir(), 'llxprt-mcp-config-lifetime-deletion');
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'blocked-'));
    const marker = join(directory, 'discovering');
    const config = new Config({
      sessionId: 'blocked-owner',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      trustedFolder: false,
      coreTools: [],
      skillsSupport: false,
      telemetry: { enabled: false },
      mcpServers: {
        same: {
          command: process.execPath,
          args: [
            resolveRepositoryFixture(
              import.meta.url,
              'scripts/tests/mcp-blocked-discovery-stdio-fixture.ts',
            ),
            marker,
          ],
        },
      },
    });
    const owner = await McpRuntimeOwner.create(
      createTestOAuthBinding(),
      config,
    );
    try {
      await owner.initialize();
      const gaining = owner.trust.setTrustedFolderLive(true);
      await waitFor(() => expect(existsSync(marker)).toBe(true));
      const pid = Number(await readFile(marker, 'utf8'));
      const revoking = owner.trust.setTrustedFolderLive(false);
      expect(owner.readInstructions()).toBe('');
      expect(owner.findResource('same:fixture:///arithmetic')).toBeUndefined();
      await expect(
        owner.readResource('same', 'fixture:///arithmetic'),
      ).rejects.toThrow('not available');
      expect(
        owner.toolSelection
          .getAllTools()
          .filter((tool) => tool.name.startsWith('mcp__')),
      ).toHaveLength(0);
      await owner.dispose();
      await Promise.all([gaining, revoking]);
      expect(() => process.kill(pid, 0)).toThrow('ESRCH');
      expect(() => owner.readInstructions()).toThrow('stopped');
    } finally {
      await owner.dispose();
      await config.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);

  it('reloads and refreshes one retained owner without changing another same-label owner', async () => {
    const evidence = join(tmpdir(), 'llxprt-mcp-config-lifetime-deletion');
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'reload-'));
    const owners: Array<{
      config: Config;
      owner: McpRuntimeOwner;
      directory: string;
    }> = [];
    try {
      for (const name of ['A', 'B']) {
        const cwd = join(directory, name);
        await mkdir(cwd);
        const config = new Config({
          sessionId: 'same',
          targetDir: cwd,
          cwd,
          model: 'test',
          debugMode: false,
          trustedFolder: true,
          coreTools: [],
          skillsSupport: false,
          telemetry: { enabled: false },
          mcpServers: {
            same: {
              command: process.execPath,
              args: [
                resolveRepositoryFixture(
                  import.meta.url,
                  'scripts/tests/mcp-standalone-stdio-fixture.ts',
                ),
                cwd,
              ],
            },
          },
        });
        const owner = await McpRuntimeOwner.create(
          createTestOAuthBinding(),
          config,
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
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            read: () => ({
              mcpServers: config.getMcpServers() ?? {},
              blockedMcpServers: [],
              settingsMcpServers: {},
            }),
            reload: async () => ({
              mcpServers: {},
              blockedMcpServers: [],
              settingsMcpServers: {},
            }),
          },
        );
        owners.push({ config, owner, directory: cwd });
        await owner.initialize();
        expect(Array.from(await owner.awaitDiscovery())).toStrictEqual([]);
      }
      const [a, b] = owners;
      const catalog = b.owner
        .listResources()
        .find(
          (resource) =>
            resource.serverName === 'same' &&
            resource.uri === 'fixture:///arithmetic',
        );
      expect(catalog).toMatchObject({
        serverName: 'same',
        uri: 'fixture:///arithmetic',
      });
      const tools = b.owner.toolSelection;
      const bus = b.owner.messageBus;
      const bRequests = await readFile(join(b.directory, 'requests'), 'utf8');
      await a.owner.refresh();
      await a.owner.reload();
      expect(a.owner.readInstructions()).toBe('');
      expect(
        a.owner.findResource('same:fixture:///arithmetic'),
      ).toBeUndefined();
      expect(b.owner.readInstructions()).toContain('Use arithmetic locally.');
      expect(b.owner.findResource('same:fixture:///arithmetic')).toBeDefined();
      expect(b.owner.findResource('same:fixture:///arithmetic')).toBe(catalog);
      expect(new Set([b.owner.toolSelection, tools]).size).toBe(1);
      expect(b.owner.messageBus).toBe(bus);
      expect(await readFile(join(b.directory, 'requests'), 'utf8')).toBe(
        bRequests,
      );
    } finally {
      for (const { config, owner } of owners) {
        await owner.dispose();
        await config.dispose();
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);

  it('rejects late instruction-consuming requests on a disposed borrowed facade', async () => {
    const { fromConfig } = await import('../fromConfig.js');
    await openbuiltCaller('plain-text.jsonl');
    const agent = await fromConfig({
      settingsOwner: builtCallerSettingsOwner,
      settingsService: builtCallerSettings,
      agentClient: builtCallerOwner.getAgentClient(),
      providerManager: builtCallerManager,
      config: builtCallerConfig,
      mcpRuntime: builtCallerMcp,
    });
    try {
      await agent.dispose();
      await expect(agent.generate('Do not send this request')).rejects.toThrow(
        'closed',
      );
      await expect(agent.generateJson([], {})).rejects.toThrow('closed');
      expect(builtCallerMcp.isStopped()).toBe(false);
      expect(builtCallerMcp.readInstructions()).toBe('');
    } finally {
      await agent.dispose();
      await builtCallerClose();
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
