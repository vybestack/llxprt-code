import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import {
  loadAgentRuntime,
  type AgentRuntimeLoaderResult,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Storage } from '@vybestack/llxprt-code-storage';
import { fileURLToPath } from 'node:url';
import type { TestChildLaunchOptions } from '../../core/__tests__/child-launch-fixture.js';
import { createTestChildOrchestrator } from '../../core/__tests__/child-launch-fixture.js';
import { AgentClient } from '../../core/client.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import {
  ContextState,
  SubagentTerminateMode,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SubagentOrchestrator } from '../../core/subagentOrchestrator.js';

class TrackedChildClient extends AgentClient {
  disposed = false;
  override async dispose(): Promise<void> {
    await super.dispose();
    this.disposed = true;
  }
}

async function withChildOwner(
  scenario: (
    orchestrator: SubagentOrchestrator,
    parentSettings: SettingsService,
    parentOwner: SessionClientOwner,
    parentMcp: McpRuntimeOwner,
    childSettings: () => SettingsService,
    clients: readonly TrackedChildClient[],
  ) => Promise<void>,
  authority: CredentialAuthority,
  runtimeLoader?: TestChildLaunchOptions['runtimeLoader'],
): Promise<void> {
  const builtPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
    new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
  );
  const builtDirectory = await realpath(
    await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
  );
  await initializePromptSystem();
  const builtConfig = new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir: builtDirectory,
    }),
  );
  const builtSettings = new SettingsService();
  const builtPolicy = new RuntimePolicyOwner(builtConfig);
  const builtMessageBus = builtPolicy.session.messageBus;
  const builtMcp = await McpRuntimeOwner.create(
    {
      openBrowser: async () => {
        throw new Error('Unexpected browser request');
      },
      tokenStorage: new MCPOAuthTokenStorage({
        getCredentials: async () => null,
        setCredentials: async () => {
          throw new Error('Unexpected token write');
        },
        deleteCredentials: async () => {},
        listServers: async () => [],
        getAllCredentials: async () => new Map(),
        clearAll: async () => {},
      }),
    },
    builtConfig,
    builtMessageBus,
    undefined,
    undefined,
    undefined,
    builtPolicy,
    'runtime',
  );

  const builtRuntimeId = 'engine-' + randomUUID();
  const builtRelease = new AcquisitionRelease();
  const builtSettingsOwner = new SessionSettingsOwner(builtSettings);
  builtRelease.acquire('settings', () => builtSettingsOwner.dispose());
  builtSettingsOwner.initializeProviderSelection(
    builtConfig.getProvider(),
    builtConfig.getModel(),
  );
  builtSettingsOwner.bindTelemetry(builtConfig);
  const builtFiles = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  for (const scope of [builtRuntimeId, builtConfig.getSessionId()])
    builtRelease.acquire('files', () =>
      releaseAdoptedFileScope(builtFiles, scope),
    );
  const builtManager = acquirePreferredProviderManager(
    builtConfig,
    builtSettings,
    builtSettingsOwner,
    builtFiles,
    builtRuntimeId,
    authority,
    builtRelease,
  );
  const builtTokenizer = configureProviderTokenizer(builtManager);
  const builtContent = createRuntimeContentGeneratorFactory();
  const builtOAuth = acquirePreferredOAuth(
    undefined,
    builtMessageBus,
    builtConfig,
    builtSettings,
    builtManager,
    builtRuntimeId,
    builtMcp.profileDefinitions,
    authority,
    builtRelease,
    undefined,
  );
  const builtMedia = new SessionMediaOwner(
    builtConfig.projectTempDir,
    1024 * 1024,
  );
  const builtOwner = await createCapturedSessionOwner(
    builtConfig,
    assembleTaskSchemaPolicy(builtSettings),
    builtManager,
    buildAgentClientFactory(),
    builtMedia.store,
    builtMcp.readInstructions,
    builtMcp.workspacePaths,
    builtSettingsOwner,
    builtContent,
    builtTokenizer,
  );
  builtOwner.bindMcpRuntime(builtMcp);
  builtOwner.bindHooks();
  const builtClose = settleEngineRelease.bind(
    undefined,
    [
      () => builtOwner.dispose(),
      () => builtRelease.close(),
      () => builtMedia.dispose(),
      () => builtMcp.dispose(),
      () => builtConfig.dispose(),
      () => rm(builtDirectory, { recursive: true, force: true }),
    ],
    builtPreviousReplay,
  );
  try {
    await preparePreferredProviderCompletion(
      builtConfig,
      builtSettings,
      builtSettingsOwner,
      builtManager,
      builtOAuth,
      builtRuntimeId,
      builtTokenizer,
      undefined,
    );
    await builtMcp.initialize();
    await builtOwner.initializeTools();
    await builtOwner.refreshAuth();
    await capturedSessionClient(builtOwner).startChat();
  } catch (primary) {
    await cleanupAfterFailure(primary, builtClose);
  }

  const clients: TrackedChildClient[] = [];
  const directory = join(
    builtConfig.projectTempDir,
    `child-owner-${randomUUID()}`,
  );
  const profiles = new ProfileManager(join(directory, 'profiles'));
  const subagents = new SubagentManager(join(directory, 'subagents'), profiles);
  try {
    await profiles.saveProfile('child-profile', {
      version: 1,
      provider: 'fake',
      model: 'fake-model',
      modelParams: {},
      ephemeralSettings: {},
    });
    await subagents.saveSubagent(
      'child',
      'child-profile',
      'Answer the parent question.',
    );
    let adoptedChildSettings: SettingsService | undefined;
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: authority,
      runtimeFactoryBindings: {
        ...createAgentRuntimeFactoryBindings(),
        agentClientFactory: (
          config,
          state,
          instructions,
          store,
          paths,
          reads,
        ) => {
          if (
            store === undefined ||
            paths === undefined ||
            instructions === undefined
          )
            throw new Error('Missing child client factory inputs');
          const client = new TrackedChildClient(
            config,
            state,
            instructions,
            store,
            paths,
            undefined,
            undefined,
            reads,
          );
          clients.push(client);
          return client;
        },
      },
      workspaceTrust: builtMcp.trust,
      instructions: emptyInstructionReads,
      toolRegistry: capturedSessionClient(builtOwner).tools,
      workspacePaths: builtMcp.workspacePaths,
      profileManager: profiles,
      subagentManager: subagents,
      foregroundConfig: builtConfig,
      createChildSettings: () => {
        adoptedChildSettings = builtSettingsOwner.createChildStore();
        return adoptedChildSettings;
      },
      readRunPolicy: () => builtSettingsOwner.readSubagentRunPolicy(),
      messageBus: builtMessageBus,
      readMcpInstructions: builtMcp.readInstructions,
      runtimeLoader,
    });
    await scenario(
      orchestrator,
      builtSettings,
      builtOwner,
      builtMcp,
      () => {
        if (adoptedChildSettings === undefined)
          throw new Error('Child store has not been adopted');
        return adoptedChildSettings;
      },
      clients,
    );
  } finally {
    await builtClose();
  }
}

describe('Isolated child session client ownership', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'child-owner-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const credentials = useOwnedCredentials();
  it('withdraws child tool metadata immediately after adopted-store governance changes', async () => {
    let childRuntime: AgentRuntimeLoaderResult | undefined;
    await withChildOwner(
      async (
        orchestrator,
        parentSettings,
        parentOwner,
        parentMcp,
        childSettings,
      ) => {
        const child = await orchestrator.launch({ name: 'child' });
        if (childRuntime === undefined)
          throw new Error('Child runtime was not acquired');
        try {
          expect(childRuntime.toolsView.listToolNames()).toContain('read_file');
          childSettings().set('tools.allowed', []);
          expect(childRuntime.toolsView.listToolNames()).toStrictEqual([]);
          expect(
            childRuntime.toolsView.getToolMetadata('read_file'),
          ).toBeUndefined();
          expect(
            childRuntime.runtimeContext.readToolGovernance().allowedExplicit,
          ).toBe(true);
          expect(
            capturedSessionClient(parentOwner)
              .tools.getFunctionDeclarations()
              .map((tool) => tool.name),
          ).toContain('read_file');
        } finally {
          await child.dispose();
        }
      },
      credentials().authority,
      async (options) => {
        childRuntime = await loadAgentRuntime(options);
        return childRuntime;
      },
    );
  }, 30000);

  it('enforces live caller-store output limits in each child launch', async () => {
    await withChildOwner(async (orchestrator, parentSettings) => {
      parentSettings.set('subagent-max-output-tokens-total', 0);
      const limited = await orchestrator.launch({ name: 'child' });
      try {
        await limited.scope.runNonInteractive(new ContextState());
        expect(limited.scope.output.terminate_reason).toBe(
          SubagentTerminateMode.MAX_OUTPUT,
        );
        expect(limited.scope.output.output_tokens_total ?? 0).toBe(0);
      } finally {
        await limited.dispose();
      }
      parentSettings.set('subagent-max-output-tokens-total', -1);
      const continuing = await orchestrator.launch({ name: 'child' });
      try {
        await continuing.scope.runNonInteractive(new ContextState());
        expect(continuing.scope.output.terminate_reason).toBe(
          SubagentTerminateMode.GOAL,
        );
        expect(continuing.scope.output.output_tokens_total).toBeGreaterThan(0);
      } finally {
        await continuing.dispose();
      }
    }, credentials().authority);
  }, 30000);
  it('roots the child media store in the parent workspace project directory', async () => {
    let childRuntime: AgentRuntimeLoaderResult | undefined;
    await withChildOwner(
      async (orchestrator, _settings, _owner, parentMcp) => {
        const [parentDirectory] = parentMcp.workspacePaths.directories();
        const parentProjectDirectory = join(
          Storage.getGlobalLogDir(),
          'tmp',
          Storage.getProjectHistoryKey(parentDirectory),
        );
        const launchDirectoryProjectDirectory = join(
          Storage.getGlobalLogDir(),
          'tmp',
          Storage.getProjectHistoryKey(process.cwd()),
        );
        expect(parentProjectDirectory).not.toBe(
          launchDirectoryProjectDirectory,
        );
        const child = await orchestrator.launch({ name: 'child' });
        try {
          const mediaRoot =
            childRuntime?.runtimeContext.mediaStore?.rootDirectory;
          if (mediaRoot === undefined)
            throw new Error('Child runtime has no media store');
          expect(
            mediaRoot.startsWith(join(parentProjectDirectory, 'media-live')),
          ).toBe(true);
          expect(mediaRoot.startsWith(launchDirectoryProjectDirectory)).toBe(
            false,
          );
        } finally {
          await child.dispose();
        }
      },
      credentials().authority,
      async (options) => {
        childRuntime = await loadAgentRuntime(options);
        return childRuntime;
      },
    );
  }, 30000);
  it('closes the child client after success without closing its parent', async () => {
    await withChildOwner(
      async (
        orchestrator,
        parentSettings,
        parentOwner,
        parentMcp,
        _childSettings,
        clients,
      ) => {
        const baseline = parentSettings.listenerCount('provider-change');
        const child = await orchestrator.launch({ name: 'child' });
        expect(clients.length).toBeGreaterThan(0);
        expect(clients.some((client) => !client.disposed)).toBe(true);
        await child.dispose();
        expect(clients.every((client) => client.disposed)).toBe(true);
        expect(parentSettings.listenerCount('provider-change')).toBe(baseline);
        await parentMcp.refreshContext();
        await capturedSessionClient(parentOwner).addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'parent continues' }],
        });
        expect(
          (await capturedSessionClient(parentOwner).getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
      },
      credentials().authority,
    );
  }, 30000);
  it('closes the child client after loader failure without closing its parent', async () => {
    await withChildOwner(
      async (
        orchestrator,
        parentSettings,
        parentOwner,
        parentMcp,
        _childSettings,
        clients,
      ) => {
        const baseline = parentSettings.listenerCount('provider-change');
        await expect(orchestrator.launch({ name: 'child' })).rejects.toThrow(
          'Child loader failure',
        );
        expect(clients.every((client) => client.disposed)).toBe(true);
        expect(parentSettings.listenerCount('provider-change')).toBe(baseline);
        await parentMcp.refreshContext();
        await capturedSessionClient(parentOwner).addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'parent continues' }],
        });
        expect(
          (await capturedSessionClient(parentOwner).getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
      },
      credentials().authority,
      async () => {
        throw new Error('Child loader failure');
      },
    );
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
