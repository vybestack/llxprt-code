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
import { beforeAll, afterAll, describe, expect, it, vi } from 'bun:test';
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
import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
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

describe('workspace skill publication compensation', () => {
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
      const callerCallerTokenizer =
        configureProviderTokenizer(callerCallerManager);
      const callerCallerContent = createRuntimeContentGeneratorFactory();
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

  useOwnedCredentials();

  it('restores actual provider declarations and registration after publication mutates then rejects', async () => {
    await withWorkspace(
      ['alpha'],
      async ({ agent, config, workspace }) => {
        expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
        const publish = agent.agentClient.setTools.bind(agent.agentClient);
        const fault = vi
          .spyOn(agent.agentClient, 'setTools')
          .mockImplementationOnce(async () => {
            await publish();
            expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
              'beta',
            ]);
            throw new Error('publication failed after mutation');
          });
        writeSkill(workspace, 'beta');
        try {
          await expect(agent.skills.reload()).rejects.toThrow(
            'publication failed after mutation',
          );
          expect(config.getDisabledSkills()).toStrictEqual([]);
          expect(agent.skills.list().map((skill) => skill.name)).toStrictEqual([
            'alpha',
          ]);
          expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
        } finally {
          fault.mockRestore();
        }
      },
      {
        reloadPolicy: async () => ({ disabledSkills: ['alpha'] }),
        registerTools: registerActivateSkillTool,
      },
    );
  });

  it('reports the publication and compensation failures after restoring the real registration', async () => {
    await withWorkspace(['alpha'], async ({ agent, workspace }) => {
      expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
      const publish = agent.agentClient.setTools.bind(agent.agentClient);
      const failed = new Error('candidate publication failed');
      const compensation = new Error('compensation publication failed');
      const fault = vi
        .spyOn(agent.agentClient, 'setTools')
        .mockImplementationOnce(async () => {
          await publish();
          throw failed;
        })
        .mockImplementationOnce(async () => {
          await publish();
          throw compensation;
        });
      writeSkill(workspace, 'beta');
      try {
        const error: unknown = await agent.skills
          .reload()
          .catch((reason: unknown) => reason);
        if (!(error instanceof Error) || !('cause' in error))
          throw new Error(
            'Expected a control error with its publication cause',
          );
        expect(error.cause).toBeInstanceOf(AggregateError);
        if (!(error.cause instanceof AggregateError))
          throw new Error('Expected aggregated publication errors');
        expect(error.cause.errors).toStrictEqual([failed, compensation]);
        expect(modelVisibleSkillNames(agent)).toStrictEqual(['alpha']);
      } finally {
        fault.mockRestore();
      }
    });
  });
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
