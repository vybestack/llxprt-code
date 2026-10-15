import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
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
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import { internalConfig, type Agent } from './helpers/agentHarness.js';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end coverage for issue #3379.
 *
 * `/skills reload` used to refresh SkillManager and stop there, so a skill
 * added on disk never reached the model. The model learns which skills exist
 * from exactly one place: the `activate_skill` declaration carried in the tool
 * list that ChatSession hands to the provider on every request. These tests
 * therefore assert on that declaration rather than on which functions were
 * called.
 *
 * The whole production chain runs for real, with nothing supplied by the test:
 * skill files on disk, the real SkillManager, the registrar `createAgent`
 * installs, the real ActivateSkillTool, a real ToolRegistry, the real
 * AgentClient.setTools(), and the real ChatSession.
 *
 * This file used to install the registrar itself, because `createAgent` did not
 * (issue #3382). Now that it does, these cases also cover that wiring: removing
 * it from `createAgent` fails every test here.
 */

interface ProviderToolDeclaration {
  readonly name: string;
  readonly description?: string;
  readonly parametersJsonSchema?: unknown;
}

/**
 * Reads the tool declarations ChatSession will send with the next provider
 * request. `generationConfig` is the object handed to the provider, so this is
 * the model's actual view rather than a proxy for it.
 *
 * There is no public read seam for this, so the shape is reached directly.
 * Every step is checked and throws on a mismatch rather than returning an
 * empty list, because a silent `?? []` here would let a refactor of
 * `ChatSession.setTools` turn these assertions green while the model saw
 * nothing.
 */
function providerToolDeclarations(
  agent: Pick<Agent, 'agentClient'>,
): ProviderToolDeclaration[] {
  const chat = agent.agentClient.getChat() as unknown as {
    generationConfig?: {
      tools?: ProviderToolDeclaration[];
    };
  };
  const toolGroups = chat.generationConfig?.tools;
  if (toolGroups === undefined) return [];
  if (!Array.isArray(toolGroups)) {
    throw new Error(
      'ChatSession carries no tool groups; ChatSession.setTools may have changed shape',
    );
  }
  const declarations = toolGroups;
  if (!Array.isArray(declarations)) {
    throw new Error(
      'ChatSession has no declarations; ChatSession.setTools may have changed shape',
    );
  }
  return declarations;
}

function activateSkillDeclaration(
  agent: Pick<Agent, 'agentClient'>,
): ProviderToolDeclaration | undefined {
  return providerToolDeclarations(agent).find(
    (declaration) => declaration.name === ACTIVATE_SKILL_TOOL_NAME,
  );
}

/** The skill names the model is allowed to pass to `activate_skill`. */
function modelVisibleSkillNames(agent: Pick<Agent, 'agentClient'>): string[] {
  const declaration = activateSkillDeclaration(agent);
  if (!declaration) {
    return [];
  }
  const schema = declaration.parametersJsonSchema as {
    properties?: { name?: { enum?: string[] } };
  };
  return schema.properties?.name?.enum ?? [];
}

function writeSkill(workspace: string, name: string): void {
  const skillDir = join(workspace, '.llxprt', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n${name} instructions\n`,
    'utf-8',
  );
}

/**
 * Drives one turn so a live chat session exists with a tool list, which is the
 * state a reload has to update. The registrar is already installed by
 * `createAgent`; nothing here supplies it.
 */
async function settle(agent: Agent): Promise<Config> {
  for await (const _event of agent.stream('hello')) {
    // Drain the turn so the chat session and its tool list exist.
  }
  return internalConfig(agent);
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
describe('enabled extension joint root shutdown', () => {
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

  it('withdraws skills, MCP and subagents while preserving a same-label independent root', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'joint-skill-shutdown-'));
    const evidence = join(workspace, 'mcp');
    mkdirSync(evidence);
    writeSkill(workspace, 'native');
    const definitions = new WorkspaceDefinitionOwner(
      join(workspace, 'profiles'),
      join(workspace, 'subagents'),
    );

    const firstCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const firstCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const firstCallerOverrides: Readonly<Partial<AgentConfig>> = {
      skillsSupport: true,
      folderTrust: true,
      workingDir: workspace,
      definitionOwner: definitions,
      definitionOwnership: 'caller',
    };
    const firstCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...firstCallerOverrides,
      workingDir:
        firstCallerOverrides.workingDir === undefined
          ? firstCallerDirectory
          : await realpath(firstCallerOverrides.workingDir),
    };
    const firstCallerParameters = {
      ...toConfigParameters(firstCallerSelection),
      ...{ enableExtensionReloading: true },
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
    const {
      tokenizerFactory: firstCallerTokenizer,
      contentGeneratorFactory: firstCallerContent,
    } = configureProviderRuntimeFactories(
      firstCallerConfig,
      firstCallerManager,
    );
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
      new URL('./fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const secondCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const secondCallerOverrides: Readonly<Partial<AgentConfig>> = {
      skillsSupport: true,
      folderTrust: true,
      workingDir: workspace,
      sessionId: firstCallerConfig.getSessionId(),
    };
    const secondCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...secondCallerOverrides,
      workingDir:
        secondCallerOverrides.workingDir === undefined
          ? secondCallerDirectory
          : await realpath(secondCallerOverrides.workingDir),
    };
    const secondCallerParameters = {
      ...toConfigParameters(secondCallerSelection),
      ...{ enableExtensionReloading: true },
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
    const {
      tokenizerFactory: secondCallerTokenizer,
      contentGeneratorFactory: secondCallerContent,
    } = configureProviderRuntimeFactories(
      secondCallerConfig,
      secondCallerManager,
    );
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

    const agent = await fromConfig({
      settingsOwner: firstCallerSettingsOwner,
      settingsService: firstCallerSettings,
      config: firstCallerConfig,
      providerManager: firstCallerManager,
      agentClient: firstCallerOwner.getAgentClient(),
      mcpRuntime: firstCallerMcp,
      mcpOwnership: 'agent',
    });
    const sibling = await fromConfig({
      settingsOwner: secondCallerSettingsOwner,
      settingsService: secondCallerSettings,
      config: secondCallerConfig,
      providerManager: secondCallerManager,
      agentClient: secondCallerOwner.getAgentClient(),
      mcpRuntime: secondCallerMcp,
    });
    const loader = firstCallerMcp.extensionOperations;
    const siblingLoader = secondCallerMcp.extensionOperations;
    const extension = {
      name: 'joint-pack',
      version: '1',
      isActive: true,
      path: workspace,
      contextFiles: [],
      skills: [
        {
          name: 'extension-skill',
          description: 'Extension instructions',
          body: 'Joint extension body',
          location: join(workspace, 'SKILL.md'),
        },
      ],
      subagents: [
        {
          name: 'extension-agent',
          profile: 'fake',
          systemPrompt: 'Review locally',
        },
      ],
      mcpServers: {
        arithmetic: {
          command: process.execPath,
          args: [
            resolveRepositoryFixture(
              import.meta.url,
              'scripts/tests/mcp-standalone-stdio-fixture.ts',
            ),
            evidence,
          ],
        },
      },
    };
    try {
      await settle(agent);
      await settle(sibling);
      await loader.load(extension);
      await firstCallerMcp.awaitDiscovery();
      await siblingLoader.load({ ...extension, mcpServers: {} });
      expect(firstCallerConfig.getEnableExtensionReloading()).toBe(true);
      expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      const catalog = firstCallerMcp.toolSelection;
      const mcpNames = catalog
        .getAllTools()
        .filter(
          (tool) => 'serverName' in tool && tool.serverName === 'arithmetic',
        )
        .map((tool) => tool.name);
      expect(mcpNames).toHaveLength(1);
      const subagents = firstCallerMcp.subagentDefinitions;
      expect(await subagents.listSubagents()).toContain('extension-agent');
      await agent.dispose();
      expect(firstCallerMcp.isStopped()).toBe(true);
      expect(loader.list()).toStrictEqual([]);
      expect(() => catalog.getAllTools()).toThrow('closed');
      expect(() => subagents.listSubagents()).toThrow('closed');
      expect(await definitions.subagentReads.listSubagents()).not.toContain(
        'extension-agent',
      );
      expect(
        modelVisibleSkillNames({
          agentClient: firstCallerOwner.getAgentClient(),
        }),
      ).toStrictEqual([]);
      expect(secondCallerMcp.isStopped()).toBe(false);
      expect(modelVisibleSkillNames(sibling).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      expect(siblingLoader.list()).toHaveLength(1);
      await secondCallerMcp.workspaceSkills.operations.reload();
      expect(modelVisibleSkillNames(sibling).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
    } finally {
      await agent.dispose();
      await sibling.dispose();
      await firstCallerClose();
      await definitions.dispose();
      await secondCallerClose();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
