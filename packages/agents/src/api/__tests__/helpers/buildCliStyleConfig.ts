import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ProviderActivationIntent } from '../../config-types.js';
import { assembleModelSelection } from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';

import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import type { AgentRuntimeFactoryBindings } from '../../runtimeFactories.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { AgentSchedulerFactory } from '../../config-types.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { SessionClientOwner } from '../../../session/session-client-owner.js';
import { createAgentRuntimeFactoryBindings } from '../../runtimeFactories.js';
import { NodeFileSystem } from '@vybestack/llxprt-code-providers/composition.js';

import {
  MCPOAuthTokenStorage,
  type McpOAuthBinding,
  type OAuthCredentials,
} from '@vybestack/llxprt-code-mcp';

import { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';

/**
 * @plan:PLAN-20260621-COREAPIREMED.P07
 * @requirement:REQ-INT-001,REQ-INT-002
 *
 * Shared real FakeProvider fixture for reference loops and facade adoption.
 * The caller retains explicit Config, manager, client owner, MCP and media
 * lifetimes. Its current-client getter follows session owner replacements.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { Config as ConfigType } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  createIsolatedRuntimeContext,
  type IsolatedRuntimeContextHandle,
} from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { createProviderManager } from '@vybestack/llxprt-code-providers/composition.js';
import { stripSandboxSegment } from './fixtureRoot.js';
import {
  toConfigParameters,
  executeProviderActivation,
} from '@vybestack/llxprt-code-agents';
import type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import type { AgentConfig } from '../../config-types.js';

const HARNESS_DIR = stripSandboxSegment(
  fileURLToPath(new URL('.', import.meta.url)),
);
const FIXTURES_DIR = resolve(HARNESS_DIR, '..', 'fixtures');

// ─── Public projection helpers (REQ-INT-002 parity) ─────────────────────────

/**
 * The public-comparable projection of an AgentEvent: only the fields that
 * matter for turn-parity (kind/type, tool name, isError, terminal done reason).
 * Internal fields (prompt_id, traceId) are NEVER included — R-PROJECT (#1594).
 */
export interface ComparableEvent {
  readonly type: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly doneReason?: DoneReason;
}

/**
 * Projects an AgentEvent to its public-comparable form. Uses the event's
 * discriminated `.type` to extract the parity-relevant fields only.
 */
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

/** Projects an array of AgentEvents to their comparable forms. */
export function projectEvents(
  events: readonly AgentEvent[],
): readonly ComparableEvent[] {
  return events.map(projectToComparable);
}

// ─── Config construction (mirrors createAgent's Config-build path) ──────────

export interface BuiltCliConfig {
  readonly runtime: IsolatedRuntimeContextHandle;
  readonly settingsService: SettingsService;
  readonly switchProvider: ReturnType<typeof assembleProviderSwitch>;
  readonly settingsOwner: IsolatedRuntimeContextHandle['settingsOwner'];
  readonly policyOwner: RuntimePolicyOwner;
  readonly runtimeFactoryBindings: AgentRuntimeFactoryBindings;
  readonly sessionClient: SessionClientOwner;
  readonly agentClient: AgentClientContract;
  readonly providerManager: IsolatedRuntimeContextHandle['providerManager'];
  readonly mcpRuntime: McpRuntimeOwner;
  readonly config: ConfigType;
  readonly messageBus: MessageBus;
  readonly cleanup: () => Promise<void>;
}

/**
 * Builds a REAL Config wired to the FakeProvider via the
 * LLXPRT_FAKE_RESPONSES env seam. Mirrors createAgent's Config-build path
 * (toConfigParameters + agentClientFactory + default toolSchedulerFactory +
 * interactive:true + new Config + isolated runtime + provider registration +
 * initialize + refreshAuth), returning the Config for fromConfig to adopt.
 *
 * @param fixtureRelPath  Fixture JSONL path relative to __tests__/fixtures.
 */
export interface CallerAgentRuntimeFactories {
  readonly toolSchedulerFactory?: AgentSchedulerFactory;
  readonly agentClientFactory?: AgentClientFactory;
  readonly taskToolRegistration?: TaskToolRegistration;
}

export interface BuiltFactoryLessConfig {
  readonly settingsService: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly policyOwner: RuntimePolicyOwner;
  readonly agentClient?: undefined;
  readonly runtimeFactoryBindings: AgentRuntimeFactoryBindings;
  readonly providerManager?: undefined;
  readonly config: ConfigType;
  readonly messageBus: MessageBus;
  readonly cleanup: () => Promise<void>;
}

/**
 * Builds the MINIMAL Config a non-CLI API consumer constructs (issue #3222):
 * toConfigParameters + `new Config(params)` with NO agentClientFactory,
 * NO toolSchedulerFactory, NO taskToolRegistration, and NO runtime
 * activation/initialization — fromConfig owns those steps during adoption.
 * Optionally installs caller-supplied factories so adoption can be observed
 * honoring them (caller-wins), and optionally overrides base AgentConfig
 * fields (e.g. excludeTools) for governance-observation scenarios.
 *
 * The FakeProvider env seam stays set until cleanup so the turn driven after
 * adoption uses the fixture. Because fromConfig ADOPTS the Config
 * (caller-owned), agent.dispose() skips it — cleanup() disposes the Config
 * itself (safe even when adoption failed before initialization).
 */
export async function buildFactoryLessConfig(
  fixtureRelPath: string,
  callerFactories: Readonly<CallerAgentRuntimeFactories> = {},
  baseConfigOverrides: Readonly<Partial<AgentConfig>> = {},
): Promise<BuiltFactoryLessConfig> {
  const prev = selectFixtureResponses(fixtureRelPath);

  const baseConfig: AgentConfig = {
    provider: 'fake',
    model: 'fake-model',
    workingDir: resolve(HARNESS_DIR, '..'),
    ...baseConfigOverrides,
  };

  const frozenParams = toConfigParameters(baseConfig);
  const params = { ...frozenParams };
  const taskToolRegistration = callerFactories.taskToolRegistration;
  const runtimeFactoryBindings = {
    ...createAgentRuntimeFactoryBindings(),
    ...(callerFactories.agentClientFactory
      ? { agentClientFactory: callerFactories.agentClientFactory }
      : {}),
    ...(taskToolRegistration
      ? { taskToolRegistration: () => taskToolRegistration }
      : {}),
  };

  try {
    const config = new Config(params);
    const settingsService = seedFixtureSettings(config);
    const settingsOwner = new SessionSettingsOwner(settingsService);
    settingsOwner.bindTelemetry(config);
    settingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    const policyOwner = new RuntimePolicyOwner(config);
    const messageBus = policyOwner.session.messageBus;
    const cleanup = async (): Promise<void> => {
      // Factoryless fixtures own workspace state. Adopted facades close
      // their separately constructed session resources.
      try {
        await settingsOwner.dispose();
        await policyOwner.dispose();
        await config.dispose();
      } finally {
        if (prev === undefined) {
          delete process.env.LLXPRT_FAKE_RESPONSES;
        } else {
          process.env.LLXPRT_FAKE_RESPONSES = prev;
        }
      }
    };
    return {
      config,
      settingsService,
      settingsOwner,
      policyOwner,
      messageBus,
      runtimeFactoryBindings,
      cleanup,
    };
  } catch (error) {
    if (prev === undefined) {
      delete process.env.LLXPRT_FAKE_RESPONSES;
    } else {
      process.env.LLXPRT_FAKE_RESPONSES = prev;
    }
    throw error;
  }
}

async function activateFixtureClient(
  config: ConfigType,
  settingsService: SettingsService,
  handle: IsolatedRuntimeContextHandle,
  sessionClient: SessionClientOwner,
  intent: ProviderActivationIntent = {
    provider: config.getProvider(),
    model: config.getModel(),
  },
): Promise<void> {
  const activation = await executeProviderActivation(
    config,
    intent,
    assembleProviderSwitch(
      config,
      settingsService,
      handle.providerManager,
      handle.oauthManager,
      () => handle.readRuntimeKind(),
      () => sessionClient.refreshAuth(),
      handle.settingsOwner,
    ),
    settingsService,
    handle.providerManager,
    (method) => sessionClient.refreshAuth(method),
    assembleModelSelection(handle.settingsOwner),
  );
  if (activation.authFailed) {
    throw activation.authError;
  }

  await sessionClient.initializeTools();
  await sessionClient.getAgentClient().startChat();
}

async function cleanupSessionFixture(
  config: ConfigType,
  mcp: McpRuntimeOwner,
  sessionClient: SessionClientOwner,
  handle: IsolatedRuntimeContextHandle,
  media: SessionMediaOwner,
  previous: string | undefined,
): Promise<void> {
  const failures: unknown[] = [];
  for (const close of [
    () => sessionClient.dispose(),
    () => mcp.dispose(),
    () => config.dispose(),
    () => cleanupHandle(handle, previous),
    () => media.dispose(),
  ]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Session fixture cleanup failed');
}

function createFixtureRuntime(
  runtimeId: string,
  config: Config,
  messageBus: MessageBus,
  settingsService: SettingsService,
): IsolatedRuntimeContextHandle {
  return createIsolatedRuntimeContext(
    {
      runtimeId,
      config,
      messageBus,
      prepare: (ctx) =>
        registerProvidersOntoManager(ctx.providerManager, ctx, ctx.config),
    },
    settingsService,
  );
}

async function assembleFixtureClient(
  config: Config,
  settings: SettingsService,
  handle: ReturnType<typeof createFixtureRuntime>,
  factories: AgentRuntimeFactoryBindings,
  media: SessionMediaOwner,
  workspace: McpRuntimeOwner,
): Promise<SessionClientOwner> {
  const client = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(settings),
    handle.providerManager,
    factories.agentClientFactory,
    media.store,
    workspace.readInstructions,
    workspace.workspacePaths,
    handle.settingsOwner,
    handle.contentGeneratorFactory,
    handle.tokenizerFactory,
  );
  client.bindMcpRuntime(workspace);
  client.bindProviderFiles(handle.providerFileLifecycle, (provider) =>
    handle.oauthManager.composeRetryOperations(provider),
  );
  client.bindHooks();
  return client;
}

type CliFixtureSkillSettings = Pick<
  ConfigParameters,
  'enableExtensionReloading' | 'storageRoot'
>;

function fixtureFactories(
  supplied: Readonly<Partial<AgentRuntimeFactoryBindings>>,
): AgentRuntimeFactoryBindings {
  return { ...createAgentRuntimeFactoryBindings(), ...supplied };
}

function selectFixtureResponses(fixture: string): string | undefined {
  const previous = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = resolve(FIXTURES_DIR, fixture);
  return previous;
}

export async function buildCliStyleConfig(
  fixtureRelPath: string,
  overrides: Readonly<Partial<AgentConfig>> = {},
  suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
  skillSettings: CliFixtureSkillSettings = {},
  extensionLoader?: ExtensionLoader,
  skillOperations?: WorkspaceSkillAssemblyOperations,
): Promise<BuiltCliConfig> {
  const prev = process.env.LLXPRT_FAKE_RESPONSES;
  const fixturePath = resolve(FIXTURES_DIR, fixtureRelPath);
  process.env.LLXPRT_FAKE_RESPONSES = fixturePath;

  const baseConfig = cliStyleAgentConfig(overrides);
  const runtimeId = `cli-config-${randomUUID()}`;

  // toConfigParameters + factory injection (mirrors createAgent steps 20-27).
  const params = cliStyleConfigParameters(baseConfig, skillSettings);
  if (overrides.hooks !== undefined) params.enableHooks = true;
  params.interactive = true;

  // Construct Config + ONE shared MessageBus (mirrors createAgent steps 30-38).
  includeFixtureCwd(params, overrides);
  const config = new Config(params);
  const mediaOwner = new SessionMediaOwner(
    config.projectTempDir,
    1024 * 1024 * 1024,
  );
  const { policyOwner, messageBus, mcpRuntime } =
    await assembleCliFixtureWorkspace(
      config,
      overrides,
      extensionLoader,
      skillOperations,
    );
  const settingsService = seedFixtureSettings(config);

  // SHARED runtime context — adopts OUR Config/MessageBus (mirrors createAgent
  // steps 41-58). The prepare callback registers providers (including
  // FakeProvider under LLXPRT_FAKE_RESPONSES) onto the isolated manager.
  const handle = createFixtureRuntime(
    runtimeId,
    config,
    messageBus,
    settingsService,
  );

  const runtimeFactoryBindings = fixtureFactories(suppliedFactories);
  handle.settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  const sessionClient = await assembleFixtureClient(
    config,
    settingsService,
    handle,
    runtimeFactoryBindings,
    mediaOwner,
    mcpRuntime,
  );

  const cleanup = (): Promise<void> =>
    cleanupSessionFixture(
      config,
      mcpRuntime,
      sessionClient,
      handle,
      mediaOwner,
      prev,
    );

  await initializeCliFixture(
    config,
    settingsService,
    handle,
    sessionClient,
    mcpRuntime,
    baseConfig.activation,
    cleanup,
  );

  return projectBuiltCliFixture(
    config,
    settingsService,
    policyOwner,
    mcpRuntime,
    sessionClient,
    runtimeFactoryBindings,
    handle,
    cleanup,
  );
}

/** Restores the env var and disposes the runtime handle. */
async function cleanupHandle(
  handle: IsolatedRuntimeContextHandle,
  prev: string | undefined,
): Promise<void> {
  await Promise.resolve(handle.cleanup()).catch(() => {
    /* best-effort teardown */
  });
  if (prev === undefined) {
    delete process.env.LLXPRT_FAKE_RESPONSES;
  } else {
    process.env.LLXPRT_FAKE_RESPONSES = prev;
  }
}

/**
 * Registers providers onto the isolated context's ProviderManager (mirrors
 * createAgent's registerProvidersOntoManager). Under LLXPRT_FAKE_RESPONSES
 * this registers only FakeProvider and sets it active.
 */
function registerProvidersOntoManager(
  isolatedManager: IsolatedRuntimeContextHandle['providerManager'],
  source: {
    readonly settingsService: IsolatedRuntimeContextHandle['settingsService'];
    readonly runtimeId: IsolatedRuntimeContextHandle['runtimeId'];
    readonly metadata: IsolatedRuntimeContextHandle['metadata'];
  },
  config: ConfigType,
): void {
  const context = {
    settingsService: source.settingsService,
    runtimeId: source.runtimeId,
    metadata: source.metadata,
  };
  const { manager: registered } = createProviderManager(
    context as Parameters<typeof createProviderManager>[0],
    { fileSystem: new NodeFileSystem(), config },
  );
  for (const name of registered.listProviders()) {
    const provider = registered.getProviderByName(name);
    if (
      provider !== undefined &&
      !isolatedManager.listProviders().includes(name)
    ) {
      isolatedManager.registerProvider(provider);
    }
  }
  try {
    const active = registered.getActiveProvider();
    if (active) {
      void isolatedManager.setActiveProvider(active.name);
    }
  } catch {
    /* No active provider — safe to skip. */
  }
}

// Re-export for spec consumers (avoids deep imports in the spec).
export {
  /** Absolute path to the fixtures directory. */
  FIXTURES_DIR as fixturesDir,
};
export type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
// Type-only re-exports so consumer-facing specs can annotate Config/MessageBus
// without deep core imports (helpers/ is exempt from the boundary scan).
export type { Config, MessageBus };

function createTestOAuthBinding(): McpOAuthBinding {
  let credentials = new Map<string, OAuthCredentials>();
  return {
    openBrowser: async () => {
      throw new Error('Browser was not configured for this test');
    },
    tokenStorage: new MCPOAuthTokenStorage({
      getCredentials: async (name) => credentials.get(name) ?? null,
      setCredentials: async (value) => {
        credentials = new Map(credentials).set(value.serverName, value);
      },
      deleteCredentials: async (name) => {
        credentials = new Map(
          [...credentials].filter(([serverName]) => serverName !== name),
        );
      },
      listServers: async () => [...credentials.keys()],
      getAllCredentials: async () => new Map(credentials),
      clearAll: async () => {
        credentials = new Map();
      },
    }),
  };
}

export async function buildTestMcpRuntime(
  config: Config,
  messageBus: MessageBus,
  overrides: Readonly<Partial<AgentConfig>>,
  extensionLoader?: ExtensionLoader,
  policyOwner?: RuntimePolicyOwner,
  skillOperations?: WorkspaceSkillAssemblyOperations,
): Promise<McpRuntimeOwner> {
  const binding = createTestOAuthBinding();
  const lspOwnership =
    overrides.lspOwnership ??
    (overrides.lspOwner === undefined ? 'agent' : 'caller');
  const filesystemOwnership =
    overrides.filesystemOwnership ??
    (overrides.filesystemOwner === undefined ? 'agent' : 'caller');
  return McpRuntimeOwner.create(
    {
      tokenStorage: overrides.mcpTokenStorage
        ? new MCPOAuthTokenStorage(overrides.mcpTokenStorage)
        : binding.tokenStorage,
      openBrowser: overrides.mcpHost?.openBrowser ?? binding.openBrowser,
    },
    config,
    messageBus,
    overrides.mcpHost,
    undefined,
    extensionLoader,
    policyOwner,
    'runtime',
    overrides.lspOwner,
    lspOwnership === 'agent' ? 'runtime' : 'caller',
    overrides.filesystemOwner,
    filesystemOwnership === 'agent' ? 'runtime' : 'caller',
    undefined,
    overrides.definitionOwner,
    overrides.definitionOwnership === 'agent' ||
      overrides.definitionOwner === undefined
      ? 'runtime'
      : 'caller',
    undefined,
    undefined,
    undefined,
    skillOperations,
  );
}

function cliStyleConfigParameters(
  config: AgentConfig,
  settings: Pick<ConfigParameters, 'enableExtensionReloading' | 'storageRoot'>,
): ConfigParameters {
  return {
    ...toConfigParameters(config),
    ...settings,
  };
}

function cliStyleAgentConfig(
  overrides: Readonly<Partial<AgentConfig>>,
): AgentConfig {
  return {
    provider: 'fake',
    model: 'fake-model',
    workingDir: resolve(HARNESS_DIR, '..'),
    ...overrides,
  };
}

function includeFixtureCwd(
  params: ConfigParameters,
  overrides: Readonly<Partial<AgentConfig>>,
): void {
  if (
    overrides.filesystemOwner === undefined &&
    (overrides.harness?.includeProcessCwd ?? true)
  )
    params.includeDirectories = [
      ...(params.includeDirectories ?? []),
      process.cwd(),
    ];
}

function seedFixtureSettings(config: Config): SettingsService {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  return settings;
}

async function initializeCliFixture(
  config: Config,
  settingsService: SettingsService,
  handle: ReturnType<typeof createFixtureRuntime>,
  sessionClient: SessionClientOwner,
  mcpRuntime: McpRuntimeOwner,
  activation: AgentConfig['activation'],
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await handle.activate();
    await mcpRuntime.initialize();
    await activateFixtureClient(
      config,
      settingsService,
      handle,
      sessionClient,
      activation,
    );
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function assembleCliFixtureWorkspace(
  config: Config,
  overrides: Readonly<Partial<AgentConfig>>,
  extensionLoader: ExtensionLoader | undefined,
  skillOperations?: WorkspaceSkillAssemblyOperations,
) {
  const policyOwner = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policyOwner.session.confirmation);
  const messageBus = policyOwner.session.messageBus;
  const mcpRuntime = await buildTestMcpRuntime(
    config,
    messageBus,
    overrides,
    extensionLoader,
    policyOwner,
    skillOperations,
  );
  return { policyOwner, messageBus, mcpRuntime };
}

function projectBuiltCliFixture(
  config: Config,
  settingsService: SettingsService,
  policyOwner: RuntimePolicyOwner,
  mcpRuntime: McpRuntimeOwner,
  sessionClient: SessionClientOwner,
  runtimeFactoryBindings: AgentRuntimeFactoryBindings,
  handle: ReturnType<typeof createFixtureRuntime>,
  cleanup: () => Promise<void>,
): BuiltCliConfig {
  const messageBus = policyOwner.session.messageBus;
  return {
    runtime: handle,
    config,
    settingsService,
    policyOwner,
    messageBus,
    mcpRuntime,
    sessionClient,
    runtimeFactoryBindings,
    get agentClient() {
      return sessionClient.getAgentClient();
    },
    providerManager: handle.providerManager,
    switchProvider: assembleProviderSwitch(
      config,
      settingsService,
      handle.providerManager,
      handle.oauthManager,
      handle.readRuntimeKind,
      () => sessionClient.refreshAuth(),
      handle.settingsOwner,
    ),
    settingsOwner: handle.settingsOwner,
    cleanup,
  };
}

import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
export function requireFixturePaths(
  paths: WorkspacePathOperations | undefined,
): WorkspacePathOperations {
  if (paths === undefined)
    throw new Error('Fixture factory requires workspace paths');
  return paths;
}
