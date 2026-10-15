import { FileOAuthSettingsProvider } from '../../../../providers/src/auth/file-oauth-settings.js';
import {
  createOwnerOAuthManager,
  configureProviderRuntimeFactories,
  createOwnedTokenStoreClose,
  createSessionAuthPolicyReader,
  createOwnerAuthCacheInvalidator,
} from '@vybestack/llxprt-code-providers/composition.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../../../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
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
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { useEffect } from 'react';
import { Text } from 'ink';
import { Colors } from '../colors.js';
import { render } from 'ink-testing-library';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createOAuthControl } from '../../runtime/createOAuthControl.js';
import {
  OAuthControlProvider,
  useOAuthControl,
} from './OAuthControlContext.js';
import { createAuthCommand } from '../commands/authCommand.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

installTestWorkspaceFilesystem();

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

  const firstCredentials = useOwnedCredentials();

  const secondCredentials = useOwnedCredentials();

  afterFixtureTest(() => {});
  it('isolates interleaved OAuth auth status in two same-label roots after one owner is disposed', async () => {
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
    await writeFile(
      join(firstCallerDirectory, 'oauth-settings.json'),
      JSON.stringify({ oauthEnabledProviders: {} }),
    );
    const firstCallerTokens = firstCredentials().authority.createTokenStore();
    firstCallerRelease.acquire(
      'tokens',
      createOwnedTokenStoreClose(firstCallerTokens),
    );
    const firstCallerOAuth = createOwnerOAuthManager(
      firstCallerTokens,
      new FileOAuthSettingsProvider(
        join(firstCallerDirectory, 'oauth-settings.json'),
      ),
      firstCallerPolicy.session.messageBus,
      firstCallerMcp.profileDefinitions,
      createSessionAuthPolicyReader(firstCallerSettings),
      () => ({ runtimeId: firstCallerRuntimeId, runtimeKind: 'agent' }),
      undefined,
      createOwnerAuthCacheInvalidator((name) =>
        firstCallerManager.getProviderByName(name),
      ),
      (input, init) => firstCallerManager.fetchNetwork(input, init),
    );
    firstCallerRelease.acquire('oauth', () => firstCallerOAuth.dispose());
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
    const firstCallerClose = settleEngineRelease.bind(
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
    await writeFile(
      join(secondCallerDirectory, 'oauth-settings.json'),
      JSON.stringify({ oauthEnabledProviders: {} }),
    );
    const secondCallerTokens = secondCredentials().authority.createTokenStore();
    secondCallerRelease.acquire(
      'tokens',
      createOwnedTokenStoreClose(secondCallerTokens),
    );
    const secondCallerOAuth = createOwnerOAuthManager(
      secondCallerTokens,
      new FileOAuthSettingsProvider(
        join(secondCallerDirectory, 'oauth-settings.json'),
      ),
      secondCallerPolicy.session.messageBus,
      secondCallerMcp.profileDefinitions,
      createSessionAuthPolicyReader(secondCallerSettings),
      () => ({ runtimeId: secondCallerRuntimeId, runtimeKind: 'agent' }),
      undefined,
      createOwnerAuthCacheInvalidator((name) =>
        secondCallerManager.getProviderByName(name),
      ),
      (input, init) => secondCallerManager.fetchNetwork(input, init),
    );
    secondCallerRelease.acquire('oauth', () => secondCallerOAuth.dispose());
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
    const secondCallerClose = settleEngineRelease.bind(
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
      sessionId: 'shared-oauth-label',
    });
    const b = await fromConfig({
      settingsOwner: secondCallerSettingsOwner,
      settingsService: secondCallerSettings,
      providerManager: secondCallerManager,
      config: secondCallerConfig,
      messageBus: secondCallerPolicy.session.messageBus,
      mcpRuntime: secondCallerMcp,
      sessionId: 'shared-oauth-label',
    });
    const captured: {
      left?: ReturnType<typeof createOAuthControl>;
      right?: ReturnType<typeof createOAuthControl>;
    } = {};
    function OAuthView({
      side,
    }: {
      side: 'left' | 'right';
    }): React.JSX.Element {
      const control = useOAuthControl();
      useEffect(() => {
        captured[side] = control;
      }, [control, side]);
      return <Text color={Colors.Foreground}>oauth:{side}</Text>;
    }
    const left = render(
      <OAuthControlProvider
        control={createOAuthControl(() => firstCallerOAuth, a.providerManager)}
      >
        <OAuthView side="left" />
      </OAuthControlProvider>,
    );
    const right = render(
      <OAuthControlProvider
        control={createOAuthControl(() => secondCallerOAuth, b.providerManager)}
      >
        <OAuthView side="right" />
      </OAuthControlProvider>,
    );
    try {
      if (!captured.left || !captured.right)
        throw new Error('OAuth root unavailable');
      const leftControl = captured.left;
      const rightControl = captured.right;
      const initialLeft = await leftControl.getAuthStatus();
      const initialRight = await rightControl.getAuthStatus();
      expect(initialLeft).toStrictEqual(initialRight);
      const [enabledLeft, enabledRight] = await Promise.all([
        leftControl.toggleOAuthEnabled('codex'),
        rightControl.toggleOAuthEnabled('claudecode'),
      ]);
      expect(enabledLeft).toBe(true);
      expect(enabledRight).toBe(true);
      const [leftStatus, rightStatus] = await Promise.all([
        leftControl.getAuthStatus(),
        rightControl.getAuthStatus(),
      ]);
      expect(
        leftStatus.find((status) => status.provider === 'codex')?.oauthEnabled,
      ).toBe(true);
      expect(
        leftStatus.find((status) => status.provider === 'claudecode')
          ?.oauthEnabled,
      ).not.toBe(true);
      expect(
        rightStatus.find((status) => status.provider === 'claudecode')
          ?.oauthEnabled,
      ).toBe(true);
      expect(
        rightStatus.find((status) => status.provider === 'codex')?.oauthEnabled,
      ).not.toBe(true);
      const rightContext = createMockCommandContext({
        oauthControl: rightControl,
      });
      Object.defineProperty(rightContext, 'runtimeApi', {
        get: () => {
          throw new Error(
            'OAuth status must not resolve a generic runtime API',
          );
        },
      });
      const authCommand = createAuthCommand(rightControl);
      if (!authCommand.action) throw new Error('Auth command unavailable');
      const statusResult = await authCommand.action(rightContext, 'claudecode');
      expect(statusResult).toMatchObject({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('ENABLED'),
      });
      expect(JSON.stringify(statusResult)).not.toContain('access_token');
      expect(JSON.stringify(leftStatus)).not.toContain('access_token');
      expect(JSON.stringify(rightStatus)).not.toContain('access_token');
      left.unmount();
      await a.dispose();
      await firstCallerConfig.dispose();
      await firstCallerClose();
      const statusAfterDisposal = await rightControl.getAuthStatus();
      expect(
        statusAfterDisposal.find((status) => status.provider === 'claudecode')
          ?.oauthEnabled,
      ).toBe(true);
      expect(
        statusAfterDisposal.find((status) => status.provider === 'codex')
          ?.oauthEnabled,
      ).not.toBe(true);
    } finally {
      right.unmount();
      await b.dispose();
      await secondCallerConfig.dispose();
      await secondCallerClose();
    }
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
