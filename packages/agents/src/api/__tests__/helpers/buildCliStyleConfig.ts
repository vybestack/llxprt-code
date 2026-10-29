/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Config,
  type ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import type { AgentConfig, AgentSchedulerFactory } from '../../config-types.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import { assembleModelSelection } from '../../model-selection.js';
import { preparePreferredProviderCompletion } from '../../preferred-provider-acquisition.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../core/subagent-cleanup.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { createCapturedSessionOwner } from './session-client-capture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from './provider-acquisition.js';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';
import { stripSandboxSegment } from './fixtureRoot.js';
export { buildTestMcpRuntime } from './mcp-owner-fixture.js';
export { createTerminalOnlyIdePort } from './terminal-only-ide.js';
import type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
export type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
export interface ComparableEvent {
  readonly type: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly doneReason?: DoneReason;
}
export function projectToComparable(event: AgentEvent): ComparableEvent {
  switch (event.type) {
    case 'tool-call':
      return { type: event.type, toolName: event.call.name };
    case 'tool-result':
      return {
        type: event.type,
        toolName: event.result.name,
        ...(event.result.isError !== undefined
          ? { isError: event.result.isError }
          : {}),
      };
    case 'done':
      return { type: event.type, doneReason: event.reason };
    case 'error':
      return { type: event.type, isError: true };
    default:
      return { type: event.type };
  }
}
export function projectEvents(
  events: readonly AgentEvent[],
): readonly ComparableEvent[] {
  return events.map(projectToComparable);
}
export type { Config } from '@vybestack/llxprt-code-core/config/config.js';
export type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

const harnessDir = stripSandboxSegment(
  fileURLToPath(new URL('.', import.meta.url)),
);
export const fixturesDir = resolve(harnessDir, '..', 'fixtures');

export interface CallerAgentRuntimeFactories {
  readonly agentClientFactory?: AgentClientFactory;
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
  readonly taskToolRegistration?: TaskToolRegistration;
}

function selectResponses(fixture: string): () => void {
  const previous = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = resolve(fixturesDir, fixture);
  return () => {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  };
}

function createConfig(
  overrides: Readonly<Partial<AgentConfig>>,
  settings: Pick<
    ConfigParameters,
    'storageRoot' | 'enableExtensionReloading'
  > = {},
): Config {
  return new Config({
    ...toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      workingDir: resolve(harnessDir, '..'),
      ...overrides,
    }),
    ...settings,
  });
}

function seedSettings(config: Config): SettingsService {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  return settings;
}

export async function buildFactoryLessConfig(
  fixture: string,
  callerFactories: Readonly<CallerAgentRuntimeFactories> = {},
  overrides: Readonly<Partial<AgentConfig>> = {},
) {
  const restore = selectResponses(fixture);
  const config = createConfig(overrides);
  const settingsService = seedSettings(config);
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  const policyOwner = new RuntimePolicyOwner(config);
  return {
    config,
    settingsService,
    settingsOwner,
    policyOwner,
    messageBus: policyOwner.session.messageBus,
    callerFactories,
    cleanup: async (): Promise<void> => {
      try {
        await runCleanupSteps([
          () => settingsOwner.dispose(),
          () => policyOwner.dispose(),
          () => config.dispose(),
        ]);
      } finally {
        restore();
      }
    },
  };
}
export type BuiltFactoryLessConfig = Awaited<
  ReturnType<typeof buildFactoryLessConfig>
>;

async function openFixtureStack(
  fixture: string,
  overrides: Readonly<Partial<AgentConfig>> = {},
  skillSettings: Pick<
    ConfigParameters,
    'storageRoot' | 'enableExtensionReloading'
  > = {},
  extensionLoader?: ExtensionLoader,
  skillOperations?: WorkspaceSkillAssemblyOperations,
) {
  const restore = selectResponses(fixture);
  const config = createConfig(overrides, skillSettings);
  const settingsService = seedSettings(config);
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  settingsOwner.bindTelemetry(config);
  const policyOwner = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policyOwner.session.confirmation);
  const messageBus = policyOwner.session.messageBus;
  const release = new AcquisitionRelease();
  release.acquire('settings', () => settingsOwner.dispose());
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  const runtimeId = `cli-config-${randomUUID()}`;
  for (const scope of [runtimeId, config.getSessionId()])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
  const authority = overrides.credentialAuthority ?? new CredentialAuthority();
  const providerManager = acquirePreferredProviderManager(
    config,
    settingsService,
    settingsOwner,
    files,
    runtimeId,
    authority,
    release,
  );
  const mcpRuntime = await buildTestMcpRuntime(
    config,
    messageBus,
    overrides,
    extensionLoader,
    policyOwner,
    skillOperations,
  );
  const oauthManager = acquirePreferredOAuth(
    undefined,
    messageBus,
    config,
    settingsService,
    providerManager,
    runtimeId,
    mcpRuntime.profileDefinitions,
    authority,
    release,
    undefined,
  );
  return {
    config,
    settingsService,
    settingsOwner,
    policyOwner,
    messageBus,
    release,
    files,
    runtimeId,
    authority,
    providerManager,
    mcpRuntime,
    oauthManager,
    restore,
  };
}

type FixtureStack = Awaited<ReturnType<typeof openFixtureStack>>;

async function openFixtureClient(
  stack: FixtureStack,
  overrides: Readonly<Partial<AgentConfig>>,
  suppliedFactories: Readonly<CallerAgentRuntimeFactories>,
) {
  const {
    config,
    settingsService,
    settingsOwner,
    providerManager,
    mcpRuntime,
    oauthManager,
    files,
    messageBus,
  } = stack;
  const tokenizerFactory = configureProviderTokenizer(providerManager);
  const contentGeneratorFactory =
    overrides.contentGeneratorFactory ?? createRuntimeContentGeneratorFactory();
  const media = new SessionMediaOwner(
    config.projectTempDir,
    1024 * 1024 * 1024,
  );
  const sessionClient = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settingsService),
    providerManager,
    suppliedFactories.agentClientFactory ?? buildAgentClientFactory(),
    media.store,
    mcpRuntime.readInstructions,
    mcpRuntime.workspacePaths,
    settingsOwner,
    contentGeneratorFactory,
    tokenizerFactory,
    messageBus,
  );
  sessionClient.bindMcpRuntime(mcpRuntime);
  sessionClient.clients.bindProviderFiles(files, (provider) =>
    oauthManager.composeRetryOperations(provider),
  );
  sessionClient.bindHooks();
  const switchProvider = assembleProviderSwitch(
    config,
    settingsService,
    providerManager,
    oauthManager,
    () => 'agent',
    () => sessionClient.clients.refreshAuth(),
    settingsOwner,
  );
  return {
    sessionClient,
    switchProvider,
    tokenizerFactory,
    contentGeneratorFactory,
    media,
  };
}

async function activateFixture(
  stack: FixtureStack,
  client: Awaited<ReturnType<typeof openFixtureClient>>,
  activation: AgentConfig['activation'],
  cleanup: () => Promise<void>,
): Promise<void> {
  const {
    config,
    settingsService,
    settingsOwner,
    providerManager,
    oauthManager,
    runtimeId,
    mcpRuntime,
  } = stack;
  const { sessionClient, switchProvider, tokenizerFactory } = client;
  try {
    await preparePreferredProviderCompletion(
      config,
      settingsService,
      settingsOwner,
      providerManager,
      oauthManager,
      runtimeId,
      tokenizerFactory,
      undefined,
      process.env.LLXPRT_FAKE_RESPONSES,
    );
    await mcpRuntime.initialize();
    const result = await executeProviderActivation(
      config,
      activation ?? {
        provider: config.getProvider(),
        model: config.getModel(),
      },
      switchProvider,
      settingsService,
      providerManager,
      (method) => sessionClient.clients.refreshAuth(method),
      assembleModelSelection(settingsOwner),
    );
    if (result.authFailed) throw result.authError;
    await sessionClient.initializeTools();
    await sessionClient.clients.getAgentClient().startChat();
  } catch (error) {
    await cleanupAfterFailure(error, cleanup);
  }
}

function projectFixture(
  stack: FixtureStack,
  client: Awaited<ReturnType<typeof openFixtureClient>>,
  cleanup: () => Promise<void>,
) {
  const {
    config,
    settingsService,
    settingsOwner,
    policyOwner,
    messageBus,
    mcpRuntime,
    providerManager,
    runtimeId,
    oauthManager,
    files,
  } = stack;
  const {
    sessionClient,
    switchProvider,
    contentGeneratorFactory,
    tokenizerFactory,
  } = client;
  return {
    config,
    settingsService,
    settingsOwner,
    policyOwner,
    messageBus,
    mcpRuntime,
    sessionClient,
    providerManager,
    switchProvider,
    cleanup,
    get agentClient() {
      return sessionClient.clients.getAgentClient();
    },
    runtime: {
      runtimeId,
      providerManager,
      settingsOwner,
      oauthManager,
      providerFileLifecycle: files,
      readRuntimeKind: (): 'agent' => 'agent',
      contentGeneratorFactory,
      tokenizerFactory,
    },
  };
}

export async function buildCliStyleConfig(
  fixture: string,
  overrides: Readonly<Partial<AgentConfig>> = {},
  suppliedFactories: Readonly<CallerAgentRuntimeFactories> = {},
  skillSettings: Pick<
    ConfigParameters,
    'storageRoot' | 'enableExtensionReloading'
  > = {},
  extensionLoader?: ExtensionLoader,
  skillOperations?: WorkspaceSkillAssemblyOperations,
) {
  const stack = await openFixtureStack(
    fixture,
    overrides,
    skillSettings,
    extensionLoader,
    skillOperations,
  );
  const { config, policyOwner, release, mcpRuntime, restore } = stack;
  const {
    sessionClient,
    switchProvider,
    tokenizerFactory,
    contentGeneratorFactory,
    media,
  } = await openFixtureClient(stack, overrides, suppliedFactories);
  const cleanup = async (): Promise<void> => {
    try {
      await runCleanupSteps([
        () => sessionClient.dispose(),
        () => release.close(),
        () => media.dispose(),
        () => mcpRuntime.dispose(),
        () => policyOwner.dispose(),
        () => config.dispose(),
      ]);
    } finally {
      restore();
    }
  };
  await activateFixture(
    stack,
    {
      sessionClient,
      switchProvider,
      tokenizerFactory,
      contentGeneratorFactory,
      media,
    },
    overrides.activation,
    cleanup,
  );
  return projectFixture(
    stack,
    {
      sessionClient,
      switchProvider,
      contentGeneratorFactory,
      tokenizerFactory,
      media,
    },
    cleanup,
  );
}

export type BuiltCliConfig = Awaited<ReturnType<typeof buildCliStyleConfig>>;
