import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import {
  mkdtemp,
  realpath,
  rm,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
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
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
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

  let callerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];

  let callerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

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
    const factories = configureProviderRuntimeFactories(
      callerConfig,
      callerManager,
    );
    callerTokenizer = factories.tokenizerFactory;
    callerContent = factories.contentGeneratorFactory;
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
    directory = await mkdtemp(join(tmpdir(), 'workspace-registrar-admission-'));
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

  it('discovers actual skill files, activates their contents and registers their schema', async () => {
    const mcpRuntime = callerMcp;
    const skill = mcpRuntime.workspaceSkills.operations.find('alpha');
    if (skill === undefined)
      throw new Error('Physical skill was not discovered');
    const result =
      await mcpRuntime.workspaceSkills.operations.activate('alpha');
    expect(
      mcpRuntime.toolSelection
        .getFunctionDeclarations()
        .map((tool) => tool.name),
    ).toContain('mcp__arithmetic__sum');
    expect(result.success).toBe(true);
    if (result.instructions === undefined)
      throw new Error('Skill activation did not return instructions');
    expect(await readFile(skill.location, 'utf8')).toContain(
      result.instructions,
    );
    expect(
      mcpRuntime.toolSelection
        .getFunctionDeclarations()
        .map((tool) => tool.name),
    ).toContain('activate_skill');
    expect(
      mcpRuntime.workspaceSkills.operations.list().map((entry) => entry.name),
    ).toStrictEqual(['alpha']);
  });

  it('does not retain registrar or skill reload executable authority on Config', () => {
    const config = callerConfig;
    for (const name of [
      'postSkillDiscoveryToolRegistrar',
      'getPostSkillDiscoveryToolRegistrar',
      'setPostSkillDiscoveryToolRegistrar',
      '_onReload',
      'getSkillSettingsReloader',
    ]) {
      expect(name in config).toBe(false);
    }
  });

  it('rejects a skill reload admitted after root closure without publishing new files', async () => {
    const mcpRuntime = callerMcp;
    expect(
      mcpRuntime.workspaceSkills.operations.list().map((skill) => skill.name),
    ).toStrictEqual(['alpha']);
    await writeSkill('beta');
    mcpRuntime.closeAdmission();
    await expect(
      mcpRuntime.workspaceSkills.operations.reload(),
    ).rejects.toThrow(/closed|disposed|stopped/);
    expect(
      mcpRuntime.workspaceSkills.operations.list().map((skill) => skill.name),
    ).toStrictEqual(['alpha']);
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
