import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../../../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
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
  ModelEventView,
} from './runtime-owner-bridge-views.fixture.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
import { act } from 'react';
import { render } from 'ink-testing-library';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { SessionController } from '../containers/SessionController.js';
import { createRuntimeOwnerFeatures } from '../../runtime/createRuntimeOwnerFeatures.js';
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

  const firstCredentials = useOwnedCredentials();

  const secondCredentials = useOwnedCredentials();

  afterFixtureTest(() => {
    fixtureFilesystem = undefined;
  });
  it('keeps two mounted roots with identical runtime labels independent across updates and unmounts', async () => {
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
    const firstCallerTokenizer = configureProviderTokenizer(firstCallerManager);
    const firstCallerContent = createRuntimeContentGeneratorFactory();
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
      undefined,
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
        undefined,
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
    const secondCallerTokenizer =
      configureProviderTokenizer(secondCallerManager);
    const secondCallerContent = createRuntimeContentGeneratorFactory();
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
      undefined,
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
        undefined,
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
      sessionId: 'shared-bridge-label',
    });
    const b = await fromConfig({
      settingsOwner: secondCallerSettingsOwner,
      settingsService: secondCallerSettings,
      providerManager: secondCallerManager,
      config: secondCallerConfig,
      messageBus: secondCallerPolicy.session.messageBus,
      mcpRuntime: secondCallerMcp,
      sessionId: 'shared-bridge-label',
    });
    firstCallerSettingsOwner.writeUserParameter('bridge-owner-key', 'first');
    secondCallerSettingsOwner.writeUserParameter('bridge-owner-key', 'second');
    firstCallerSettingsOwner.chooseModel('first-model');
    secondCallerSettingsOwner.chooseModel('second-model');
    const captured: { left?: RuntimeApi; right?: RuntimeApi } = {};
    const left = render(
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
        <SessionController
          config={composeFixtureRuntime(
            firstCallerConfig,
            a,
            firstCallerSettingsOwner,
          )}
        >
          <OwnerView
            label="left"
            onApi={(api) => {
              captured.left = api;
            }}
          />
          <ModelEventView />
        </SessionController>
      </RuntimeContextProvider>,
    );
    const right = render(
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
        <SessionController
          config={composeFixtureRuntime(
            secondCallerConfig,
            b,
            secondCallerSettingsOwner,
          )}
        >
          <OwnerView
            label="right"
            onApi={(api) => {
              captured.right = api;
            }}
          />
          <ModelEventView />
        </SessionController>
      </RuntimeContextProvider>,
    );
    try {
      expect(left.lastFrame()).toContain('left:fake:first-model:first');
      expect(right.lastFrame()).toContain('right:fake:second-model:second');
      if (!captured.left || !captured.right)
        throw new Error('Root callbacks unavailable');
      await captured.left.setActiveToolFormatOverride('openai');
      await captured.right.setActiveToolFormatOverride('kimi');
      expect((await captured.left.getActiveToolFormatState()).override).toBe(
        'openai',
      );
      expect((await captured.right.getActiveToolFormatState()).override).toBe(
        'kimi',
      );
      firstCallerSettingsOwner.chooseModel('first-event-model');
      secondCallerSettingsOwner.chooseModel('second-event-model');
      act(() => {
        firstCallerSettingsOwner.publishModelProfile({
          model: 'first-event-model',
          displayLabel: 'first-event-model',
        });
        secondCallerSettingsOwner.publishModelProfile({
          model: 'second-event-model',
          displayLabel: 'second-event-model',
        });
      });
      expect(left.lastFrame()).toContain('event-model:fake:first-event-model');
      expect(right.lastFrame()).toContain(
        'event-model:fake:second-event-model',
      );
      left.unmount();
      expect(
        (await captured.right.getActiveToolFormatState()).currentFormat,
      ).toBe('kimi');
      secondCallerSettingsOwner.chooseModel('updated-model');
      act(() =>
        secondCallerSettingsOwner.publishModelProfile({
          model: 'updated-model',
          displayLabel: 'updated-model',
        }),
      );
      right.rerender(
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
          <SessionController
            config={composeFixtureRuntime(
              secondCallerConfig,
              b,
              secondCallerSettingsOwner,
            )}
          >
            <OwnerView label="right" />
            <ModelEventView />
          </SessionController>
        </RuntimeContextProvider>,
      );
      expect(right.lastFrame()).toContain('right:fake:updated-model:second');
      expect(right.lastFrame()).toContain('event-model:fake:updated-model');
    } finally {
      right.unmount();
      await a.dispose();
      await b.dispose();
      await firstCallerConfig.dispose();
      await secondCallerConfig.dispose();
      await firstCallerClose();
      await secondCallerClose();
    }
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
