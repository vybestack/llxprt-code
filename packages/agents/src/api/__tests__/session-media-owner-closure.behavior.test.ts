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
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { randomUUID, createHash } from 'node:crypto';
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
import {
  MediaReferenceBlock,
  isMediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildAgent, internalConfig } from './helpers/agentHarness.js';
import {
  LocalMediaStore,
  requireMediaStore,
} from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { fromConfig } from '../fromConfig.js';
import { Agent } from '../agent.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

async function withSameLabelAgents(
  scenario: (first: Agent, second: Agent) => Promise<void>,
): Promise<void> {
  const workingDir = await mkdtemp(join(tmpdir(), 'session-media-owner-'));
  const first = await buildAgent('multi-turn-text.jsonl', {
    credentialAuthority: new CredentialAuthority(),
    workingDir,
    sessionId: 'identical-session-label',
  });
  const projectTemp = internalConfig(first.agent).projectTempDir;
  try {
    const second = await buildAgent('multi-turn-text.jsonl', {
      credentialAuthority: new CredentialAuthority(),
      workingDir,
      sessionId: 'identical-session-label',
    });
    try {
      await scenario(first.agent, second.agent);
    } finally {
      await second.cleanup();
    }
  } finally {
    try {
      await first.cleanup();
    } finally {
      await rm(projectTemp, { recursive: true, force: true });
      await rm(workingDir, { recursive: true, force: true });
    }
  }
}

async function ingest(agent: Agent, data: string): Promise<void> {
  await agent.setHistory([
    {
      speaker: 'human',
      blocks: [
        { type: 'media', encoding: 'base64', mimeType: 'image/png', data },
      ],
    },
  ]);
}

function firstMedia(
  history: Awaited<ReturnType<Agent['getHistory']>>,
): MediaReferenceBlock {
  const reference = history
    .flatMap((content) => content.blocks)
    .find(isMediaReferenceBlock);
  if (reference === undefined) throw new Error('Missing admitted media');
  return reference;
}

function contentIdFor(data: string): string {
  return `sha256:${createHash('sha256').update(data, 'base64').digest('hex')}`;
}

describe('public Agent session media ownership closure', () => {
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

  it('rejects an unpersisted sibling reference despite identical project and session labels', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const firstHistory = await first.getHistory();
      await expect(second.setHistory(firstHistory)).rejects.toThrow(/media/i);
      expect(firstMedia(await second.getHistory()).contentId).toBe(
        contentIdFor('BQYHCA=='),
      );
    });
  }, 30000);

  it('isolates physical roots, leases and purge for same-label public Agents', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const firstStore = requireMediaStore(first.agentClient);
      const secondStore = requireMediaStore(second.agentClient);
      const reference = firstMedia(await second.getHistory());
      await secondStore.reserve(reference, 'external-test-lease');
      await first.setHistory([]);
      await first.dispose();
      const probe = new LocalMediaStore({
        rootDirectory: firstStore.rootDirectory,
        quotaBytes: firstStore.quotaBytes,
      });
      try {
        await probe.reclaimUnreferenced(new Set(), Date.now());
        expect(await secondStore.readVerified(reference)).toStrictEqual(
          new Uint8Array([5, 6, 7, 8]),
        );
        await secondStore.release(reference.contentId, 'external-test-lease');
        await second.setHistory([]);
        expect(await secondStore.hasReservations(reference.contentId)).toBe(
          false,
        );
        const reclaimed = await secondStore.reclaimUnreferenced(
          new Set(),
          Date.now(),
        );
        expect(reclaimed.objectsRemoved).toBe(1);
        expect(firstStore.rootDirectory).not.toBe(secondStore.rootDirectory);
      } finally {
        await probe.close();
      }
    });
  }, 30000);

  it('closes an owned media store after disposing its public Agent', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const store = requireMediaStore(first.agentClient);
      const reference = firstMedia(await first.getHistory());
      await first.dispose();
      await expect(store.readVerified(reference)).rejects.toThrow(/closed/i);
      await second.setHistory(await second.getHistory());
    });
  }, 30000);

  it('keeps sibling media available after clearing the first Agent recording', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const retained = await second.getHistory();
      await first.session.setRecording({ enabled: true });
      await first.session.clearHistory();
      await first.dispose();
      await second.setHistory(retained);
      expect(firstMedia(await second.getHistory()).contentId).toBe(
        contentIdFor('BQYHCA=='),
      );
      await second.session.setRecording({ enabled: true });
      expect(
        (await second.session.createCheckpoint('surviving-media')).name,
      ).toBe('surviving-media');
    });
  }, 30000);

  it('restores ordinary durable JSONL media and forks a checkpoint into a fresh Agent owner', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await first.session.setRecording({ enabled: true });
      const checkpoint = await first.session.createCheckpoint('durable-media');
      const sessions = await first.session.listSessions();
      const sessionId = sessions[0].id;
      await first.dispose();
      await second.session.resume(sessionId);
      const resumedId = firstMedia(await second.getHistory()).contentId;
      const fork = await second.session.forkFromCheckpoint(
        checkpoint.checkpointId,
      );
      expect({
        resumedId,
        forkedId: firstMedia(await second.getHistory()).contentId,
        distinctFork: fork.id !== sessionId,
      }).toStrictEqual({
        resumedId: contentIdFor('AQIDBA=='),
        forkedId: contentIdFor('AQIDBA=='),
        distinctFork: true,
      });
    });
  }, 30000);

  it('preserves the adopted Config, client and caller-owned media lifetime', async () => {
    await openbuiltCaller('multi-turn-text.jsonl');
    await builtCallerOwner.refreshAuth(undefined);
    const client = builtCallerOwner.getAgentClient();
    await client.startChat();
    const store = requireMediaStore(builtCallerOwner.getAgentClient());
    const agent = await fromConfig({
      settingsOwner: builtCallerSettingsOwner,
      settingsService: builtCallerSettings,
      agentClient: builtCallerOwner.getAgentClient(),
      providerManager: builtCallerManager,
      config: builtCallerConfig,
      messageBus: builtCallerPolicy.session.messageBus,
      mcpRuntime: builtCallerMcp,
    });
    try {
      expect({
        retainedConfig: internalConfig(agent) === builtCallerConfig,
        retainedClient: builtCallerOwner.getAgentClient() === client,
      }).toStrictEqual({ retainedConfig: true, retainedClient: true });
      await ingest(agent, 'AQIDBA==');
      const history = await agent.getHistory();
      await agent.dispose();
      await client.setHistory(history);
      expect(await store.readVerified(firstMedia(history))).toStrictEqual(
        new Uint8Array([1, 2, 3, 4]),
      );
    } finally {
      await agent.dispose();
      await builtCallerClose();
      await store.close();
    }
  }, 30000);

  it('closes failed activation media without closing a same-label sibling', async () => {
    await withSameLabelAgents(async (first, second) => {
      await ingest(first, 'AQIDBA==');
      await ingest(second, 'BQYHCA==');
      const failedOwner = new SessionMediaOwner(
        internalConfig(first).projectTempDir,
        1024 * 1024,
      );
      const failedStore = failedOwner.store;
      const admitted = await failedStore.admit({
        bytes: new Uint8Array([9, 10, 11, 12]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      expect(await failedStore.readVerified(admitted)).toStrictEqual(
        new Uint8Array([9, 10, 11, 12]),
      );
      await expect(
        buildAgent('multi-turn-text.jsonl', {
          credentialAuthority: new CredentialAuthority(),
          workingDir: internalConfig(first).getWorkingDir(),
          sessionId: 'identical-session-label',
          mediaOwner: failedOwner,
          activation: {
            provider: 'unregistered-failure-provider',
            providerSwitchPolicy: 'strict',
          },
        }),
      ).rejects.toThrow('createAgent activation failed');
      await expect(failedStore.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
      await expect(failedStore.readVerified(admitted)).rejects.toThrow(
        /closed/i,
      );
      await second.setHistory(await second.getHistory());
      expect(firstMedia(await second.getHistory()).byteLength).toBe(4);
    });
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
