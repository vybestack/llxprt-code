import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  GenerateChatOptions,
  FakeProvider,
} from '@vybestack/llxprt-code-providers';
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
import { beforeAll, afterAll, describe, expect, it, spyOn } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import {
  fromConfig,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolConfirmationOutcome,
  type ToolResult,
  type ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-tools';
import { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface InvocationParams {
  readonly invocation: string;
}

class ExternalInvocation extends BaseToolInvocation<
  InvocationParams,
  ToolResult
> {
  constructor(
    params: InvocationParams,
    private readonly executeExternal: (
      invocation: string,
    ) => Promise<ToolResult>,
  ) {
    super(params);
  }

  getDescription(): string {
    return `Read external record ${this.params.invocation}`;
  }

  override async shouldConfirmExecute(): Promise<ToolCallConfirmationDetails> {
    return {
      type: 'info',
      title: 'Read record',
      prompt: this.getDescription(),
      onConfirm: async () => {},
    };
  }

  execute(): Promise<ToolResult> {
    return this.executeExternal(this.params.invocation);
  }
}

class ExternalTool extends BaseDeclarativeTool<InvocationParams, ToolResult> {
  constructor(
    private readonly executeExternal: (
      invocation: string,
    ) => Promise<ToolResult>,
  ) {
    super(
      'owner_record',
      'Owner record',
      'Read an external record',
      Kind.Read,
      {
        type: 'object',
        properties: { invocation: { type: 'string' } },
        required: ['invocation'],
      },
    );
  }

  protected createInvocation(params: InvocationParams): ExternalInvocation {
    return new ExternalInvocation(params, this.executeExternal);
  }
}

interface Observation {
  readonly events: readonly AgentEvent[];
  readonly rejection?: unknown;
}

async function collect(
  agent: Agent,
  signal: AbortSignal,
): Promise<Observation> {
  const events: AgentEvent[] = [];
  const iterator = agent
    .stream('Read my external record', {
      signal,
      mcpDiscovery: 'skip',
    })
    [Symbol.asyncIterator]();
  try {
    let next = await iterator.next();
    while (next.done !== true) {
      events.push(next.value);
      next = await iterator.next();
    }
    return { events };
  } catch (rejection) {
    return { events, rejection };
  } finally {
    await iterator.return?.();
  }
}

function successful(result: Observation): void {
  expect(result.rejection).toBeUndefined();
  expect(result.events.filter((event) => event.type === 'error')).toStrictEqual(
    [],
  );
  expect(result.events.filter((event) => event.type === 'done')).toStrictEqual([
    { type: 'done', reason: 'stop' },
  ]);
}

async function reached(
  boundary: Promise<void>,
  operation: Promise<Observation>,
  name: string,
): Promise<void> {
  await Promise.race([
    boundary,
    operation.then((result) => {
      throw new Error(`${name} was not reached: ${JSON.stringify(result)}`);
    }),
  ]);
}

function restoreEnvironment(
  previous: ReadonlyArray<readonly [string, string | undefined]>,
): void {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('Public Agent tool ownership (#2616 S1/S8, #2615 E)', () => {
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
  async function exerciseOwners(sameLabel: boolean): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'llxprt-same-label-tools-'));
    const envKeys = [
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_CACHE_HOME',
      'LLXPRT_LOG_HOME',
      'LLXPRT_FAKE_RESPONSES',
    ];
    const previous = envKeys.map((key) => [key, process.env[key]] as const);
    for (const key of envKeys.filter(
      (key) => key !== 'LLXPRT_FAKE_RESPONSES',
    )) {
      process.env[key] = root;
    }
    const callerCloses: Array<() => Promise<void>> = [];
    const agents: Agent[] = [];
    const restores: Array<() => void> = [];
    const releases: Array<() => void> = [];
    const pending: Array<Promise<Observation>> = [];
    const abort = new AbortController();
    const label = `tool-owner-${randomUUID()}`;

    async function owner(name: string, sessionId: string) {
      const modelEntered = gate();
      const modelRelease = gate();
      const toolEntered = gate();
      const toolRelease = gate();
      releases.push(modelRelease.release, toolRelease.release);
      let calls: readonly string[] = [];
      let requests: readonly IContent[][] = [];
      const approvals: string[] = [];

      const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
        new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
      );
      const builtCallerDirectory = await realpath(
        await mkdtemp(join(tmpdir(), 'explicit-caller-')),
      );
      const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
        sessionId,
        workingDir: root,
        folderTrust: true,
        telemetry: { enabled: false },
        recording: { enabled: false },
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
      const builtCallerTokenizer =
        configureProviderTokenizer(builtCallerManager);
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

      callerCloses.push(builtCallerClose);
      const externalTool = new ExternalTool(async (invocation) => {
        calls = [...calls, invocation];
        toolEntered.release();
        await toolRelease.promise;
        return {
          llmContent: `${name}-external-output:${invocation}`,
          returnDisplay: `${name} record`,
        };
      });
      let provider: unknown = builtCallerManager.getProviderByName('fake');
      while (
        typeof provider === 'object' &&
        provider !== null &&
        'wrappedProvider' in provider
      ) {
        provider = provider.wrappedProvider;
      }
      if (!(provider instanceof FakeProvider)) {
        throw new Error('Fixture requires the external FakeProvider boundary');
      }
      const model = spyOn(
        provider,
        'generateChatCompletion',
      ).mockImplementation(async function* (
        options: GenerateChatOptions | IContent[],
      ): AsyncIterableIterator<IContent> {
        const contents = Array.isArray(options) ? options : options.contents;
        requests = [...requests, structuredClone(contents)];
        const request = requests.length;
        if (request === 1) {
          modelEntered.release();
          await modelRelease.promise;
        }
        if (request % 2 === 1) {
          const invocation = `${name}-invocation-${(request + 1) / 2}`;
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: invocation,
                name: 'owner_record',
                parameters: { invocation },
              },
            ],
          };
        } else {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: `${name} finished` }],
          };
        }
      });
      restores.push(() => model.mockRestore());
      const agent = await fromConfig({
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        agentClient: builtCallerOwner.getAgentClient(),
        providerManager: builtCallerManager,
        config: builtCallerConfig,
        mcpRuntime: builtCallerMcp,
        messageBus: builtCallerPolicy.session.messageBus,
        sessionId,
        prepareSessionTools: (_config, _bus, tools) =>
          tools.registerTool(externalTool),
        onApproval: (confirmation) => {
          approvals.push(confirmation.toolCallId);
          return ToolConfirmationOutcome.ProceedOnce;
        },
      });
      agents.push(agent);
      return {
        agent,
        readCallerHistory: () => builtCallerOwner.getAgentClient().getHistory(),
        modelEntered,
        modelRelease,
        toolEntered,
        toolRelease,
        approvals,
        calls: () => calls,
        requests: () => requests,
      };
    }

    function start(agent: Agent): Promise<Observation> {
      const operation = collect(agent, abort.signal);
      pending.push(operation);
      return operation;
    }

    try {
      const a = await owner('alpha', label);
      const b = await owner('beta', sameLabel ? label : `${label}-other`);
      const first = start(a.agent);
      await reached(a.modelEntered.promise, first, 'alpha model');
      const second = start(b.agent);
      await reached(b.modelEntered.promise, second, 'beta model');
      b.modelRelease.release();
      await reached(b.toolEntered.promise, second, 'beta tool');
      a.modelRelease.release();
      await reached(a.toolEntered.promise, first, 'alpha tool');
      a.toolRelease.release();
      const firstResult = await first;
      successful(firstResult);
      await a.agent.dispose();
      b.toolRelease.release();
      const secondResult = await second;
      successful(secondResult);

      for (const [current, other, result, name] of [
        [a, b, firstResult, 'alpha'],
        [b, a, secondResult, 'beta'],
      ] as const) {
        const invocation = `${name}-invocation-1`;
        expect(current.calls()).toStrictEqual([invocation]);
        expect(current.approvals).toStrictEqual([invocation]);
        expect(
          result.events.filter((event) => event.type === 'tool-call'),
        ).toStrictEqual([
          {
            type: 'tool-call',
            call: {
              id: invocation,
              name: 'owner_record',
              args: { invocation },
            },
          },
        ]);
        const results = result.events.filter(
          (event) => event.type === 'tool-result',
        );
        expect(results).toHaveLength(1);
        expect(results[0]?.result).toMatchObject({
          id: invocation,
          name: 'owner_record',
          isError: false,
        });
        const ownOutput = `${name}-external-output:${invocation}`;
        const otherInvocation = other.calls()[0];
        expect(JSON.stringify(results)).toContain(ownOutput);
        expect(JSON.stringify(results)).not.toContain(otherInvocation);
        expect(current.requests()).toHaveLength(2);
        expect(JSON.stringify(current.requests()[1])).toContain(ownOutput);
        expect(JSON.stringify(current.requests()[1])).not.toContain(
          otherInvocation,
        );
      }
      const historyA = JSON.stringify(await a.readCallerHistory());
      const historyB = JSON.stringify(await b.agent.getHistory());
      expect(historyA).toContain('alpha-external-output:alpha-invocation-1');
      expect(historyA).not.toContain('beta-external-output');
      expect(historyB).toContain('beta-external-output:beta-invocation-1');
      expect(historyB).not.toContain('alpha-external-output');
      const next = await start(b.agent);
      successful(next);
      expect(b.calls()).toStrictEqual([
        'beta-invocation-1',
        'beta-invocation-2',
      ]);
      expect(b.requests()).toHaveLength(4);
      expect(JSON.stringify(b.requests()[3])).toContain(
        'beta-external-output:beta-invocation-2',
      );
      expect(JSON.stringify(await b.agent.getHistory())).not.toContain(
        'alpha-external-output',
      );
    } finally {
      abort.abort();
      releases.forEach((release) => release());
      await Promise.all(pending);
      try {
        await Promise.all(agents.map((agent) => agent.dispose()));
      } finally {
        restores.forEach((restore) => restore());
        await runCleanupSteps([...callerCloses].reverse());
        restoreEnvironment(previous);
        await rm(root, { recursive: true, force: true });
      }
    }
  }

  usePromptFixture();

  it('keeps distinct-label owners isolated through execution and disposal', async () => {
    expect(await exerciseOwners(false)).toBeUndefined();
  }, 30_000);

  it('keeps same-label owners isolated through execution and disposal', async () => {
    expect(await exerciseOwners(true)).toBeUndefined();
  }, 30_000);
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
