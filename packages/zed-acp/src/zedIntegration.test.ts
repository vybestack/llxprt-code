import { internalConfig } from '../../agents/src/api/__tests__/helpers/agentHarness.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../../agents/src/api/mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises';
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
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
  vi,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
} from '../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../agents/src/api/model-selection.js';
import {
  AgentConfig,
  ProviderActivationIntent,
} from '../../agents/src/api/config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { CredentialAuthority } from '../../providers/src/auth/proxy/credential-store-factory.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  captureZedHostInputs,
  captureZedSessionParameters,
} from './zed-session-agent.js';
import { unusedProfileApplication } from './test-profile-application.js';
import {
  ZedAgent as ZedAgentType,
  parseZedAuthMethodId,
} from './zedIntegration.js';
import { installZedDefinitionFixture } from './__tests__/definition-fixture.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { MCP_SESSION_APPROVAL_SOURCE } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const createFilesystem = installTestWorkspaceFilesystem();

const definitionFixture = installZedDefinitionFixture();

const mockCreateAgent = vi.fn();

const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actual,
  createAgentFromSettingsSnapshot: (
    ...args: Parameters<typeof actual.createAgentFromSettingsSnapshot>
  ) => mockCreateAgent(...args),
}));

describe('zedIntegration auth method validation', () => {
  it('accepts known profile names', () => {
    expect(parseZedAuthMethodId('alpha', ['alpha', 'beta'])).toBe('alpha');
    expect(parseZedAuthMethodId('beta', ['alpha', 'beta'])).toBe('beta');
  });

  it('rejects unknown profile names', () => {
    expect(() => parseZedAuthMethodId('gamma', ['alpha', 'beta'])).toThrow(
      /Invalid enum value/,
    );
  });

  it('rejects selection when no profiles exist', () => {
    expect(() => parseZedAuthMethodId('alpha', [])).toThrow(
      /No profiles available for selection/,
    );
  });
});

describe('Zed session composition', () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'zed-filesystem-composition-'));
    await Promise.all(
      ['first', 'second'].map((name) => mkdir(join(projectRoot, name))),
    );
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  it('copies declarative host settings into independently owned Configs', async () => {
    const base = new Config({
      sessionId: 'base',
      targetDir: projectRoot,
      cwd: projectRoot,
      model: 'base-model',
      provider: 'fake',
      debugMode: false,
      coreTools: ['read_file'],
      mcpServers: { later: { command: 'echo' } },
      policyEngineConfig: {
        rules: [
          {
            toolName: 'host-rule',
            decision: PolicyDecision.DENY,
            source: 'host-policy',
          },
        ],
      },
    });
    const basePolicy = new RuntimePolicyOwner(base);
    const firstFileSystemService = {
      readTextFile: async () => 'first',
      writeTextFile: async () => undefined,
    };
    const secondFileSystemService = {
      readTextFile: async () => 'second',
      writeTextFile: async () => undefined,
    };
    const baseSettings = new SettingsService();
    baseSettings.set('fixture-marker', 'before');
    base.setApprovalMode(ApprovalMode.AUTO_EDIT);
    basePolicy.session.confirmation.addRule({
      toolName: 'session-only',
      decision: PolicyDecision.ALLOW,
      source: MCP_SESSION_APPROVAL_SOURCE,
    });
    const first = new Config(
      captureZedSessionParameters(
        base,
        'first-session',
        join(projectRoot, 'first'),
        captureZedHostInputs(base),
      ),
    );
    const firstRoot = createFilesystem({
      targetDir: first.getTargetDir(),
      isTrusted: () => true,
      fileSystem: { service: firstFileSystemService, ownership: 'caller' },
    });
    const firstPolicy = new RuntimePolicyOwner(first);
    const firstSettings = new SettingsService({ sessionSource: baseSettings });
    firstSettings.restoreFromStateSnapshot(
      baseSettings.exportForStateSnapshot(),
    );
    baseSettings.set('fixture-marker', 'after');
    const second = new Config(
      captureZedSessionParameters(
        base,
        'second-session',
        join(projectRoot, 'second'),
        captureZedHostInputs(base),
      ),
    );
    const secondRoot = createFilesystem({
      targetDir: second.getTargetDir(),
      isTrusted: () => true,
      fileSystem: { service: secondFileSystemService, ownership: 'caller' },
    });
    const secondPolicy = new RuntimePolicyOwner(second);
    const secondSettings = new SettingsService({ sessionSource: baseSettings });
    secondSettings.restoreFromStateSnapshot(
      baseSettings.exportForStateSnapshot(),
    );
    try {
      expect(first).toBeInstanceOf(Config);
      expect('createSessionConfig' in base).toBe(false);
      expect(second).toBeInstanceOf(Config);
      expect(first.getTargetDir()).toBe(join(projectRoot, 'first'));
      expect(second.getTargetDir()).toBe(join(projectRoot, 'second'));
      expect(
        await firstRoot.files.readTextFile(join(first.getTargetDir(), 'text')),
      ).not.toBe(
        await secondRoot.files.readTextFile(
          join(second.getTargetDir(), 'text'),
        ),
      );
      expect('getFileSystemService' in first).toBe(false);
      expect(firstSettings.get('fixture-marker')).toBe('before');
      expect(secondSettings.get('fixture-marker')).toBe('after');
      expect(firstSettings).not.toBe(baseSettings);
      expect(firstPolicy.session.decisions).not.toBe(
        secondPolicy.session.decisions,
      );
      expect(firstPolicy.session.inspection.getRules()).toStrictEqual([
        expect.objectContaining({ source: 'host-policy' }),
      ]);
      expect(first.getCoreTools()).toStrictEqual(['read_file']);
      expect(first.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
      expect(first.getMcpServers()).toStrictEqual({
        later: { command: 'echo' },
      });
      expect(first.projectChatsDir).toBe(base.projectChatsDir);
    } finally {
      await Promise.all([first.dispose(), second.dispose(), base.dispose()]);
    }
  });
});

describe('ZedAgent.newSession', () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'zed-filesystem-sessions-'));
    await Promise.all(
      ['first', 'second'].map((name) => mkdir(join(projectRoot, name))),
    );
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  afterEach(() => {
    mockCreateAgent.mockImplementation(actual.createAgentFromSettingsSnapshot);
  });

  it('creates independent Agent sessions with session-scoped configs', async () => {
    const capturedConfigs: Config[] = [];
    const capturedManagers: Array<Agent['providerManager']> = [];
    const capturedAgents: Agent[] = [];
    mockCreateAgent.mockImplementation(
      async (
        ...args: Parameters<typeof actual.createAgentFromSettingsSnapshot>
      ) => {
        const agent = await actual.createAgentFromSettingsSnapshot(...args);
        capturedAgents.push(agent);
        capturedConfigs.push(internalConfig(agent));
        capturedManagers.push(agent.providerManager);
        return agent;
      },
    );
    const baseConfig = new Config({
      sessionId: 'base',
      targetDir: projectRoot,
      cwd: projectRoot,
      model: 'test-model',
      provider: 'openai',
      debugMode: false,
    });
    const settingsService = new SettingsService();
    const connection = {
      readTextFile: vi.fn(async (_params: { sessionId: string }) => ({
        content: 'client',
      })),
      writeTextFile: vi.fn(async () => undefined),
      sessionUpdate: vi.fn(async () => undefined),
    };
    const mod = await import('./zedIntegration.js');
    const zedAgent = new mod.ZedAgent(
      baseConfig,
      connection as never,
      unusedProfileApplication,
      () => new SettingsService({ sessionSource: settingsService }),
      undefined,
      definitionFixture(),
      undefined,
      { credentialAuthority: new CredentialAuthority() },
    );

    await zedAgent.initialize({
      protocolVersion: '1',
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    } as never);
    const firstSession = await zedAgent.newSession({
      cwd: join(projectRoot, 'first'),
    } as never);
    const secondSession = await zedAgent.newSession({
      cwd: join(projectRoot, 'second'),
    } as never);
    expect(capturedAgents).toHaveLength(2);
    expect(capturedConfigs[0].getSessionId()).toBe(firstSession.sessionId);
    expect(capturedConfigs[1].getSessionId()).toBe(secondSession.sessionId);
    expect(capturedConfigs[0].getSessionId()).not.toBe(
      capturedConfigs[1].getSessionId(),
    );
    expect('providerManager' in capturedConfigs[0]).toBe(false);
    expect('providerManager' in capturedConfigs[1]).toBe(false);

    expect(capturedConfigs).toHaveLength(2);
    expect(capturedConfigs[0]).not.toBe(capturedConfigs[1]);
    expect(capturedConfigs[0].getTargetDir()).toBe(join(projectRoot, 'first'));
    expect(capturedConfigs[1].getTargetDir()).toBe(join(projectRoot, 'second'));
    expect(capturedManagers).toHaveLength(2);
    expect(capturedManagers[0]).not.toBe(capturedManagers[1]);
    await capturedAgents[0].setProvider('anthropic', 'session-first-model');
    expect(capturedManagers[0].getActiveProviderName()).toBe('anthropic');
    expect(capturedManagers[1].getActiveProviderName()).not.toBe('anthropic');
    expect(capturedConfigs[0]).not.toBe(capturedConfigs[1]);
    expect('providerManager' in baseConfig).toBe(false);
    expect(
      await capturedAgents[0].workspace.readTextFile(
        join(projectRoot, 'first', 'x'),
      ),
    ).toBe('client');
    expect(
      await capturedAgents[1].workspace.readTextFile(
        join(projectRoot, 'second', 'x'),
      ),
    ).toBe('client');
    const firstRead = connection.readTextFile.mock.calls[0];
    const secondRead = connection.readTextFile.mock.calls[1];
    expect(firstRead).toBeDefined();
    expect(secondRead).toBeDefined();
    expect(firstRead[0].sessionId).not.toBe(secondRead[0].sessionId);
  });
});

describe('ZedAgent.authenticate credential cache', () => {
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
  let builtCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let builtCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

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
      new URL(
        '../../agents/src/api/__tests__/fixtures/' + fixture,
        import.meta.url,
      ),
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
        undefined,
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
    const factoriesTokenizer = configureProviderTokenizer(builtCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    builtCallerTokenizer = factoriesTokenizer;
    builtCallerContent = factoriesContent;
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
      undefined,
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

  const builtReleases: Array<() => Promise<void>> = [];
  let profiles: ProfileManager;
  let root: string;
  let agent: ZedAgentType;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'llxprt-zed-profile-owner-'));
    await openbuiltCaller('plain-text.jsonl', {
      workingDir: root,
      settings: { profileDirectory: join(root, 'profiles') },
    });
    builtReleases.push(builtCallerClose);
    profiles = new ProfileManager(join(root, 'profiles'));
    for (const name of ['alpha', 'beta']) {
      await profiles.saveProfile(name, {
        version: 1,
        provider: 'fake',
        model: `${name}-model`,
        modelParams: {},
        ephemeralSettings: {},
      });
    }
    const config = builtCallerConfig;
    const manager = builtCallerManager;

    const application = actual.assembleProfileApplication(
      builtCallerSettings,
      manager,
      null,
      actual.assembleProviderSwitch(
        config,
        builtCallerSettings,
        manager,
        null,
        () => undefined,
        () => builtCallerOwner.refreshAuth(),
        builtCallerSettingsOwner,
      ),
      builtCallerSettingsOwner,
      profiles,
    );
    const { ZedAgent } = await import('./zedIntegration.js');
    agent = new ZedAgent(
      config,
      undefined as never,
      application,
      () => builtCallerSettingsOwner.createChildStore(),
      undefined,
      builtCallerMcp.profileDefinitions,
    );
  });

  afterEach(async () => {
    await builtCallerClose();
    await rm(root, { recursive: true, force: true });
  });

  it('loads profile when switching to a different profile', async () => {
    await agent.authenticate({ methodId: 'alpha' });
    await agent.authenticate({ methodId: 'beta' });

    expect(builtCallerSettings.getCurrentProfileName()).toBe('beta');
    expect(builtCallerSettingsOwner.readSelectedModel()).toBe('beta-model');
  });

  it('loads profile when re-authenticating same profile', async () => {
    await agent.authenticate({ methodId: 'alpha' });
    await profiles.saveProfile('alpha', {
      version: 1,
      provider: 'fake',
      model: 'updated-model',
      modelParams: {},
      ephemeralSettings: {},
    });
    await agent.authenticate({ methodId: 'alpha' });

    expect(builtCallerSettings.getCurrentProfileName()).toBe('alpha');
    expect(builtCallerSettingsOwner.readSelectedModel()).toBe('updated-model');
  });

  it('loads profile when no active profile exists', async () => {
    expect(builtCallerSettings.getCurrentProfileName()).toBeNull();
    await agent.authenticate({ methodId: 'alpha' });

    expect(builtCallerSettings.getCurrentProfileName()).toBe('alpha');
    expect(builtCallerSettingsOwner.readSelectedModel()).toBe('alpha-model');
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
