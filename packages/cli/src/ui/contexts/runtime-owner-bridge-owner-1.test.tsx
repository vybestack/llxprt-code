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
import { OwnerView } from './runtime-owner-bridge-views.fixture.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { render } from 'ink-testing-library';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createRuntimeOwnerFeatures } from '../../runtime/createRuntimeOwnerFeatures.js';
import { createSetCommandForTest } from '../../__tests__/set-command-test-owner.js';
import { createModelCommand } from '../commands/modelCommand.js';
import { keyCommand } from '../commands/keyCommand.js';
import { providerCommand } from '../commands/providerCommand.js';
import { profileCommand } from '../commands/profileCommand.js';
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
  it('runs commands on independently owned APIs even when runtime labels match', async () => {
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
      sessionId: 'same-label',
    });
    const b = await fromConfig({
      settingsOwner: secondCallerSettingsOwner,
      settingsService: secondCallerSettings,
      providerManager: secondCallerManager,
      config: secondCallerConfig,
      messageBus: secondCallerPolicy.session.messageBus,
      mcpRuntime: secondCallerMcp,
      sessionId: 'same-label',
    });
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
        <OwnerView
          label="left"
          onApi={(api) => {
            captured.left = api;
          }}
        />
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
        <OwnerView
          label="right"
          onApi={(api) => {
            captured.right = api;
          }}
        />
      </RuntimeContextProvider>,
    );
    try {
      if (!captured.left || !captured.right)
        throw new Error('Runtime owners unavailable');
      const leftApi = captured.left;
      const rightApi = captured.right;
      const leftSet = createSetCommandForTest(leftApi);
      const rightSet = createSetCommandForTest(rightApi);
      const leftModel = createModelCommand(
        (model) => leftApi.setActiveModel(model),
        async (provider, model) =>
          a.session.recordRecordingEvent({
            type: 'provider_switch',
            provider,
            model,
          }),
      );
      const rightModel = createModelCommand(
        (model) => rightApi.setActiveModel(model),
        async (provider, model) =>
          b.session.recordRecordingEvent({
            type: 'provider_switch',
            provider,
            model,
          }),
      );
      if (!leftModel.action || !rightModel.action)
        throw new Error('Missing bound model actions');
      const leftContext = createMockCommandContext({
        runtimeApi: captured.left,
      });
      const rightContext = createMockCommandContext({
        runtimeApi: captured.right,
      });
      await Promise.all([
        leftSet.action!(leftContext, 'context-limit 17001'),
        rightSet.action!(rightContext, 'context-limit 27002'),
      ]);
      expect(firstCallerSettingsOwner.readNamedParameter('context-limit')).toBe(
        17001,
      );
      expect(
        secondCallerSettingsOwner.readNamedParameter('context-limit'),
      ).toBe(27002);
      await Promise.all([
        leftModel.action(leftContext, 'model-left'),
        rightModel.action(rightContext, 'model-right'),
      ]);
      expect(a.getModel()).toBe('model-left');
      expect(b.getModel()).toBe('model-right');

      if (!keyCommand.action || !providerCommand.action)
        throw new Error('Credential or provider command unavailable');
      await Promise.all([
        keyCommand.action(leftContext, 'key-left'),
        keyCommand.action(rightContext, 'key-right'),
      ]);
      expect(firstCallerSettingsOwner.readNamedParameter('auth-key')).toBe(
        'key-left',
      );
      expect(secondCallerSettingsOwner.readNamedParameter('auth-key')).toBe(
        'key-right',
      );
      const [leftProvider, rightProvider] = await Promise.all([
        providerCommand.action(leftContext, 'fake'),
        providerCommand.action(rightContext, 'fake'),
      ]);
      expect(leftProvider).toMatchObject({
        content: 'Already using provider: fake',
      });
      expect(rightProvider).toMatchObject({
        content: 'Already using provider: fake',
      });

      a.setDefaultProfileName('owner-left');
      b.setDefaultProfileName('owner-right');
      const setDefault = profileCommand.subCommands?.find(
        (command) => command.name === 'set-default',
      );
      if (!setDefault?.action) throw new Error('Profile command unavailable');
      leftContext.services.agent = a;
      rightContext.services.agent = b;
      await setDefault.action(leftContext, 'none');
      expect(captured.left.getDefaultProfileName()).toBeNull();
      expect(captured.right.getDefaultProfileName()).toBe('owner-right');
      await setDefault.action(rightContext, 'none');
      expect(captured.right.getDefaultProfileName()).toBeNull();

      firstCallerSettingsOwner.writeUserParameter('custom-headers', {
        'X-Left': 'one',
      });
      secondCallerSettingsOwner.writeUserParameter('custom-headers', {
        'X-Right': 'two',
      });
      const headerCompleterFor = (command: typeof leftSet) => {
        const unset = command.schema?.find(
          (node) => node.kind === 'literal' && node.value === 'unset',
        );
        if (unset?.kind !== 'literal')
          throw new Error('Unset schema unavailable');
        const keyNode = unset.next?.[0];
        if (keyNode?.kind !== 'value')
          throw new Error('Unset key schema unavailable');
        const headerNode = keyNode.next?.[0];
        if (headerNode?.kind !== 'value' || !headerNode.completer)
          throw new Error('Header completer unavailable');
        return headerNode.completer;
      };
      const leftCompleter = headerCompleterFor(leftSet);
      const rightCompleter = headerCompleterFor(rightSet);
      const tokens = {
        tokens: ['unset', 'custom-headers'],
        partialToken: 'X-',
        hasTrailingSpace: false,
        position: 2,
      };
      const [leftHeaders, rightHeaders] = await Promise.all([
        leftCompleter(leftContext, 'X-', tokens),
        rightCompleter(rightContext, 'X-', tokens),
      ]);
      expect(leftHeaders.map((header) => header.value)).toStrictEqual([
        'X-Left',
      ]);
      expect(rightHeaders.map((header) => header.value)).toStrictEqual([
        'X-Right',
      ]);
    } finally {
      left.unmount();
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
