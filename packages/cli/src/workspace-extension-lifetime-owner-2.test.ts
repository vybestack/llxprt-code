import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../../agents/src/api/mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, vi } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../agents/src/api/model-selection.js';
import { AgentConfig } from '../../agents/src/api/config-types.js';
import {
  WorkspaceDefinitionOwner,
  LlxprtExtension,
} from '@vybestack/llxprt-code-core';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { loadExtension } from './config/extension.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function visibleSkills(agent: Pick<Agent, 'agentClient'>): string[] {
  const chat: unknown = agent.agentClient.getChat();
  if (!isRecord(chat) || !isRecord(chat.generationConfig))
    throw new Error('Missing real chat declarations');
  const tools = chat.generationConfig.tools;
  if (tools === undefined) return [];
  if (!Array.isArray(tools)) throw new Error('Missing real tools');
  for (const declaration of tools) {
    if (!isRecord(declaration) || declaration.name !== 'activate_skill')
      continue;
    const schema = declaration.parametersJsonSchema;
    if (
      !isRecord(schema) ||
      !isRecord(schema.properties) ||
      !isRecord(schema.properties.name)
    )
      throw new Error('Invalid real skill schema');
    const names = schema.properties.name.enum;
    if (
      !Array.isArray(names) ||
      !names.every((name: unknown) => typeof name === 'string')
    )
      throw new Error('Invalid real skill names');
    return names
      .filter((name: unknown): name is string => typeof name === 'string')
      .sort();
  }
  return [];
}

async function filesystemExtension(
  workspace: string,
  name: string,
  mcp = false,
): Promise<LlxprtExtension> {
  const directory = join(workspace, name);
  const skills = join(directory, 'skills', name);
  await mkdir(skills, { recursive: true });
  await writeFile(
    join(skills, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} instructions\n---\n\nRead ${name} locally.\n`,
  );
  await writeFile(
    join(directory, 'llxprt-extension.json'),
    JSON.stringify({
      name,
      version: '1',
      subagents: [
        {
          name: `${name}-agent`,
          profile: 'fake',
          systemPrompt: `Review ${name}`,
        },
      ],
      ...(mcp
        ? {
            mcpServers: {
              arithmetic: {
                command: process.execPath,
                args: [
                  resolve(
                    import.meta.dirname,
                    '../../../scripts/tests/mcp-standalone-stdio-fixture.ts',
                  ),
                  directory,
                ],
              },
            },
          }
        : {}),
    }),
  );
  const extension = loadExtension({
    extensionDir: directory,
    workspaceDir: workspace,
  });
  if (extension === null)
    throw new Error('Filesystem extension failed to load');
  return extension;
}

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  return { promise, release };
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
describe('filesystem workspace extension ownership', () => {
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

  let extensionMcp: McpRuntimeOwner;

  let extensionClient: ReturnType<SessionClientOwner['getAgentClient']>;

  let agent: Agent;
  let workspace: string;
  let initial: LlxprtExtension;
  let definitionOwner: WorkspaceDefinitionOwner;

  async function withExtensions(run: () => Promise<void>): Promise<void> {
    workspace = await mkdtemp(join(tmpdir(), 'llxprt-extension-owner-'));
    initial = await filesystemExtension(workspace, 'alpha', true);
    definitionOwner = new WorkspaceDefinitionOwner(
      join(workspace, 'profiles'),
      join(workspace, 'subagents'),
    );

    const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../agents/src/api/__tests__/fixtures/' + 'plain-text.jsonl',
        import.meta.url,
      ),
    );
    const builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
      workingDir: workspace,
      definitionOwner,
      definitionOwnership: 'caller',
      skillsSupport: true,
      extensions: [initial],
    };
    const builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...builtCallerOverrides,
      workingDir:
        builtCallerOverrides.workingDir === undefined
          ? builtCallerDirectory
          : await realpath(builtCallerOverrides.workingDir),
    };
    const builtCallerParameters = {
      ...toConfigParameters(builtCallerSelection),
      ...{ enableExtensionReloading: true },
    };
    builtCallerParameters.interactive = true;

    builtCallerParameters.includeDirectories = [
      ...(builtCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const builtCallerConfig = new Config(builtCallerParameters);
    const builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const builtCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtCallerConfig.getInitialSettings(),
    ))
      builtCallerSettings.set(key, value);
    const builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
    injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
    const builtCallerMcp = await buildTestMcpRuntime(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      builtCallerOverrides,
      undefined,
      builtCallerPolicy,
      undefined,
    );
    const builtCallerRuntimeId = 'caller-' + randomUUID();
    const builtCallerRelease = new AcquisitionRelease();
    const builtCallerSettingsOwner = new SessionSettingsOwner(
      builtCallerSettings,
    );
    builtCallerRelease.acquire('settings', () =>
      builtCallerSettingsOwner.dispose(),
    );
    builtCallerSettingsOwner.initializeProviderSelection(
      builtCallerConfig.getProvider(),
      builtCallerConfig.getModel(),
    );
    builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
    const builtCallerFiles = new ProviderFileLifecycle({
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
    const builtCallerManager = acquirePreferredProviderManager(
      builtCallerConfig,
      builtCallerSettings,
      builtCallerSettingsOwner,
      builtCallerFiles,
      builtCallerRuntimeId,
      builtCredentials().authority,
      builtCallerRelease,
    );
    const {
      tokenizerFactory: builtCallerTokenizer,
      contentGeneratorFactory: builtCallerContent,
    } = configureProviderRuntimeFactories(
      builtCallerConfig,
      builtCallerManager,
    );
    const builtCallerOAuth = acquirePreferredOAuth(
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
    const builtCallerMedia = new SessionMediaOwner(
      builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const builtCallerOwner = await SessionClientOwner.create(
      builtCallerConfig,
      assembleTaskSchemaPolicy(builtCallerSettings),
      builtCallerManager,
      builtCallerFactories.agentClientFactory,
      builtCallerMedia.store,
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
    const builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtCallerOwner.dispose(),
        () => builtCallerRelease.close(),
        () => builtCallerMedia.dispose(),
        () => builtCallerMcp.dispose(),
        () => builtCallerConfig.dispose(),
        () => rm(builtCallerDirectory, { recursive: true, force: true }),
      ],
      builtCallerPreviousReplay,
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
      const activation = await executeProviderActivation(
        builtCallerConfig,
        builtCallerSelection.activation ?? {
          provider: builtCallerConfig.getProvider(),
          model: builtCallerConfig.getModel(),
        },
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
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }

    agent = await fromConfig({
      settingsService: builtCallerSettings,
      config: builtCallerConfig,
      providerManager: builtCallerManager,
      agentClient: builtCallerOwner.getAgentClient(),
      mcpRuntime: builtCallerMcp,
      mcpOwnership: 'agent',
    });
    try {
      for await (const event of agent.stream('hello')) void event;
      await builtCallerMcp.awaitDiscovery();
      const adopted = builtCallerMcp.extensionOperations.list()[0];
      extensionMcp = builtCallerMcp;

      extensionClient = builtCallerOwner.getAgentClient();
      initial = adopted;
      await run();
    } finally {
      await agent.dispose();
      await builtCallerClose();
      await definitionOwner.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  }

  it('joins accepted load and restart before root disposal withdraws the actual declarations', async () => {
    await withExtensions(async () => {
      const beta = await filesystemExtension(workspace, 'beta');
      const entered = gate();
      const release = gate();
      const publish = agent.agentClient.setTools.bind(agent.agentClient);
      const fault = vi
        .spyOn(agent.agentClient, 'setTools')
        .mockImplementationOnce(async () => {
          await publish();
          entered.release();
          await release.promise;
        });
      try {
        const loading = extensionMcp.extensionOperations.load(beta);
        await entered.promise;
        const restart = extensionMcp.extensionOperations.restart(initial);
        const closing = agent.dispose();
        await expect(
          extensionMcp.extensionOperations.load(beta),
        ).rejects.toThrow('closed');
        release.release();
        await Promise.all([loading, restart, closing]);
        expect(extensionMcp.extensionOperations.list()).toStrictEqual([]);
        expect(() => extensionMcp.toolSelection.getAllTools()).toThrow(
          'closed',
        );
        expect(() => extensionMcp.subagentDefinitions.listSubagents()).toThrow(
          'closed',
        );
        expect(
          await definitionOwner.subagentReads.listSubagents(),
        ).toStrictEqual([]);
        expect(visibleSkills({ agentClient: extensionClient })).toStrictEqual(
          [],
        );
      } finally {
        release.release();
        fault.mockRestore();
      }
    });
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
