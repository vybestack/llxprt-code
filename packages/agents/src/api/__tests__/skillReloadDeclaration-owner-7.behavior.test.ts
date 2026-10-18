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
import { internalConfig, type Agent } from './helpers/agentHarness.js';
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

function publicationGate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
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

  const builtCredentials = useOwnedCredentials();

  it('joins accepted queued reloads before withdrawing declarations and denying disposed activation', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'queued-workspace-skills-'));
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
    const builtCallerTokenizer = configureProviderTokenizer(builtCallerManager);
    const builtCallerContent = createRuntimeContentGeneratorFactory();
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

    const agent = await fromConfig(
      builtCallerConfig,
      builtCallerSettings,
      {},
      builtCallerSettingsOwner,
      builtCallerManager,
      undefined,
      undefined,
      builtCallerMcp,
      undefined,
      builtCallerOwner.getAgentClient(),
    );
    const entered = publicationGate();
    const released = publicationGate();
    const owner = builtCallerMcp.workspaceSkills;
    let disposal: Promise<void> | undefined;
    await settle(agent);
    const publish = builtCallerOwner
      .getAgentClient()
      .setTools.bind(builtCallerOwner.getAgentClient());
    const publications: string[][] = [];
    const fault = vi
      .spyOn(builtCallerOwner.getAgentClient(), 'setTools')
      .mockImplementation(async () => {
        await publish();
        publications.push(modelVisibleSkillNames(agent).sort());
        if (publications.length === 1) {
          entered.release();
          await released.promise;
        }
      });
    try {
      writeSkill(workspace, 'beta');
      const first = owner.operations.reload();
      await entered.promise;
      writeSkill(workspace, 'gamma');
      const queued = owner.operations.reload();
      disposal = owner.dispose();
      await expect(owner.operations.activate('alpha')).rejects.toThrow(
        'disposed',
      );
      await expect(owner.operations.reload()).rejects.toThrow('disposed');
      released.release();
      await first;
      await queued;
      await disposal;
      expect(publications).toStrictEqual([
        ['alpha', 'beta'],
        ['alpha', 'beta', 'gamma'],
        [],
      ]);
      expect(owner.operations.list()).toStrictEqual([]);
      expect(modelVisibleSkillNames(agent)).toStrictEqual([]);
      expect(agent.tools.get(ACTIVATE_SKILL_TOOL_NAME)).toBeUndefined();
      expect(builtCallerMcp.isStopped()).toBe(false);
      expect(builtCallerOwner.getAgentClient().isInitialized()).toBe(true);
      await builtCallerOwner.getAgentClient().setTools();
    } finally {
      released.release();
      fault.mockRestore();
      await disposal;
      await agent.dispose();
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
