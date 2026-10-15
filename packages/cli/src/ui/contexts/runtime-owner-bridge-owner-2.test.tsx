import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../../../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {
  configureProviderRuntimeFactories,
  NodeFileSystem,
  populateProviderManager,
  createOwnedOAuthManager,
  createOwnedTokenStoreClose,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach as afterFixtureTest,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../../../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../../../agents/src/api/model-selection.js';
import { AgentConfig } from '../../../../agents/src/api/config-types.js';
import {
  OwnerView,
  AliasRefreshView,
} from './runtime-owner-bridge-views.fixture.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { render } from 'ink-testing-library';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  createRuntimeOwnerFeatures,
  createProviderAliasRefresh,
} from '../../runtime/createRuntimeOwnerFeatures.js';
import { ProviderAliasRefreshProvider } from './ProviderAliasRefreshContext.js';
import { providerCommand } from '../commands/providerCommand.js';
import { RuntimeContextProvider, type RuntimeApi } from './RuntimeContext.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const makeFixtureFilesystem = installTestWorkspaceFilesystem();

let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;

function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}

const composeFixtureRuntime = installWorkspaceRuntimeFixture();

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
describe('interactive runtime owner bridge', () => {
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

  const acquiredCleanup: Array<() => void | Promise<void>> = [];
  afterFixtureTest(async () => {
    fixtureFilesystem = undefined;
    await runCleanupSteps(acquiredCleanup.splice(0).reverse());
  });
  const firstCredentials = useOwnedCredentials();
  const secondCredentials = useOwnedCredentials();
  it('keeps alias commands and live provider status scoped across interleaved saves and sibling disposal', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'llxprt-alias-owner-'));
    const previousDataHome = process.env['LLXPRT_DATA_HOME'];
    const previousFakeResponses = process.env.LLXPRT_FAKE_RESPONSES;
    process.env['LLXPRT_DATA_HOME'] = dataDir;
    acquiredCleanup.push(() => {
      if (previousDataHome === undefined) delete process.env.LLXPRT_DATA_HOME;
      else process.env.LLXPRT_DATA_HOME = previousDataHome;
      if (previousFakeResponses === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousFakeResponses;
      rmSync(dataDir, { recursive: true, force: true });
    });

    const firstCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/' +
          'multi-turn-text.jsonl',
        import.meta.url,
      ),
    );
    const firstCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const firstCallerOverrides: Readonly<Partial<AgentConfig>> = {};
    const firstCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...firstCallerOverrides,
      workingDir: firstCallerDirectory,
    };
    const firstCallerParameters = {
      ...toConfigParameters(firstCallerSelection),
      ...{},
    };
    firstCallerParameters.interactive = true;

    firstCallerParameters.includeDirectories = [
      ...(firstCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const firstCallerConfig = new Config(firstCallerParameters);
    const firstCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const firstCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      firstCallerConfig.getInitialSettings(),
    ))
      firstCallerSettings.set(key, value);
    const firstCallerPolicy = new RuntimePolicyOwner(firstCallerConfig);
    injectConfirmationForcingPolicy(firstCallerPolicy.session.confirmation);
    const firstCallerMcp = await buildTestMcpRuntime(
      firstCallerConfig,
      firstCallerPolicy.session.messageBus,
      firstCallerOverrides,
      undefined,
      firstCallerPolicy,
      undefined,
    );
    const firstCallerRuntimeId = 'caller-' + randomUUID();
    const firstCallerRelease = new AcquisitionRelease();
    const firstCallerSettingsOwner = new SessionSettingsOwner(
      firstCallerSettings,
    );
    firstCallerRelease.acquire('settings', () =>
      firstCallerSettingsOwner.dispose(),
    );
    firstCallerSettingsOwner.initializeProviderSelection(
      firstCallerConfig.getProvider(),
      firstCallerConfig.getModel(),
    );
    firstCallerSettingsOwner.bindTelemetry(firstCallerConfig);
    const firstCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      firstCallerRuntimeId,
      firstCallerConfig.getSessionId(),
    ])
      firstCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(firstCallerFiles, scope),
      );
    const firstCallerManager = acquirePreferredProviderManager(
      firstCallerConfig,
      firstCallerSettings,
      firstCallerSettingsOwner,
      firstCallerFiles,
      firstCallerRuntimeId,
      firstCredentials().authority,
      firstCallerRelease,
    );
    const {
      tokenizerFactory: firstCallerTokenizer,
      contentGeneratorFactory: firstCallerContent,
    } = configureProviderRuntimeFactories(
      firstCallerConfig,
      firstCallerManager,
    );
    const firstCallerOAuth = acquirePreferredOAuth(
      undefined,
      firstCallerPolicy.session.messageBus,
      firstCallerConfig,
      firstCallerSettings,
      firstCallerManager,
      firstCallerRuntimeId,
      firstCallerMcp.profileDefinitions,
      firstCredentials().authority,
      firstCallerRelease,
    );
    const firstCallerMedia = new SessionMediaOwner(
      firstCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const firstCallerOwner = await SessionClientOwner.create(
      firstCallerConfig,
      assembleTaskSchemaPolicy(firstCallerSettings),
      firstCallerManager,
      firstCallerFactories.agentClientFactory,
      firstCallerMedia.store,
      firstCallerMcp.readInstructions,
      firstCallerMcp.workspacePaths,
      firstCallerSettingsOwner,
      firstCallerContent,
      firstCallerTokenizer,
    );
    firstCallerOwner.bindMcpRuntime(firstCallerMcp);
    firstCallerOwner.bindProviderFiles(firstCallerFiles, (provider) =>
      firstCallerOAuth.composeRetryOperations(provider),
    );
    firstCallerOwner.bindHooks();
    const firstCallerReleaseResources = settleEngineRelease.bind(
      undefined,
      [
        () => firstCallerOwner.dispose(),
        () => firstCallerRelease.close(),
        () => firstCallerMedia.dispose(),
        () => firstCallerMcp.dispose(),
        () => firstCallerConfig.dispose(),
        () => rm(firstCallerDirectory, { recursive: true, force: true }),
      ],
      firstCallerPreviousReplay,
    );
    let firstCallerClosing: Promise<void> | undefined;
    const firstCallerClose = (): Promise<void> =>
      (firstCallerClosing ??= firstCallerReleaseResources());
    acquiredCleanup.push(firstCallerClose);
    try {
      await preparePreferredProviderCompletion(
        firstCallerConfig,
        firstCallerSettings,
        firstCallerSettingsOwner,
        firstCallerManager,
        firstCallerOAuth,
        firstCallerRuntimeId,
        firstCallerTokenizer,
      );
      await firstCallerMcp.initialize();
      const activation = await executeProviderActivation(
        firstCallerConfig,
        firstCallerSelection.activation ?? {
          provider: firstCallerConfig.getProvider(),
          model: firstCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          firstCallerConfig,
          firstCallerSettings,
          firstCallerManager,
          firstCallerOAuth,
          () => 'agent',
          () => firstCallerOwner.refreshAuth(),
          firstCallerSettingsOwner,
        ),
        firstCallerSettings,
        firstCallerManager,
        (method) => firstCallerOwner.refreshAuth(method),
        assembleModelSelection(firstCallerSettingsOwner),
      );
      requireCallerActivation(activation);
      await firstCallerOwner.initializeTools();
      await firstCallerOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, firstCallerClose);
    }

    const secondCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/' +
          'multi-turn-text.jsonl',
        import.meta.url,
      ),
    );
    const secondCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const secondCallerOverrides: Readonly<Partial<AgentConfig>> = {};
    const secondCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...secondCallerOverrides,
      workingDir: secondCallerDirectory,
    };
    const secondCallerParameters = {
      ...toConfigParameters(secondCallerSelection),
      ...{},
    };
    secondCallerParameters.interactive = true;

    secondCallerParameters.includeDirectories = [
      ...(secondCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const secondCallerConfig = new Config(secondCallerParameters);
    const secondCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const secondCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      secondCallerConfig.getInitialSettings(),
    ))
      secondCallerSettings.set(key, value);
    const secondCallerPolicy = new RuntimePolicyOwner(secondCallerConfig);
    injectConfirmationForcingPolicy(secondCallerPolicy.session.confirmation);
    const secondCallerMcp = await buildTestMcpRuntime(
      secondCallerConfig,
      secondCallerPolicy.session.messageBus,
      secondCallerOverrides,
      undefined,
      secondCallerPolicy,
      undefined,
    );
    const secondCallerRuntimeId = 'caller-' + randomUUID();
    const secondCallerRelease = new AcquisitionRelease();
    const secondCallerSettingsOwner = new SessionSettingsOwner(
      secondCallerSettings,
    );
    secondCallerRelease.acquire('settings', () =>
      secondCallerSettingsOwner.dispose(),
    );
    secondCallerSettingsOwner.initializeProviderSelection(
      secondCallerConfig.getProvider(),
      secondCallerConfig.getModel(),
    );
    secondCallerSettingsOwner.bindTelemetry(secondCallerConfig);
    const secondCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      secondCallerRuntimeId,
      secondCallerConfig.getSessionId(),
    ])
      secondCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(secondCallerFiles, scope),
      );
    const secondCallerManager = acquirePreferredProviderManager(
      secondCallerConfig,
      secondCallerSettings,
      secondCallerSettingsOwner,
      secondCallerFiles,
      secondCallerRuntimeId,
      secondCredentials().authority,
      secondCallerRelease,
    );
    const {
      tokenizerFactory: secondCallerTokenizer,
      contentGeneratorFactory: secondCallerContent,
    } = configureProviderRuntimeFactories(
      secondCallerConfig,
      secondCallerManager,
    );
    const secondCallerOAuth = acquirePreferredOAuth(
      undefined,
      secondCallerPolicy.session.messageBus,
      secondCallerConfig,
      secondCallerSettings,
      secondCallerManager,
      secondCallerRuntimeId,
      secondCallerMcp.profileDefinitions,
      secondCredentials().authority,
      secondCallerRelease,
    );
    const secondCallerMedia = new SessionMediaOwner(
      secondCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const secondCallerOwner = await SessionClientOwner.create(
      secondCallerConfig,
      assembleTaskSchemaPolicy(secondCallerSettings),
      secondCallerManager,
      secondCallerFactories.agentClientFactory,
      secondCallerMedia.store,
      secondCallerMcp.readInstructions,
      secondCallerMcp.workspacePaths,
      secondCallerSettingsOwner,
      secondCallerContent,
      secondCallerTokenizer,
    );
    secondCallerOwner.bindMcpRuntime(secondCallerMcp);
    secondCallerOwner.bindProviderFiles(secondCallerFiles, (provider) =>
      secondCallerOAuth.composeRetryOperations(provider),
    );
    secondCallerOwner.bindHooks();
    const secondCallerReleaseResources = settleEngineRelease.bind(
      undefined,
      [
        () => secondCallerOwner.dispose(),
        () => secondCallerRelease.close(),
        () => secondCallerMedia.dispose(),
        () => secondCallerMcp.dispose(),
        () => secondCallerConfig.dispose(),
        () => rm(secondCallerDirectory, { recursive: true, force: true }),
      ],
      secondCallerPreviousReplay,
    );
    let secondCallerClosing: Promise<void> | undefined;
    const secondCallerClose = (): Promise<void> =>
      (secondCallerClosing ??= secondCallerReleaseResources());
    acquiredCleanup.push(secondCallerClose);
    try {
      await preparePreferredProviderCompletion(
        secondCallerConfig,
        secondCallerSettings,
        secondCallerSettingsOwner,
        secondCallerManager,
        secondCallerOAuth,
        secondCallerRuntimeId,
        secondCallerTokenizer,
      );
      await secondCallerMcp.initialize();
      const activation = await executeProviderActivation(
        secondCallerConfig,
        secondCallerSelection.activation ?? {
          provider: secondCallerConfig.getProvider(),
          model: secondCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          secondCallerConfig,
          secondCallerSettings,
          secondCallerManager,
          secondCallerOAuth,
          () => 'agent',
          () => secondCallerOwner.refreshAuth(),
          secondCallerSettingsOwner,
        ),
        secondCallerSettings,
        secondCallerManager,
        (method) => secondCallerOwner.refreshAuth(method),
        assembleModelSelection(secondCallerSettingsOwner),
      );
      requireCallerActivation(activation);
      await secondCallerOwner.initializeTools();
      await secondCallerOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, secondCallerClose);
    }

    const a = await fromConfig({
      settingsOwner: firstCallerSettingsOwner,
      settingsService: firstCallerSettings,
      providerManager: firstCallerManager,
      config: firstCallerConfig,
      messageBus: firstCallerPolicy.session.messageBus,
      mcpRuntime: firstCallerMcp,
      sessionId: 'alias-owner-shared-label',
    });
    acquiredCleanup.push(() => a.dispose());
    const b = await fromConfig({
      settingsOwner: secondCallerSettingsOwner,
      settingsService: secondCallerSettings,
      providerManager: secondCallerManager,
      config: secondCallerConfig,
      messageBus: secondCallerPolicy.session.messageBus,
      mcpRuntime: secondCallerMcp,
      sessionId: 'alias-owner-shared-label',
    });
    acquiredCleanup.push(() => b.dispose());
    delete process.env.LLXPRT_FAKE_RESPONSES;
    if (
      !(firstCallerManager instanceof ProviderManager) ||
      !(secondCallerManager instanceof ProviderManager)
    )
      throw new Error('Expected concrete fixture owners');
    const firstManager = firstCallerManager;
    const firstAliasTokens = firstCredentials().authority.createTokenStore();
    let firstAliasTransferred = false;
    const firstAliasClose = createOwnedTokenStoreClose(firstAliasTokens);
    firstCallerRelease.acquire('tokens', () =>
      firstAliasTransferred ? undefined : firstAliasClose(),
    );
    const firstAliasOAuth = createOwnedOAuthManager(
      firstAliasTokens,
      undefined,
      undefined,
      firstCallerConfig,
      firstManager,
      firstCallerSettings,
    );
    firstCallerRelease.acquire('oauth', () => firstAliasOAuth.dispose());
    firstAliasTransferred = true;
    populateProviderManager(
      firstManager,
      firstAliasOAuth,
      firstAliasTokens,
      firstCallerSettings,
      new NodeFileSystem(),
      firstCallerConfig,
      undefined,
      undefined,
      false,
      false,
      process.env.LLXPRT_FAKE_RESPONSES,
    );
    const secondManager = secondCallerManager;
    const secondAliasTokens = secondCredentials().authority.createTokenStore();
    let secondAliasTransferred = false;
    const secondAliasClose = createOwnedTokenStoreClose(secondAliasTokens);
    secondCallerRelease.acquire('tokens', () =>
      secondAliasTransferred ? undefined : secondAliasClose(),
    );
    const secondAliasOAuth = createOwnedOAuthManager(
      secondAliasTokens,
      undefined,
      undefined,
      secondCallerConfig,
      secondManager,
      secondCallerSettings,
    );
    secondCallerRelease.acquire('oauth', () => secondAliasOAuth.dispose());
    secondAliasTransferred = true;
    populateProviderManager(
      secondManager,
      secondAliasOAuth,
      secondAliasTokens,
      secondCallerSettings,
      new NodeFileSystem(),
      secondCallerConfig,
      undefined,
      undefined,
      false,
      false,
      process.env.LLXPRT_FAKE_RESPONSES,
    );
    configureProviderRuntimeFactories(firstCallerConfig, firstManager);
    configureProviderRuntimeFactories(secondCallerConfig, secondManager);
    firstManager.setActiveProvider('openai');
    secondManager.setActiveProvider('openai');
    firstCallerSettingsOwner.writeUserParameter(
      'base-url',
      'https://left.example/v1',
    );
    secondCallerSettingsOwner.writeUserParameter(
      'base-url',
      'https://right.example/v1',
    );
    const captured: {
      left?: RuntimeApi;
      right?: RuntimeApi;
      leftRefresh?: () => Promise<void>;
      rightRefresh?: () => Promise<void>;
    } = {};
    const left = render(
      <ProviderAliasRefreshProvider
        refresh={createProviderAliasRefresh(a.providerManager)}
      >
        <RuntimeContextProvider
          requestFetch={a.sessionClient.fetch}
          agent={a}
          owner={createRuntimeOwnerFeatures(
            firstCallerConfig,
            a.providerManager,
            fixturePaths().directories,
            createSessionModelCommand(a),
            firstCallerSettingsOwner,
            firstCallerSettings,
            a.workspace,
            a.modelParameters,
            a.settings,
            a.toolFormat,
            a.providerReads,
            a.auth.keys,
          )}
        >
          <OwnerView label="left" onApi={(api) => (captured.left = api)} />
          <AliasRefreshView
            onRefresh={(refresh) => (captured.leftRefresh = refresh)}
          />
        </RuntimeContextProvider>
      </ProviderAliasRefreshProvider>,
    );
    const right = render(
      <ProviderAliasRefreshProvider
        refresh={createProviderAliasRefresh(b.providerManager)}
      >
        <RuntimeContextProvider
          requestFetch={b.sessionClient.fetch}
          agent={b}
          owner={createRuntimeOwnerFeatures(
            secondCallerConfig,
            b.providerManager,
            fixturePaths().directories,
            createSessionModelCommand(b),
            secondCallerSettingsOwner,
            secondCallerSettings,
            b.workspace,
            b.modelParameters,
            b.settings,
            b.toolFormat,
            b.providerReads,
            b.auth.keys,
          )}
        >
          <OwnerView label="right" onApi={(api) => (captured.right = api)} />
          <AliasRefreshView
            onRefresh={(refresh) => (captured.rightRefresh = refresh)}
          />
        </RuntimeContextProvider>
      </ProviderAliasRefreshProvider>,
    );
    try {
      const action = providerCommand.action;
      if (!captured.left || !captured.right || !action)
        throw new Error('Provider command or root APIs unavailable');
      if (!captured.leftRefresh || !captured.rightRefresh)
        throw new Error('Provider alias refresh unavailable');
      const leftContext = createMockCommandContext({
        runtimeApi: captured.left,
        refreshProviderAliases: captured.leftRefresh,
      });
      const rightContext = createMockCommandContext({
        runtimeApi: captured.right,
        refreshProviderAliases: captured.rightRefresh,
      });
      leftContext.services.config = composeFixtureRuntime(
        firstCallerConfig,
        a,
        firstCallerSettingsOwner,
      );
      rightContext.services.config = composeFixtureRuntime(
        secondCallerConfig,
        b,
        secondCallerSettingsOwner,
      );
      const initialLeft = new Set(captured.left.listProviders());
      const initialRight = new Set(captured.right.listProviders());
      firstCallerSettingsOwner.chooseModel('left-before-save');
      secondCallerSettingsOwner.chooseModel('right-before-save');
      expect(captured.left.providerStatus().modelName).toBe('left-before-save');
      expect(captured.right.providerStatus().modelName).toBe(
        'right-before-save',
      );
      const [leftSaved, rightSaved] = await Promise.all([
        Promise.resolve().then(() => action(leftContext, 'save left-owned')),
        Promise.resolve().then(() => action(rightContext, 'save right-owned')),
      ]);
      expect(leftSaved).toMatchObject({ messageType: 'info' });
      expect(rightSaved).toMatchObject({ messageType: 'info' });
      expect(new Set(firstManager.listProviders())).toStrictEqual(
        new Set([...initialLeft, 'left-owned']),
      );
      expect(new Set(secondManager.listProviders())).toStrictEqual(
        new Set([...initialRight, 'left-owned', 'right-owned']),
      );
      expect(captured.left.listProviders()).not.toContain('right-owned');
      expect(captured.left.listProviders()).toContain('left-owned');
      expect(captured.right.listProviders()).toContain('right-owned');
      firstCallerSettingsOwner.chooseModel('left-after-save');
      secondCallerSettingsOwner.chooseModel('right-after-save');
      expect(captured.left.providerStatus().modelName).toBe('left-after-save');
      expect(captured.right.providerStatus().modelName).toBe(
        'right-after-save',
      );
      left.unmount();
      await a.dispose();
      await firstCallerConfig.dispose();
      await firstCallerClose();
      const afterDispose = await action(
        rightContext,
        'save right-after-dispose',
      );
      expect(afterDispose).toMatchObject({ messageType: 'info' });
      expect(secondManager.listProviders()).toContain('right-after-dispose');
      expect(captured.right.listProviders()).toContain('right-after-dispose');
      secondCallerSettingsOwner.chooseModel('right-after-dispose');
      expect(captured.right.providerStatus().modelName).toBe(
        'right-after-dispose',
      );
      expect(firstManager.listProviders()).not.toContain('right-after-dispose');
    } finally {
      right.unmount();
      await b.dispose();
      await secondCallerConfig.dispose();
      await secondCallerClose();
      if (previousDataHome === undefined)
        delete process.env['LLXPRT_DATA_HOME'];
      else process.env['LLXPRT_DATA_HOME'] = previousDataHome;
      if (previousFakeResponses === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousFakeResponses;
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
