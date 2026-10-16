import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
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
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
  vi,
} from 'bun:test';
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
import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
import { fromConfig } from '../fromConfig.js';
import { z } from 'zod';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { SkillPolicy } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';

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
describe('workspace registrar and skill reload root admission', () => {
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

  const credentials = useOwnedCredentials();

  let callerConfig: Config;

  let callerSettings: SettingsService;

  let callerSettingsOwner: SessionSettingsOwner;

  let callerPolicy: RuntimePolicyOwner;

  let callerMcp: McpRuntimeOwner;

  let callerManager: ReturnType<typeof acquirePreferredProviderManager>;

  let callerOwner: SessionClientOwner;

  let callerClose: () => Promise<void>;

  let callerFactories: AgentRuntimeFactoryBindings;

  let callerRelease: AcquisitionRelease;

  let callerFiles: ProviderFileLifecycle;

  let callerRuntimeId: string;

  let callerOAuth: ReturnType<typeof acquirePreferredOAuth>;

  let callerTokenizer: ReturnType<typeof configureProviderTokenizer>;

  let callerContent: ReturnType<typeof createRuntimeContentGeneratorFactory>;

  async function openCaller(
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
      await mkdtemp(join(tmpdir(), 'caller-adoption-')),
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
    callerConfig = new Config(parameters);
    callerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    callerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      callerConfig.getInitialSettings(),
    ))
      callerSettings.set(key, value);
    callerPolicy = new RuntimePolicyOwner(callerConfig);
    injectConfirmationForcingPolicy(callerPolicy.session.confirmation);
    callerMcp = await buildTestMcpRuntime(
      callerConfig,
      callerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      callerPolicy,
      skillOperations,
    );
    acquireCallerProviders();
    const media = new SessionMediaOwner(
      callerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    callerOwner = await SessionClientOwner.create(
      callerConfig,
      assembleTaskSchemaPolicy(callerSettings),
      callerManager,
      callerFactories.agentClientFactory,
      media.store,
      callerMcp.readInstructions,
      callerMcp.workspacePaths,
      callerSettingsOwner,
      callerContent,
      callerTokenizer,
    );
    callerOwner.bindMcpRuntime(callerMcp);
    callerOwner.bindProviderFiles(callerFiles, (provider) =>
      callerOAuth.composeRetryOperations(provider),
    );
    callerOwner.bindHooks();
    callerClose = settleEngineRelease.bind(
      undefined,
      [
        () => callerOwner.dispose(),
        () => callerRelease.close(),
        () => media.dispose(),
        () => callerMcp.dispose(),
        () => callerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        callerConfig,
        callerSettings,
        callerSettingsOwner,
        callerManager,
        callerOAuth,
        callerRuntimeId,
        callerTokenizer,
        undefined,
      );
      await callerMcp.initialize();
      await activateCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, callerClose);
    }
  }

  function acquireCallerProviders(): void {
    callerRuntimeId = 'caller-' + randomUUID();
    callerRelease = new AcquisitionRelease();
    callerSettingsOwner = new SessionSettingsOwner(callerSettings);
    callerRelease.acquire('settings', () => callerSettingsOwner.dispose());
    callerSettingsOwner.initializeProviderSelection(
      callerConfig.getProvider(),
      callerConfig.getModel(),
    );
    callerSettingsOwner.bindTelemetry(callerConfig);
    callerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [callerRuntimeId, callerConfig.getSessionId()])
      callerRelease.acquire('files', () =>
        releaseAdoptedFileScope(callerFiles, scope),
      );
    callerManager = acquirePreferredProviderManager(
      callerConfig,
      callerSettings,
      callerSettingsOwner,
      callerFiles,
      callerRuntimeId,
      credentials().authority,
      callerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(callerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    callerTokenizer = factoriesTokenizer;
    callerContent = factoriesContent;
    callerOAuth = acquirePreferredOAuth(
      undefined,
      callerPolicy.session.messageBus,
      callerConfig,
      callerSettings,
      callerManager,
      callerRuntimeId,
      callerMcp.profileDefinitions,
      credentials().authority,
      callerRelease,
      undefined,
    );
  }

  async function activateCallerClient(
    intent: ProviderActivationIntent = {
      provider: callerConfig.getProvider(),
      model: callerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      callerConfig,
      intent,
      assembleProviderSwitch(
        callerConfig,
        callerSettings,
        callerManager,
        callerOAuth,
        () => 'agent',
        () => callerOwner.refreshAuth(),
        callerSettingsOwner,
      ),
      callerSettings,
      callerManager,
      (method) => callerOwner.refreshAuth(method),
      assembleModelSelection(callerSettingsOwner),
    );
    requireCallerActivation(activation);
    await callerOwner.initializeTools();
    await callerOwner.getAgentClient().startChat();
  }

  let directory: string;

  let reloadPolicy: () => Promise<Partial<SkillPolicy>>;

  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-registrar-admission-')),
    );
    await writeSkill('alpha');
    reloadPolicy = async () => ({});
    const evidence = join(directory, 'mcp');
    await mkdir(evidence);
    await openCaller(
      'plain-text.jsonl',
      {
        workingDir: directory,
        skillsSupport: true,
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
        harness: { includeProcessCwd: false },
      },
      {},
      {},
      undefined,
      {
        reloadPolicy: () => reloadPolicy(),
        registerTools: registerActivateSkillTool,
      },
    );
    const failures = await callerMcp.awaitDiscovery();
    if (failures.size > 0)
      throw new Error(
        `Physical MCP discovery failed: ${JSON.stringify(Array.from(failures))}`,
      );
  });

  afterEach(async () => {
    try {
      await callerClose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function writeSkill(name: string): Promise<void> {
    const root = join(directory, '.agents', 'skills', name);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Instructions for ${name}\n---\n\nUse the ${name} operation.\n`,
    );
  }

  function gate(): { promise: Promise<void>; release(): void } {
    let release = (): void => {
      throw new Error('Gate not initialized');
    };
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  function modelNames(
    client: ReturnType<SessionClientOwner['getAgentClient']>,
  ): string[] {
    const parsed = z
      .object({
        generationConfig: z.object({
          tools: z
            .array(
              z.object({
                name: z.string(),
                parametersJsonSchema: z.unknown().optional(),
              }),
            )
            .optional(),
        }),
      })
      .parse(client.getChat());
    const declaration = parsed.generationConfig.tools?.find(
      (entry) => entry.name === 'activate_skill',
    );
    if (declaration === undefined) return [];
    return z
      .object({
        properties: z.object({ name: z.object({ enum: z.array(z.string()) }) }),
      })
      .parse(declaration.parametersJsonSchema)
      .properties.name.enum.sort();
  }

  async function adopted(
    turn = true,
  ): Promise<Awaited<ReturnType<typeof fromConfig>>> {
    const agent = await fromConfig({
      config: callerConfig,
      settingsOwner: callerSettingsOwner,
      settingsService: callerSettings,
      providerManager: callerManager,
      agentClient: callerOwner.getAgentClient(),
      mcpRuntime: callerMcp,
    });
    if (turn)
      for await (const event of agent.stream('hello')) {
        if (event.type === 'error') throw new Error('Physical turn failed');
      }
    return agent;
  }

  it('publishes a reload accepted before root closure and denies the next reload', async () => {
    const agent = await adopted();
    const entered = gate();
    const released = gate();
    reloadPolicy = async () => {
      entered.release();
      await released.promise;
      return {};
    };
    try {
      expect(modelNames(callerOwner.getAgentClient())).toStrictEqual(['alpha']);
      await writeSkill('beta');
      const accepted = callerMcp.workspaceSkills.operations.reload();
      await entered.promise;
      callerMcp.closeAdmission();
      await expect(
        callerMcp.workspaceSkills.operations.reload(),
      ).rejects.toThrow(/closed|disposed/);
      expect(modelNames(callerOwner.getAgentClient())).toStrictEqual(['alpha']);
      released.release();
      await accepted;
      expect(modelNames(callerOwner.getAgentClient())).toStrictEqual([
        'alpha',
        'beta',
      ]);
      expect(callerMcp.workspaceSkills.operations.find('beta')?.location).toBe(
        join(directory, '.agents', 'skills', 'beta', 'SKILL.md'),
      );
      await callerMcp.dispose();
      expect(modelNames(callerOwner.getAgentClient())).toStrictEqual([]);
    } finally {
      released.release();
      await agent.dispose();
    }
  });

  it('joins held publication and compensation before retiring the catalog', async () => {
    const agent = await adopted();
    const entered = gate();
    const released = gate();
    const primary = new Error('Held publication failed after mutation');
    const publish = callerOwner
      .getAgentClient()
      .setTools.bind(callerOwner.getAgentClient());
    const publications: string[][] = [];
    let candidateHeld = false;
    const fault = vi
      .spyOn(callerOwner.getAgentClient(), 'setTools')
      .mockImplementation(async (...args) => {
        await publish(...args);
        const names = modelNames(callerOwner.getAgentClient());
        if (candidateHeld || names.includes('beta')) publications.push(names);
        if (!candidateHeld && names.includes('beta')) {
          candidateHeld = true;
          entered.release();
          await released.promise;
          throw primary;
        }
      });
    let disposal: Promise<void> | undefined;
    try {
      await writeSkill('beta');
      const accepted = callerMcp.workspaceSkills.operations.reload();
      const result = accepted.catch((error: unknown) => error);
      await entered.promise;
      callerMcp.closeAdmission();
      let retired = false;
      disposal = callerMcp.dispose().then(() => {
        retired = true;
      });
      await Promise.resolve();
      expect(retired).toBe(false);
      await expect(
        callerMcp.workspaceSkills.operations.reload(),
      ).rejects.toThrow(/closed|disposed/);
      released.release();
      expect(await result).toBe(primary);
      await disposal;
      expect(publications).toStrictEqual([['alpha', 'beta'], ['alpha'], []]);
      expect(modelNames(callerOwner.getAgentClient())).toStrictEqual([]);
    } finally {
      released.release();
      fault.mockRestore();
      await disposal;
      await agent.dispose();
    }
  });

  it.each([false, true])(
    'closes borrowed facades in either order without closing their caller root: %s',
    async (reverse) => {
      const first = await adopted();
      const second = await adopted(false);
      try {
        const [closing, surviving] = reverse
          ? [second, first]
          : [first, second];
        await closing.dispose();
        await expect(closing.skills.reload()).rejects.toThrow('closed');
        await writeSkill('beta');
        await surviving.skills.reload();
        expect(
          surviving.skills
            .list()
            .map((skill) => skill.name)
            .sort(),
        ).toStrictEqual(['alpha', 'beta']);
        await surviving.dispose();
        await expect(surviving.skills.reload()).rejects.toThrow('closed');
        await writeSkill('gamma');
        await callerMcp.workspaceSkills.operations.reload();
        expect(
          callerMcp.workspaceSkills.operations
            .list()
            .map((skill) => skill.name)
            .sort(),
        ).toStrictEqual(['alpha', 'beta', 'gamma']);
        expect(callerMcp.isStopped()).toBe(false);
      } finally {
        await first.dispose();
        await second.dispose();
      }
    },
  );
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
