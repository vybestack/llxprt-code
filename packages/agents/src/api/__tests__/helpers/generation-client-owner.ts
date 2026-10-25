/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerateOptions } from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type {
  AgentClientContract,
  AgentClientFactory,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import { assembleModelSelection } from '../../model-selection.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
  preparePreferredProviderCompletion,
} from '../../preferred-provider-acquisition.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import type { GenerationProvider } from './generation-provider.js';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';
import { createCapturedSessionOwner } from './session-client-capture.js';

export function generationGate(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** The recording a detached-generation owner reports to; it records nothing. */
export const generationRecording = {
  transcriptPath: (): undefined => undefined,
  persistSemanticMediaPurge: async (): Promise<void> => {},
};

/**
 * The text generator a host binds to a session client owner:
 * `Agent.generate` without the facade.
 */
export function ownerTextGenerator(
  owner: SessionClientOwner,
): (input: string, options?: GenerateOptions) => Promise<string> {
  return async (input, options) =>
    owner.generateText(input, options, generationRecording);
}

/**
 * A real client the owner's factory returned, wrapped on the instance: it
 * counts its own `initialize` and `dispose` calls and runs the hooks a test
 * assigns inside them. Nothing is patched on a prototype and no class is
 * subclassed.
 */
export type ObservedClient = AgentClientContract & {
  initialized: number;
  disposed: number;
  initializing: (() => Promise<void>) | undefined;
  initializedEffect: (() => void) | undefined;
  disposing: (() => Promise<void>) | undefined;
};

function observeClient(client: AgentClientContract): ObservedClient {
  const observed: ObservedClient = Object.assign(client, {
    initialized: 0,
    disposed: 0,
    initializing: undefined as (() => Promise<void>) | undefined,
    initializedEffect: undefined as (() => void) | undefined,
    disposing: undefined as (() => Promise<void>) | undefined,
  });
  const initialize = client.initialize.bind(client);
  const dispose = client.dispose.bind(client);
  client.initialize = async (config: ContentGeneratorConfig) => {
    observed.initialized += 1;
    await observed.initializing?.();
    await initialize(config);
    observed.initializedEffect?.();
  };
  client.dispose = async () => {
    observed.disposed += 1;
    await observed.disposing?.();
    await dispose();
  };
  return observed;
}

export interface GenerationClientOwnerOptions {
  readonly authority: CredentialAuthority;
  /** The contributed provider the owner activates (its alias is the provider name). */
  readonly provider: GenerationProvider;
  /** Runs once for each client the owner's factory returns, before the owner uses it. */
  readonly acquired?: (client: ObservedClient, index: number) => void;
  /**
   * Replaces tokenizer readiness once the owner is open, so construction
   * keeps the production readiness and only the scenario's admissions use the
   * hook.
   */
  readonly prepareTokenizer?: () => Promise<void>;
}

export interface GenerationClientOwner {
  readonly owner: SessionClientOwner;
  readonly settingsOwner: SessionSettingsOwner;
  /** The clients the owner's factory returned, in creation order. */
  readonly clients: readonly ObservedClient[];
  /** Releases everything except the owner. */
  readonly closeStack: () => Promise<void>;
}

interface ProviderStack {
  readonly directory: string;
  readonly config: Config;
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly policy: RuntimePolicyOwner;
  readonly mcp: McpRuntimeOwner;
  readonly runtimeId: string;
  readonly release: AcquisitionRelease;
  readonly files: ProviderFileLifecycle;
  readonly manager: ReturnType<typeof acquirePreferredProviderManager>;
  readonly oauth: ReturnType<typeof acquirePreferredOAuth>;
  readonly tokenizer: ReturnType<typeof configureProviderTokenizer>;
  /** Routes tokenizer readiness to the scenario's hook from now on. */
  readonly admit: () => void;
}

function createConfig(directory: string, alias: string): Config {
  return new Config(
    toConfigParameters({
      provider: alias,
      model: 'primary-model',
      sessionId: randomUUID(),
      workingDir: directory,
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
      harness: { includeProcessCwd: false },
    }),
  );
}

function gateTokenizer(
  base: ReturnType<typeof configureProviderTokenizer>,
  hook: (() => Promise<void>) | undefined,
): { tokenizer: typeof base; admit: () => void } {
  let admitted = false;
  return {
    tokenizer: {
      ...base,
      prepareTokenizer: async (provider, model) => {
        if (admitted && hook !== undefined) await hook();
        else await base.prepareTokenizer?.(provider, model);
      },
    },
    admit: () => {
      admitted = true;
    },
  };
}

async function acquireProviderStack(
  options: GenerationClientOwnerOptions,
): Promise<ProviderStack> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'generation-client-owner-')),
  );
  const config = createConfig(directory, options.provider.alias);
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const policy = new RuntimePolicyOwner(config);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    {},
    undefined,
    policy,
  );
  const runtimeId = 'generation-client-owner-' + randomUUID();
  const release = new AcquisitionRelease();
  const settingsOwner = new SessionSettingsOwner(settings);
  release.acquire('settings', () => settingsOwner.dispose());
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  settingsOwner.bindTelemetry(config);
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  for (const scope of [runtimeId, config.getSessionId()])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
  const manager = acquirePreferredProviderManager(
    config,
    settings,
    settingsOwner,
    files,
    runtimeId,
    options.authority,
    release,
  );
  const oauth = acquirePreferredOAuth(
    undefined,
    policy.session.messageBus,
    config,
    settings,
    manager,
    runtimeId,
    mcp.profileDefinitions,
    options.authority,
    release,
    undefined,
  );
  const { tokenizer, admit } = gateTokenizer(
    configureProviderTokenizer(manager),
    options.prepareTokenizer,
  );
  return {
    directory,
    config,
    settings,
    settingsOwner,
    policy,
    mcp,
    runtimeId,
    release,
    files,
    manager,
    oauth,
    tokenizer,
    admit,
  };
}

async function activateProvider(
  stack: ProviderStack,
  owner: SessionClientOwner,
  provider: GenerationProvider,
): Promise<void> {
  const { config, settings, settingsOwner, manager, oauth, mcp } = stack;
  await preparePreferredProviderCompletion(
    config,
    settings,
    settingsOwner,
    manager,
    oauth,
    stack.runtimeId,
    stack.tokenizer,
    provider.contributions,
  );
  await mcp.initialize();
  const result = await executeProviderActivation(
    config,
    { provider: provider.alias, model: 'primary-model' },
    assembleProviderSwitch(
      config,
      settings,
      manager,
      oauth,
      () => 'agent',
      () => owner.refreshAuth(),
      settingsOwner,
    ),
    settings,
    manager,
    (method) => owner.refreshAuth(method),
    assembleModelSelection(settingsOwner),
  );
  if (result.authFailed) throw result.authError;
  await owner.initializeTools();
  stack.admit();
}

async function openGenerationClientOwner(
  options: GenerationClientOwnerOptions,
): Promise<GenerationClientOwner> {
  const stack = await acquireProviderStack(options);
  const { config, settings, mcp, manager } = stack;
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const production = buildAgentClientFactory();
  const observed: ObservedClient[] = [];
  const factory: AgentClientFactory = (...operands) => {
    const client = observeClient(production(...operands));
    observed.push(client);
    options.acquired?.(client, observed.length - 1);
    return client;
  };
  const owner = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    factory,
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    stack.settingsOwner,
    createRuntimeContentGeneratorFactory(),
    stack.tokenizer,
  );
  owner.bindMcpRuntime(mcp);
  owner.bindProviderFiles(stack.files, (provider) =>
    stack.oauth.composeRetryOperations(provider),
  );
  owner.bindHooks();
  const closeStack = (): Promise<void> =>
    runCleanupSteps([
      () => stack.release.close(),
      () => media.dispose(),
      () => mcp.dispose(),
      () => stack.policy.dispose(),
      () => config.dispose(),
      () => rm(stack.directory, { recursive: true, force: true }),
    ]);
  try {
    await activateProvider(stack, owner, options.provider);
  } catch (primary) {
    return cleanupAfterFailure(primary, () =>
      runCleanupSteps([() => owner.dispose(), closeStack]),
    );
  }
  return {
    owner,
    settingsOwner: stack.settingsOwner,
    clients: observed,
    closeStack,
  };
}

/**
 * Runs a scenario against a `SessionClientOwner` built through its production
 * `create` with a contributed provider activated, a primary client whose chat is not started yet and a
 * client factory that wraps each real client on the instance. After the
 * scenario the owner is disposed and the failures that disposal reports are
 * returned; the remaining resources are released either way.
 */
export async function withGenerationClientOwner(
  options: GenerationClientOwnerOptions,
  run: (opened: GenerationClientOwner) => Promise<void>,
): Promise<readonly unknown[]> {
  const opened = await openGenerationClientOwner(options);
  try {
    await run(opened);
  } catch (primary) {
    return cleanupAfterFailure(primary, () =>
      runCleanupSteps([() => opened.owner.dispose(), opened.closeStack]),
    );
  }
  const failures: unknown[] = [];
  try {
    await opened.owner.dispose();
  } catch (failure) {
    failures.push(failure);
  }
  await opened.closeStack();
  return failures;
}
