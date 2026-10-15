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
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import {
  buildAgent,
  internalConfig,
  type Agent,
} from './helpers/agentHarness.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fromConfig } from '@vybestack/llxprt-code-agents';
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
describe('workspace skill root lifetime @issue:2615', () => {
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
  const callerCredentials = useOwnedCredentials();
  async function withWorkspace(
    initialSkills: string[],
    run: (ctx: {
      agent: Agent;
      config: Config;
      workspace: string;
    }) => Promise<void>,
    operations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const workspace = mkdtempSync(join(tmpdir(), 'llxprt-skill-reload-'));
    for (const name of initialSkills) {
      writeSkill(workspace, name);
    }
    // The storage-isolation preload points LLXPRT_AGENTS_HOME at a temp root,
    // so discovery never reads the real ~/.agents/skills here; the strict set
    // assertions only ever see this workspace's skills.
    let agent: Agent;
    let cleanup: () => Promise<void>;
    if (operations === undefined) {
      const owned = await buildAgent('plain-text.jsonl', {
        skillsSupport: true,
        workingDir: workspace,
      });
      agent = owned.agent;
      cleanup = owned.cleanup;
    } else {
      const callerCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
        new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
      );
      const callerCallerDirectory = await realpath(
        await mkdtemp(join(tmpdir(), 'explicit-caller-')),
      );
      const callerCallerOverrides: Readonly<Partial<AgentConfig>> = {
        skillsSupport: true,
        workingDir: workspace,
      };
      const callerCallerSelection: AgentConfig = {
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        ...callerCallerOverrides,
        workingDir:
          callerCallerOverrides.workingDir === undefined
            ? callerCallerDirectory
            : await realpath(callerCallerOverrides.workingDir),
      };
      const callerCallerParameters = {
        ...toConfigParameters(callerCallerSelection),
        ...{},
      };
      callerCallerParameters.interactive = true;

      callerCallerParameters.includeDirectories = [
        ...(callerCallerParameters.includeDirectories ?? []),
        process.cwd(),
      ];
      const callerCallerConfig = new Config(callerCallerParameters);
      const callerCallerFactories = {
        ...createAgentRuntimeFactoryBindings(),
        ...{},
      };
      const callerCallerSettings = new SettingsService();
      for (const [key, value] of Object.entries(
        callerCallerConfig.getInitialSettings(),
      ))
        callerCallerSettings.set(key, value);
      const callerCallerPolicy = new RuntimePolicyOwner(callerCallerConfig);
      injectConfirmationForcingPolicy(callerCallerPolicy.session.confirmation);
      const callerCallerMcp = await buildTestMcpRuntime(
        callerCallerConfig,
        callerCallerPolicy.session.messageBus,
        callerCallerOverrides,
        undefined,
        callerCallerPolicy,
        operations,
      );
      const callerCallerRuntimeId = 'caller-' + randomUUID();
      const callerCallerRelease = new AcquisitionRelease();
      const callerCallerSettingsOwner = new SessionSettingsOwner(
        callerCallerSettings,
      );
      callerCallerRelease.acquire('settings', () =>
        callerCallerSettingsOwner.dispose(),
      );
      callerCallerSettingsOwner.initializeProviderSelection(
        callerCallerConfig.getProvider(),
        callerCallerConfig.getModel(),
      );
      callerCallerSettingsOwner.bindTelemetry(callerCallerConfig);
      const callerCallerFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of [
        callerCallerRuntimeId,
        callerCallerConfig.getSessionId(),
      ])
        callerCallerRelease.acquire('files', () =>
          releaseAdoptedFileScope(callerCallerFiles, scope),
        );
      const callerCallerManager = acquirePreferredProviderManager(
        callerCallerConfig,
        callerCallerSettings,
        callerCallerSettingsOwner,
        callerCallerFiles,
        callerCallerRuntimeId,
        callerCredentials().authority,
        callerCallerRelease,
      );
      const {
        tokenizerFactory: callerCallerTokenizer,
        contentGeneratorFactory: callerCallerContent,
      } = configureProviderRuntimeFactories(
        callerCallerConfig,
        callerCallerManager,
      );
      const callerCallerOAuth = acquirePreferredOAuth(
        undefined,
        callerCallerPolicy.session.messageBus,
        callerCallerConfig,
        callerCallerSettings,
        callerCallerManager,
        callerCallerRuntimeId,
        callerCallerMcp.profileDefinitions,
        callerCredentials().authority,
        callerCallerRelease,
        undefined,
      );
      const callerCallerMedia = new SessionMediaOwner(
        callerCallerConfig.projectTempDir,
        1024 * 1024 * 1024,
      );
      const callerCallerOwner = await SessionClientOwner.create(
        callerCallerConfig,
        assembleTaskSchemaPolicy(callerCallerSettings),
        callerCallerManager,
        callerCallerFactories.agentClientFactory,
        callerCallerMedia.store,
        callerCallerMcp.readInstructions,
        callerCallerMcp.workspacePaths,
        callerCallerSettingsOwner,
        callerCallerContent,
        callerCallerTokenizer,
      );
      callerCallerOwner.bindMcpRuntime(callerCallerMcp);
      callerCallerOwner.bindProviderFiles(callerCallerFiles, (provider) =>
        callerCallerOAuth.composeRetryOperations(provider),
      );
      callerCallerOwner.bindHooks();
      const callerCallerClose = settleEngineRelease.bind(
        undefined,
        [
          () => callerCallerOwner.dispose(),
          () => callerCallerRelease.close(),
          () => callerCallerMedia.dispose(),
          () => callerCallerMcp.dispose(),
          () => callerCallerConfig.dispose(),
          () => rm(callerCallerDirectory, { recursive: true, force: true }),
        ],
        callerCallerPreviousReplay,
      );
      try {
        await preparePreferredProviderCompletion(
          callerCallerConfig,
          callerCallerSettings,
          callerCallerSettingsOwner,
          callerCallerManager,
          callerCallerOAuth,
          callerCallerRuntimeId,
          callerCallerTokenizer,
          undefined,
        );
        await callerCallerMcp.initialize();
        const activation = await executeProviderActivation(
          callerCallerConfig,
          callerCallerSelection.activation ?? {
            provider: callerCallerConfig.getProvider(),
            model: callerCallerConfig.getModel(),
          },
          assembleProviderSwitch(
            callerCallerConfig,
            callerCallerSettings,
            callerCallerManager,
            callerCallerOAuth,
            () => 'agent',
            () => callerCallerOwner.refreshAuth(),
            callerCallerSettingsOwner,
          ),
          callerCallerSettings,
          callerCallerManager,
          (method) => callerCallerOwner.refreshAuth(method),
          assembleModelSelection(callerCallerSettingsOwner),
        );
        requireCallerActivation(activation);
        await callerCallerOwner.initializeTools();
        await callerCallerOwner.getAgentClient().startChat();
      } catch (primary) {
        await cleanupAfterFailure(primary, callerCallerClose);
      }

      agent = await fromConfig({
        config: callerCallerConfig,
        settingsOwner: callerCallerSettingsOwner,
        settingsService: callerCallerSettings,
        providerManager: callerCallerManager,
        agentClient: callerCallerOwner.getAgentClient(),
        mcpRuntime: callerCallerMcp,
      });
      cleanup = callerCallerClose;
    }
    try {
      const config = await settle(agent);
      await run({ agent, config, workspace });
    } finally {
      await agent.dispose();
      await cleanup();
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  const builtCredentials = useOwnedCredentials();

  it('keeps same-project same-label workspace catalogues and policy independent', async () => {
    await withWorkspace(
      ['alpha'],
      async ({ agent: first, config, workspace }) => {
        const second = await buildAgent('plain-text.jsonl', {
          skillsSupport: true,
          workingDir: workspace,
          sessionId: config.getSessionId(),
        });
        try {
          await settle(second.agent);
          config.setDisabledSkills(['alpha']);
          expect(first.skills.list()).toStrictEqual([]);
          expect(
            second.agent.skills.list().map((skill) => skill.name),
          ).toStrictEqual(['alpha']);
          writeSkill(workspace, 'beta');
          await first.skills.reload();
          expect(modelVisibleSkillNames(first)).toStrictEqual(['beta']);
          expect(modelVisibleSkillNames(second.agent)).toStrictEqual(['alpha']);
          await first.dispose();
          await second.agent.skills.reload();
          expect(modelVisibleSkillNames(second.agent).sort()).toStrictEqual([
            'alpha',
            'beta',
          ]);
        } finally {
          await second.cleanup();
        }
      },
    );
  });

  it('keeps caller Config identity and skills alive after borrowed facade disposal', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'borrowed-workspace-skills-'));
    writeSkill(workspace, 'alpha');

    const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
      skillsSupport: true,
      workingDir: workspace,
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
      ...{},
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

    let agent: Agent | undefined;
    try {
      agent = await fromConfig({
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        config: builtCallerConfig,
        providerManager: builtCallerManager,
        agentClient: builtCallerOwner.getAgentClient(),
        mcpRuntime: builtCallerMcp,
      });
      expect(internalConfig(agent)).toBe(builtCallerConfig);
      await settle(agent);
      await agent.dispose();
      writeSkill(workspace, 'beta');
      await builtCallerMcp.workspaceSkills.operations.reload();
      expect(
        builtCallerMcp.workspaceSkills.operations
          .list()
          .map((skill) => skill.name)
          .sort(),
      ).toStrictEqual(['alpha', 'beta']);
      expect('skillManager' in builtCallerConfig).toBe(false);
    } finally {
      await agent?.dispose();
      await builtCallerClose();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
