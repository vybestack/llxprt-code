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
import { cleanupAfterFailure } from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, spyOn } from 'bun:test';
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
import { WorkspaceToolCatalogOwner } from '@vybestack/llxprt-code-core';
import { fromConfig } from '../fromConfig.js';
import { gate as engineGate } from './helpers/async-child-disposal-join-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function messages(error: unknown): readonly string[] {
  if (error instanceof AggregateError)
    return error.errors.flatMap((entry: unknown) => messages(entry));
  return error instanceof Error ? [error.message] : [String(error)];
}

async function failure(operation: Promise<void>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

describe('tool catalog publication and cleanup ownership', () => {
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

  async function publicationClose(): Promise<void> {
    await openbuiltCaller('plain-text.jsonl');
    const agent = await fromConfig(
      builtCallerConfig,
      builtCallerSettings,
      {},
      builtCallerSettingsOwner,
      builtCallerManager,
      undefined,
      undefined,
      builtCallerMcp,
    );
    await agent.agentClient.startChat();
    const entered = engineGate();
    const release = engineGate();
    const original = agent.agentClient.setTools.bind(agent.agentClient);
    const publication = spyOn(agent.agentClient, 'setTools').mockImplementation(
      async (...args) => {
        entered.release();
        await release.promise;
        await original(...args);
      },
    );
    const pending = agent.sessionClient.publishTools();
    await entered.promise;
    let finished = false;
    const closing = agent.dispose().then(() => {
      finished = true;
    });
    const outcomes = Promise.allSettled([pending, closing]);
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(finished).toBe(false);
      release.release();
      const settled = await outcomes;
      expect(settled.map((result) => result.status)).toStrictEqual([
        'fulfilled',
        'fulfilled',
      ]);
      expect(() => agent.tools.get('read_file')).toThrow('closed');
    } finally {
      release.release();
      publication.mockRestore();
      await outcomes;
      await builtCallerClose();
    }
  }

  it('joins an admitted workspace context publication before clearing and withdrawing its physical roots', async () => {
    await openbuiltCaller('plain-text.jsonl');
    const agent = await fromConfig(
      builtCallerConfig,
      builtCallerSettings,
      {},
      builtCallerSettingsOwner,
      builtCallerManager,
      undefined,
      undefined,
      builtCallerMcp,
    );
    await agent.agentClient.startChat();
    const entered = engineGate();
    const release = engineGate();
    const original = agent.agentClient.setTools.bind(agent.agentClient);
    const publication = spyOn(agent.agentClient, 'setTools').mockImplementation(
      async (...args) => {
        entered.release();
        await release.promise;
        await original(...args);
      },
    );
    const pending = builtCallerMcp.refreshContext();
    await entered.promise;
    let completed = false;
    const closing = builtCallerMcp.dispose().then(() => {
      completed = true;
    });
    const outcomes = Promise.allSettled([pending, closing]);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(completed).toBe(false);
      release.release();
      expect((await outcomes).map((result) => result.status)).toStrictEqual([
        'fulfilled',
        'fulfilled',
      ]);
      expect(() => builtCallerMcp.toolSelection.getAllTools()).toThrow(
        'closed',
      );
    } finally {
      release.release();
      publication.mockRestore();
      await outcomes;
      await agent.dispose();
      await builtCallerClose();
    }
  });
  it('joins its own admitted publication before withdrawing the selection root', async () => {
    await expect(publicationClose()).resolves.toBeUndefined();
  });
  for (const name of ['task', 'run_shell_command']) {
    it(`rejects reserved workspace publication for ${name} before any lookup or declaration can shadow a session`, async () => {
      await openbuiltCaller('plain-text.jsonl');
      const workspace = new WorkspaceToolCatalogOwner(
        builtCallerConfig,
        builtCallerPolicy.session.messageBus,
        builtCallerMcp.trust,
      );
      try {
        const tool = builtCallerOwner.getAgentClient().tools.getTool(name);
        if (tool === undefined)
          throw new Error(`Missing actual session tool ${name}`);
        expect(() => workspace.publication.registerTool(tool)).toThrow(
          'session',
        );
        const lease = workspace.acceptSkillPublication();
        try {
          expect(() => lease.registry.registerTool(tool)).toThrow('session');
        } finally {
          lease.release();
        }

        expect(workspace.selection.getTool(name)).toBeUndefined();
        expect(workspace.selection.getAllToolNames()).not.toContain(name);
        expect(
          workspace.selection
            .getFunctionDeclarations()
            .map((entry) => entry.name),
        ).not.toContain(name);
        expect(
          workspace.selection.getFunctionDeclarationsFiltered([name]),
        ).toHaveLength(0);
        expect(
          workspace.selection
            .getAllTools()
            .filter((entry) => entry.name === name),
        ).toHaveLength(0);
        expect(
          workspace.selection
            .getEnabledTools()
            .filter((entry) => entry.name === name),
        ).toHaveLength(0);
        expect(
          builtCallerOwner.getAgentClient().tools.getTool(name),
        ).toBeDefined();
      } finally {
        await workspace.dispose();
        await builtCallerClose();
      }
    });
  }

  it('denies new catalog registration while an admitted skill lease can finish', async () => {
    await openbuiltCaller('plain-text.jsonl');
    const workspace = new WorkspaceToolCatalogOwner(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      builtCallerMcp.trust,
    );
    const tool = builtCallerOwner.getAgentClient().tools.getTool('read_file');
    if (tool === undefined) throw new Error('Missing physical read tool');
    const lease = workspace.acceptSkillPublication();
    try {
      await workspace.closeAdmission();
      expect(() => workspace.publication.registerTool(tool)).toThrow('closed');
      expect(() => workspace.acceptSkillPublication()).toThrow('closed');
      lease.registry.registerTool(tool);
      expect(lease.declarations().map((entry) => entry.name)).toContain(
        'read_file',
      );
      lease.release();
      expect(() => lease.registry.registerTool(tool)).toThrow('released');
    } finally {
      lease.release();
      await workspace.dispose();
      await builtCallerClose();
    }
  });

  it('withdraws every retained workspace publication operation after final disposal', async () => {
    await openbuiltCaller('plain-text.jsonl');
    const workspace = new WorkspaceToolCatalogOwner(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      builtCallerMcp.trust,
    );
    const tool = builtCallerOwner.getAgentClient().tools.getTool('read_file');
    if (tool === undefined) throw new Error('Missing actual read tool');
    workspace.publication.registerTool(tool);
    try {
      await workspace.dispose();
      expect(() => workspace.publication.getTool('read_file')).toThrow(
        'closed',
      );
      expect(() => workspace.publication.registerTool(tool)).toThrow('closed');
      expect(() => workspace.publication.unregisterTool('read_file')).toThrow(
        'closed',
      );
      expect(() => workspace.publication.sortTools()).toThrow('closed');
      expect(() =>
        workspace.publication.removeMcpToolsByServer('physical'),
      ).toThrow('closed');
    } finally {
      await workspace.dispose();
      await builtCallerClose();
    }
  });

  it('aggregates a binding read failure and a different client clear failure while closing the real workspace', async () => {
    await openbuiltCaller('plain-text.jsonl');
    const readError = new Error('physical binding read rejected');
    const clearError = new Error('physical client clearing rejected');
    let closing = false;
    builtCallerMcp.bindSessionClient(
      builtCallerConfig,
      Symbol('faulting read binding'),
      () => {
        if (closing) throw readError;
        return builtCallerOwner.getAgentClient();
      },
      async () => {},
      async () => {},
      () => {},
      () => async () => {},
    );
    const clear = spyOn(
      builtCallerOwner.getAgentClient(),
      'clearTools',
    ).mockImplementation(() => {
      throw clearError;
    });
    try {
      closing = true;
      const error = await failure(builtCallerMcp.dispose());
      expect(error).toBeInstanceOf(AggregateError);
      expect(new Set(messages(error))).toStrictEqual(
        new Set([readError.message, clearError.message]),
      );
      expect(() => builtCallerMcp.toolSelection.getAllTools()).toThrow(
        'closed',
      );
      expect(() => builtCallerMcp.readInstructions()).toThrow('stopped');
    } finally {
      clear.mockRestore();
      const cleanupError = await failure(builtCallerClose());
      expect(new Set(messages(cleanupError))).toStrictEqual(
        new Set([readError.message, clearError.message]),
      );
    }
  });

  it('joins admitted publication and does not read a peer that closed while the first publication awaited', async () => {
    await openbuiltCaller('plain-text.jsonl');
    const first = await fromConfig(
      builtCallerConfig,
      builtCallerSettings,
      {},
      builtCallerSettingsOwner,
      builtCallerManager,
      undefined,
      undefined,
      builtCallerMcp,
    );
    const second = await fromConfig(
      builtCallerConfig,
      builtCallerSettings,
      {},
      builtCallerSettingsOwner,
      builtCallerManager,
      undefined,
      undefined,
      builtCallerMcp,
    );
    await first.agentClient.startChat();
    await second.agentClient.startChat();
    const entered = engineGate();
    const release = engineGate();
    const setTools = first.agentClient.setTools.bind(first.agentClient);
    const publish = spyOn(first.agentClient, 'setTools').mockImplementation(
      async () => {
        entered.release();
        await release.promise;
        await setTools();
      },
    );
    let publication: Promise<void> | undefined;
    try {
      publication = builtCallerMcp.refreshContext();
      await entered.promise;
      await second.dispose();
      release.release();
      await publication;
      expect(first.tools.get('read_file')).toBeDefined();
      expect(() => second.tools.get('read_file')).toThrow('closed');
    } finally {
      release.release();
      publish.mockRestore();
      await publication;
      await first.dispose();
      await second.dispose();
      await builtCallerClose();
    }
  });
});

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    const failures: unknown[] = [];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Session fixture cleanup failed');
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
