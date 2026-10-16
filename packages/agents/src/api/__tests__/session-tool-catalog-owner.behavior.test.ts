import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
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
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
  createTaskRegistration,
} from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { SessionToolCatalogOwner } from '../../session/session-tool-catalog-owner.js';
import { createMcpApprovalPolicy } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import {
  CheckAsyncTasksTool,
  ReadFileTool,
} from '@vybestack/llxprt-code-tools';
import { fromConfig } from '../fromConfig.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('session executable tool ownership', () => {
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
  async function openWorkspace(coreTools?: string[]): Promise<void> {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'session-tools-')));
    await writeFile(join(directory, 'input.txt'), 'seven physical apples');
    await openCaller('plain-text.jsonl', {
      workingDir: directory,
      coreTools,
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
  }
  async function closeWorkspace(): Promise<void> {
    await runCleanupSteps([
      callerClose,
      () => rm(directory, { recursive: true, force: true }),
    ]);
  }
  function adopt() {
    return fromConfig({
      settingsOwner: callerSettingsOwner,
      settingsService: callerSettings,
      config: callerConfig,
      providerManager: callerManager,
      mcpRuntime: callerMcp,
    });
  }

  it('publishes executable tooling from independent workspace ports', async () => {
    await openWorkspace();
    const config = callerConfig;
    const settingsOwner = callerSettingsOwner;
    const mcpRuntime = callerMcp;
    const catalog = new SessionToolCatalogOwner(
      config,
      () => settingsOwner.readRegistryPolicy([]),
      () => settingsOwner.readToolExecutionPolicy(),
    );
    const policy = mcpRuntime.policyOwner.session;
    const approval = createMcpApprovalPolicy(
      { ...policy.decisions, ...policy.confirmation },
      async () => undefined,
      () => undefined,
    );
    try {
      await catalog.initialize(
        () => mcpRuntime.isStopped(),
        mcpRuntime.workspacePaths,
        mcpRuntime.workspaceFiles,
        mcpRuntime.workspaceIgnore,
        mcpRuntime.workspaceScans,
        mcpRuntime.workspaceLsp.diagnostics,
        mcpRuntime.ide,
        mcpRuntime.trust,
        mcpRuntime.toolSelection,
        mcpRuntime.readInstructions,
        policy.messageBus,
        createTaskRegistration(),
        undefined,
        approval,
        emptyInstructionReads,
        () => settingsOwner.createChildStore(),
        () => settingsOwner.readTaskPolicy(),
        () => settingsOwner.readSubagentRunPolicy(),
        mcpRuntime.profileDefinitions,
        mcpRuntime.subagentDefinitions,
        undefined,
        settingsOwner.telemetry,
      );
      const read = catalog.selection.getTool('read_file');
      if (read === undefined) throw new Error('Missing published reader');
      const result = await read.buildAndExecute(
        { absolute_path: join(directory, 'input.txt') },
        new AbortController().signal,
      );
      expect(String(result.llmContent)).toContain('seven physical apples');
    } finally {
      await catalog.dispose();
      await closeWorkspace();
    }
  });

  it('registers an argument-specific ShellTool allowlist without registering ReadFileTool', async () => {
    await openWorkspace(['ShellTool(git status)']);
    const agent = await adopt();
    try {
      const shell = agent.tools.get('run_shell_command');
      expect(shell).toBeDefined();
      expect(agent.tools.get('read_file')).toBeUndefined();
      if (!shell) throw new Error('Missing governed shell');
      const result = await shell.buildAndExecute(
        { command: 'git status' },
        new AbortController().signal,
      );
      expect(String(result.llmContent)).toContain('not a git repository');
    } finally {
      await agent.dispose();
      await closeWorkspace();
    }
  });

  it('reads and writes physical files without selecting runtime tooling through Config', async () => {
    await openWorkspace();
    const agent = await adopt();
    Object.defineProperty(callerConfig, 'getToolRegistry', {
      configurable: true,
      value: (): never => {
        throw new Error('Config cannot select executable tooling');
      },
    });
    try {
      const input = agent.tools.get('read_file');
      const output = agent.tools.get('write_file');
      if (!input || !output) throw new Error('Missing physical file tools');
      const result = await input.buildAndExecute(
        { absolute_path: join(directory, 'input.txt') },
        new AbortController().signal,
      );
      expect(String(result.llmContent)).toContain('seven physical apples');
      await output.buildAndExecute(
        {
          absolute_path: join(directory, 'output.txt'),
          content: '49 apple pairs',
        },
        new AbortController().signal,
      );
      expect(await readFile(join(directory, 'output.txt'), 'utf8')).toBe(
        '49 apple pairs',
      );
    } finally {
      await agent.dispose();
      await closeWorkspace();
    }
  });

  it('rejects retained dispatch after disabling a tool and after facade disposal', async () => {
    await openWorkspace();
    const agent = await adopt();
    try {
      const tool = agent.tools.get('write_file');
      if (!tool) throw new Error('Missing write tool');
      const invocation = tool.build({
        absolute_path: join(directory, 'forbidden.txt'),
        content: 'must not be written',
      });
      callerSettings.set('tools.disabled', ['write_file']);
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow('unavailable');
      await expect(readFile(join(directory, 'forbidden.txt'))).rejects.toThrow(
        'ENOENT',
      );
      callerSettings.set('tools.disabled', []);
      await agent.dispose();
      await expect(
        tool.buildAndExecute(
          {
            absolute_path: join(directory, 'closed.txt'),
            content: 'must not be written',
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow('closed');
    } finally {
      await agent.dispose();
      await closeWorkspace();
    }
  });

  it('keeps executable file and shell tooling usable in a peer sharing the workspace', async () => {
    await openWorkspace();
    const first = await adopt();
    const second = await adopt();
    try {
      await first.dispose();
      const read = second.tools.get('read_file');
      const shell = second.tools.get('run_shell_command');
      if (!read || !shell) throw new Error('Peer tooling was withdrawn');
      expect(
        String(
          (
            await read.buildAndExecute(
              { absolute_path: join(directory, 'input.txt') },
              new AbortController().signal,
            )
          ).llmContent,
        ),
      ).toContain('seven physical apples');
      const output = await shell.buildAndExecute(
        { command: 'printf "%s" "$((7 * 7))"' },
        new AbortController().signal,
      );
      expect(String(output.llmContent)).toContain('49');
    } finally {
      await first.dispose();
      await second.dispose();
      await closeWorkspace();
    }
  });
  it('rejects a retained session shell invocation without writing after facade close', async () => {
    await openWorkspace();
    const agent = await adopt();
    try {
      const shell = agent.tools.get('run_shell_command');
      if (!shell) throw new Error('Missing shell tooling');
      const invocation = shell.build({
        command: 'printf forbidden > retained-shell.txt',
      });
      await agent.dispose();
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow('closed');
      await expect(
        readFile(join(directory, 'retained-shell.txt')),
      ).rejects.toThrow('ENOENT');
    } finally {
      await agent.dispose();
      await closeWorkspace();
    }
  });
  it('denies validated retained file dispatch after its session closes', async () => {
    await openWorkspace();
    const agent = await adopt();
    const signal = new AbortController().signal;
    const tool = agent.agentClient.tools.getTool('write_file');
    if (!tool) throw new Error('Missing executable writer');
    const file = join(directory, 'validated-retained.txt');
    try {
      await agent.dispose();
      await expect(
        tool.validateBuildAndExecute(
          { absolute_path: file, content: 'forbidden' },
          signal,
        ),
      ).rejects.toThrow('closed');
      await expect(readFile(file, 'utf8')).rejects.toThrow('ENOENT');
    } finally {
      await agent.dispose();
      await closeWorkspace();
    }
  });

  it('rejects a retained async task status invocation after session closure', async () => {
    await openWorkspace();
    const agent = await adopt();
    try {
      const status = agent.tools.get('check_async_tasks');
      if (!status) throw new Error('Missing task status tooling');
      const invocation = status.build({});
      await agent.dispose();
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow('closed');
    } finally {
      await agent.dispose();
      await closeWorkspace();
    }
  });
  it('denies direct retained asynchronous-status dispatch after session closure', async () => {
    await openWorkspace();
    const agent = await adopt();
    const status = agent.agentClient.tools.getTool('check_async_tasks');
    if (!(status instanceof CheckAsyncTasksTool))
      throw new Error('Missing status tool');
    try {
      await agent.dispose();
      await expect(status.execute({})).rejects.toThrow('closed');
    } finally {
      await agent.dispose();
      await closeWorkspace();
    }
  });
  it('closes retained executable admission synchronously when facade disposal starts', async () => {
    await openWorkspace();
    const agent = await adopt();
    const writer = agent.tools.get('write_file');
    if (!writer) throw new Error('Missing writer');
    try {
      const closing = agent.dispose();
      expect(() =>
        writer.build({
          absolute_path: join(directory, 'late.txt'),
          content: 'forbidden',
        }),
      ).toThrow('closed');
      await closing;
      await expect(
        readFile(join(directory, 'late.txt'), 'utf8'),
      ).rejects.toThrow('ENOENT');
    } finally {
      await agent.dispose();
      await closeWorkspace();
    }
  });
  it('rejects direct file reads when the caller has already cancelled admission', async () => {
    await openWorkspace();
    const agent = await adopt();
    try {
      const tool = agent.agentClient.tools.getTool('read_file');
      if (!(tool instanceof ReadFileTool)) throw new Error('Missing reader');
      const cancelled = new AbortController();
      const failure = new Error('Caller cancelled physical read');
      cancelled.abort(failure);
      await expect(
        tool.execute(
          { absolute_path: join(directory, 'input.txt') },
          cancelled.signal,
        ),
      ).rejects.toBe(failure);
    } finally {
      await agent.dispose();
      await closeWorkspace();
    }
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
