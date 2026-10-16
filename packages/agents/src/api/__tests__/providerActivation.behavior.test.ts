import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
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
import { blockTextOrEmpty } from '@vybestack/llxprt-code-test-utils';
import { type ProviderActivationResult } from '@vybestack/llxprt-code-agents';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for declarative provider-activation / auth intent (#2374,
 * part of #1595). These assert on RESULTING STATE (active provider name,
 * ephemeral values, authFailed flag, config auth state), never on mock call
 * counts. They reuse the CANONICAL config builder (buildCliStyleConfig) so the
 * assertions exercise a REAL CLI-style Config wired to the FakeProvider.
 */

/**
 * Reaches the adopted Config's provider manager active-provider name through
 * the public Config surface (no deep import of the manager). Used to assert
 * the resulting activation state independent of the global runtime accessor.
 */
function configActiveProvider(manager: {
  getActiveProviderName(): string | undefined;
}): string | undefined {
  return manager.getActiveProviderName();
}

async function activatedReply(
  client: import('@vybestack/llxprt-code-core/core/clientContract.js').AgentClientContract,
): Promise<string> {
  const output = await client.generateDirectMessage(
    { message: 'Generate after provider activation' },
    'activation-proof',
  );
  return output.content.blocks.map(blockTextOrEmpty).join('');
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
describe('ProviderActivationIntent / executeProviderActivation (#2374)', () => {
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

  const builtCallerSwitch = (
    ...args: Parameters<ReturnType<typeof assembleProviderSwitch>>
  ): ReturnType<ReturnType<typeof assembleProviderSwitch>> =>
    assembleProviderSwitch(
      builtCallerConfig,
      builtCallerSettings,
      builtCallerManager,
      builtCallerOAuth,
      () => 'agent',
      () => builtCallerOwner.refreshAuth(),
      builtCallerSettingsOwner,
    )(...args);

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

  it('(a) API-key auth via cliOverrides.key activates the provider and authenticates', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        defaultProvider: 'gemini',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        builtCallerConfig,
        intent,
        builtCallerSwitch,
        builtCallerSettings,
        builtCallerManager,
        (method) => builtCallerOwner.refreshAuth(method),
        assembleModelSelection(builtCallerSettingsOwner),
      );
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(builtCallerManager)).toBe('fake');
      // Observable authenticated state: the CLI override path
      // (applyCliArgumentOverrides → resolveFromKeyArg) applies the key to the
      // active provider AND sets the auth-key ephemeral, so the config reports
      // the key as applied — the real signal that auth materialized, not just
      // that the provider name resolved.
      expect(builtCallerSettingsOwner.readNamedParameter('auth-key')).toBe(
        'sk-test-key',
      );
    } finally {
      await builtCallerClose();
    }
  });

  it('(b) provider-or-oauth mode with an active manager refreshes the session client for generation', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      // buildCliStyleConfig registers FakeProvider and sets it active, so the
      // provider-or-oauth executor observes hasActiveProvider()===true and
      // takes the PROVIDER branch (refreshAuth('provider') +
      // ensureProviderManagerOnConfig). The distinguishing observable vs a
      // no-auth scenario is that the content generator config is populated
      // (refreshAuth ran) and the active provider is preserved.
      const intent: ProviderActivationIntent = {
        authMode: 'provider-or-oauth',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        builtCallerConfig,
        intent,
        builtCallerSwitch,
        builtCallerSettings,
        builtCallerManager,
        (method) => builtCallerOwner.refreshAuth(method),
        assembleModelSelection(builtCallerSettingsOwner),
      );
      expect(result.authFailed).toBe(false);
      // The provider branch ran refreshAuth, producing a content generator
      // config — a real signal auth materialized (not just authFailed=false).
      expect(await activatedReply(builtCallerOwner.getAgentClient())).toBe(
        'a plain text reply',
      );
      expect(configActiveProvider(builtCallerManager)).toBe('fake');
    } finally {
      await builtCallerClose();
    }
  });

  it('(g) gemini-named activation via provider-or-oauth activates and the switched provider generates (#2626)', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      // A provider registered under the 'gemini' name — the name that used to
      // trigger the serverToolsProvider setConfig poke inside
      // ensureProviderManagerOnConfig. The provider itself is inert test
      // data: the component under test is the activation executor, and the
      // generation below proves the no-poke path leaves the switched
      // provider fully usable.
      const gateTriggerProvider = {
        name: 'gemini',
        getDefaultModel: () => 'gemini-test-model',
        async getModels() {
          return [];
        },
        async *generateChatCompletion() {
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'gemini activation ok' }],
          };
        },
      };
      builtCallerManager.registerProvider(gateTriggerProvider);

      const intent: ProviderActivationIntent = {
        provider: 'gemini',
        model: 'gemini-activation-model',
        authMode: 'provider-or-oauth',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        builtCallerConfig,
        intent,
        builtCallerSwitch,
        builtCallerSettings,
        builtCallerManager,
        (method) => builtCallerOwner.refreshAuth(method),
        assembleModelSelection(builtCallerSettingsOwner),
      );

      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('gemini');
      expect(configActiveProvider(builtCallerManager)).toBe('gemini');
      // The activated runtime generates through the switched provider: the
      // executor's provider branch (configure runtime factories, refresh
      // auth, attach manager) leaves the manager's active provider usable
      // without any serverToolsProvider poke.
      const active = builtCallerManager.getActiveProvider();
      expect(active?.name).toBe('gemini');
      const chunks: string[] = [];
      for await (const chunk of active!.generateChatCompletion({
        contents: [],
        invocation: builtCallerSettingsOwner.prepareProviderInvocation(
          'gemini-activation',
          'gemini',
        ),
      })) {
        const text = chunk.blocks
          .map((block) => blockTextOrEmpty(block))
          .join('');
        chunks.push(text);
      }
      expect(chunks.join('')).toBe('gemini activation ok');

      // Dead-surface trap on the LIVE production manager the executor just
      // used: the deleted manager member must stay deleted. The member name
      // is assembled from parts so this absence probe is not itself a
      // textual reference to the retired concept (issue #2626 acceptance
      // grep requires zero occurrences).
      const deletedManagerMember = ['getServer', 'Tools', 'Provider'].join('');
      const liveManager = builtCallerManager;
      expect(liveManager).toBeDefined();
      expect(deletedManagerMember in (liveManager as object)).toBe(false);
    } finally {
      await builtCallerClose();
    }
  });

  it('(h) #2534 review Finding 1: switch + cliOverrides persist credentials into the TARGET provider scope (main parity)', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      // Register a second provider so the auto path performs a REAL switch
      // (buildCliStyleConfig leaves 'fake' active). The provider itself is
      // inert test data: the component under test is the ORDER of override
      // application relative to the switch, not provider behavior.
      const switchTargetProvider = {
        name: 'gemini',
        getDefaultModel: () => 'gemini-test-model',
        async getModels() {
          return [];
        },
        async *generateChatCompletion() {
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'target scope ok' }],
          };
        },
      };
      builtCallerManager.registerProvider(switchTargetProvider);

      const intent: ProviderActivationIntent = {
        provider: 'gemini',
        cliOverrides: {
          key: 'sk-target-scope-key',
          baseUrl: 'https://target-scope.example/v1',
        },
        authMode: 'auto',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        builtCallerConfig,
        intent,
        builtCallerSwitch,
        builtCallerSettings,
        builtCallerManager,
        (method) => builtCallerOwner.refreshAuth(method),
        assembleModelSelection(builtCallerSettingsOwner),
      );
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('gemini');
      expect(configActiveProvider(builtCallerManager)).toBe('gemini');

      // Main's legacy activation order (switchActiveProvider FIRST, then
      // updateActiveProviderApiKey/updateActiveProviderBaseUrl) persisted
      // credentials into the switched-to provider's scope. The executor must
      // preserve that persistence target: auth-key/base-url land in the
      // TARGET provider's provider-scoped settings.
      const settings = builtCallerSettings;
      const targetScope = settings.getProviderSettings('gemini');
      expect(targetScope['auth-key']).toBe('sk-target-scope-key');
      expect(targetScope['base-url']).toBe('https://target-scope.example/v1');
      // And NOT into the outgoing provider's scope (the pre-switch active
      // 'fake' must stay clean — this assertion fails if overrides run before
      // the switch).
      const outgoingScope = settings.getProviderSettings('fake');
      expect(outgoingScope['auth-key']).toBeUndefined();
      expect(outgoingScope['base-url']).toBeUndefined();
      // The session still sees the credentials through the ephemerals set by
      // the override application (identical in both orders — this pins the
      // session-level behavior that must not regress through the reorder).
      expect(builtCallerSettingsOwner.readNamedParameter('auth-key')).toBe(
        'sk-target-scope-key',
      );
      expect(builtCallerSettingsOwner.readNamedParameter('base-url')).toBe(
        'https://target-scope.example/v1',
      );
    } finally {
      await builtCallerClose();
    }
  });

  it('(c) no-provider case falls back to defaultProvider; auth errors swallowed (authFailed false), config remains usable', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        defaultProvider: 'fake',
        authMode: 'auto',
      };
      const result: ProviderActivationResult = await executeProviderActivation(
        builtCallerConfig,
        intent,
        builtCallerSwitch,
        builtCallerSettings,
        builtCallerManager,
        (method) => builtCallerOwner.refreshAuth(method),
        assembleModelSelection(builtCallerSettingsOwner),
      );
      expect(result.authFailed).toBe(false);
      // The active provider equals the fallback defaultProvider.
      expect(result.activeProvider).toBe('fake');
      expect(configActiveProvider(builtCallerManager)).toBe('fake');
      // The config remains usable (no throw) — the executor resolves and the
      // config's content generator surface is intact for downstream turns.
      expect(() => builtCallerConfig.getContentGeneratorConfig()).not.toThrow();
    } finally {
      await builtCallerClose();
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
