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
import {
  ProviderFileLifecycle,
  GenerateChatOptions,
  FakeProvider,
  OpenAIProvider,
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
import {
  createAgent,
  fromConfig,
  AgentBusyError,
  type Agent,
  type AgentEvent,
  type TurnOptions,
} from '@vybestack/llxprt-code-agents';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Gate has not been initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface Observation {
  readonly events: readonly AgentEvent[];
  readonly rejection?: unknown;
}

async function collect(
  agent: Agent,
  input: string,
  options: TurnOptions,
): Promise<Observation> {
  return collectIterable(agent.stream(input, options));
}

async function collectIterable(
  stream: AsyncIterable<AgentEvent>,
): Promise<Observation> {
  const events: AgentEvent[] = [];
  try {
    for await (const event of stream) {
      events.push(event);
    }
    return { events };
  } catch (rejection) {
    return { events, rejection };
  }
}

function expectSuccessful(observation: Observation): void {
  expect(observation.rejection).toBeUndefined();
  expect(
    observation.events.filter((event) => event.type === 'error'),
  ).toStrictEqual([]);
  expect(
    observation.events.filter((event) => event.type === 'done'),
  ).toStrictEqual([{ type: 'done', reason: 'stop' }]);
}

async function beforeNextIO<T>(pending: Promise<T>): Promise<T | 'pending'> {
  let handle: ReturnType<typeof setImmediate> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<'pending'>((resolve) => {
        handle = setImmediate(() => resolve('pending'));
      }),
    ]);
  } finally {
    if (handle !== undefined) clearImmediate(handle);
  }
}

function expectTypedBusy(observation: Observation | 'pending'): void {
  expect(observation).not.toBe('pending');
  if (observation === 'pending') return;
  const errorEvent = observation.events.find((event) => event.type === 'error');
  expect(observation.rejection ?? errorEvent?.error).toBeInstanceOf(
    AgentBusyError,
  );
  expect(observation.rejection ?? errorEvent?.error).toMatchObject({
    code: 'busy',
  });
}

async function withAgent(run: (agent: Agent) => Promise<void>): Promise<void> {
  const agent = await createAgent({
    provider: 'openai',
    model: 'admission-model',
    auth: { apiKey: 'local-test-key', baseUrl: 'http://127.0.0.1:1/v1' },
    workingDir: process.cwd(),
    sessionId: 'admission-owner',
  });
  try {
    await run(agent);
  } finally {
    await agent.dispose();
  }
}

interface ModelBoundary {
  readonly entered: Promise<void>;
  readonly release: () => void;
  readonly requests: () => readonly string[];
  readonly start: (
    agent: Agent,
    input: string,
    options?: TurnOptions,
  ) => Promise<Observation>;
}

async function withModelBoundary(
  run: (boundary: ModelBoundary) => Promise<void>,
  failFirst = false,
  provider: 'openai' | 'fake' = 'openai',
): Promise<void> {
  const entered = gate();
  const blocked = gate();
  let requests: readonly string[] = [];
  const pending: Array<Promise<Observation>> = [];
  const model = spyOn(
    provider === 'fake' ? FakeProvider.prototype : OpenAIProvider.prototype,
    'generateChatCompletion',
  ).mockImplementation(async function* (
    options: GenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    const contents = Array.isArray(options) ? options : options.contents;
    requests = [
      ...requests,
      contents
        .flatMap((content) => content.blocks)
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    ];
    if (requests.length === 1) {
      entered.release();
      await blocked.promise;
      if (failFirst) {
        throw Object.assign(new Error('Injected model request failure'), {
          status: 400,
        });
      }
    }
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'complete' }] };
  });
  try {
    await run({
      entered: entered.promise,
      release: blocked.release,
      requests: () => requests,
      start: (agent, input, options = { mcpDiscovery: 'skip' }) => {
        const result = collect(agent, input, options);
        pending.push(result);
        return result;
      },
    });
  } finally {
    blocked.release();
    entered.release();
    await Promise.all(pending);
    model.mockRestore();
  }
}

describe('Agent admission ownership (#2616 S2/C)', () => {
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

  usePromptFixture();

  it('does not reserve admission for a never-started iterator and releases it on return', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const unused = agent.stream('Never advanced', { mcpDiscovery: 'skip' });
        model.release();
        const iterator = agent
          .stream('Returned early', { mcpDiscovery: 'skip' })
          [Symbol.asyncIterator]();
        try {
          expect((await iterator.next()).done).toBe(false);
          expectTypedBusy(await model.start(agent, 'Busy until return'));
        } finally {
          await iterator.return?.();
        }
        expectSuccessful(await model.start(agent, 'After return'));
        expectSuccessful(await collectIterable(unused));
      });
    });
  }, 30_000);

  it('preserves the internally signalled active run after rejecting a competing model command', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const first = model.start(agent, 'Internal controller run');
        await model.entered;
        await expect(
          agent.setModel('admission-model-next'),
        ).rejects.toBeInstanceOf(AgentBusyError);
        agent.injectSteer('Continue the original internally signalled run');
        expectTypedBusy(await beforeNextIO(model.start(agent, 'Still busy')));
        model.release();
        const result = await first;
        expect(result.rejection).toBeUndefined();
        expect(
          result.events.filter((event) => event.type === 'error'),
        ).toStrictEqual([]);
        expect(model.requests()).toHaveLength(2);
        expect(model.requests()[1]).toContain(
          'Continue the original internally signalled run',
        );
        await agent.setModel('admission-model-next');
        expectSuccessful(await model.start(agent, 'After rebuilt run'));
      });
    });
  }, 30_000);

  it.each([false, true])(
    'dispose cancels the captured run after a competing command is rejected (caller signal: %s)',
    async (callerSignal) => {
      await withAgent(async (agent) => {
        await withModelBoundary(async (model) => {
          const caller = new AbortController();
          const first = model.start(agent, 'Disposed run', {
            mcpDiscovery: 'skip',
            ...(callerSignal ? { signal: caller.signal } : {}),
          });
          await model.entered;
          await expect(
            agent.setModel('admission-model-next'),
          ).rejects.toBeInstanceOf(AgentBusyError);
          await agent.dispose();
          model.release();
          const result = await first;
          expect(result.events).toContainEqual({
            type: 'done',
            reason: 'aborted',
          });
          expect(caller.signal.aborted).toBe(false);
        });
      });
    },
    30_000,
  );
  it('completes sequential public streams through the real agent assembly', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        model.release();
        expectSuccessful(await model.start(agent, 'First ordinary turn'));
        expectSuccessful(await model.start(agent, 'Second ordinary turn'));
        expect(model.requests()).toHaveLength(2);
      });
    });
  }, 30_000);

  it('rejects a second ordinary stream with typed busy while the first model request is blocked', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const first = model.start(agent, 'Admitted turn');
        await model.entered;
        const second = model.start(agent, 'Must not reach the model');
        const rejection = await beforeNextIO(second);
        expect(model.requests()).toHaveLength(1);
        expectTypedBusy(rejection);
        model.release();
        expectSuccessful(await first);
      });
    });
  }, 30_000);

  it.each(['complete', 'fail', 'abort'])(
    'owns admission before discovery and releases after %s',
    async (outcome) => {
      await openbuiltCaller('plain-text.jsonl');
      let agent: Agent | undefined;
      try {
        const adopted = await fromConfig(
          builtCallerConfig,
          builtCallerSettings,
          {},
          builtCallerSettingsOwner,
          builtCallerManager,
          undefined,
          builtCallerPolicy.session.messageBus,
          builtCallerMcp,
          undefined,
          builtCallerOwner.getAgentClient(),
        );

        agent = adopted;
        await withModelBoundary(
          async (model) => {
            model.release();
            expectSuccessful(
              await model.start(adopted, 'Sequential discovery baseline', {}),
            );
            const discoveryEntered = gate();
            const discoveryRelease = gate();
            let discoveryWaits = 0;
            const abort = new AbortController();
            const discoveryError = new Error('Injected discovery failure');
            const discovery = spyOn(
              builtCallerMcp,
              'awaitDiscovery',
            ).mockImplementation(
              async (): Promise<ReadonlyMap<string, string>> => {
                discoveryWaits += 1;
                discoveryEntered.release();
                await discoveryRelease.promise;
                if (outcome === 'fail') throw discoveryError;
                return new Map();
              },
            );
            try {
              const first = model.start(adopted, 'Waiting for discovery', {
                signal: abort.signal,
              });
              const second = model.start(
                adopted,
                'Must be rejected before discovery',
                {},
              );
              if (
                (await beforeNextIO(discoveryEntered.promise)) === 'pending'
              ) {
                throw new Error(
                  'Setup: the first stream did not reach the external discovery boundary',
                );
              }
              const rejection = await beforeNextIO(second);
              expect(model.requests()).toHaveLength(1);
              expectTypedBusy(rejection);
              expect(discoveryWaits).toBe(1);
              if (outcome === 'abort') abort.abort();
              discoveryRelease.release();
              const result = await first;
              expect(result.rejection).toBe(
                outcome === 'fail' ? discoveryError : undefined,
              );
              const reason = outcome === 'abort' ? 'aborted' : 'stop';
              const expectedDone = (
                outcome === 'fail' ? [] : [{ type: 'done', reason }]
              ) satisfies AgentEvent[];
              expect(
                result.events.filter((event) => event.type === 'done'),
              ).toStrictEqual(expectedDone);
              expect(
                result.events.filter((event) => event.type === 'error'),
              ).toStrictEqual([]);
              expect(model.requests()).toHaveLength(
                outcome === 'complete' ? 2 : 1,
              );
              discovery.mockRestore();
              expectSuccessful(
                await model.start(adopted, 'After discovery turn', {}),
              );
            } finally {
              discoveryRelease.release();
              discoveryEntered.release();
              discovery.mockRestore();
            }
          },
          false,
          'fake',
        );
      } finally {
        try {
          await agent?.dispose();
        } finally {
          await builtCallerClose();
        }
      }
    },
    30_000,
  );

  it('releases admission after cancellation so the next ordinary stream completes', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const abort = new AbortController();
        try {
          const first = model.start(agent, 'Cancelled turn', {
            signal: abort.signal,
            mcpDiscovery: 'skip',
          });
          await model.entered;
          abort.abort();
          model.release();
          const cancelled = await first;
          expect(cancelled.events).toContainEqual({
            type: 'done',
            reason: 'aborted',
          });
          expectSuccessful(await model.start(agent, 'Turn after cancellation'));
          expect(model.requests()).toHaveLength(2);
        } finally {
          abort.abort();
        }
      });
    });
  }, 30_000);

  it.each([false, true])(
    'releases admission after a model failure (command conflicted: %s)',
    async (rebuild) => {
      await withAgent(async (agent) => {
        await withModelBoundary(async (model) => {
          const first = model.start(agent, 'Failed turn');
          await model.entered;
          const commandConflicted = rebuild
            ? await agent.setModel('admission-model-next').then(
                () => false,
                (error: unknown) => error instanceof AgentBusyError,
              )
            : false;
          expect(commandConflicted).toBe(rebuild);
          model.release();
          const failed = await first;
          expect(failed.events.some((event) => event.type === 'error')).toBe(
            true,
          );
          expectSuccessful(await model.start(agent, 'Turn after failure'));
          expect(model.requests()).toHaveLength(2);
        }, true);
      });
    },
    30_000,
  );

  it('lets two agents with the same session label execute independently', async () => {
    await withAgent(async (firstAgent) => {
      await withAgent(async (secondAgent) => {
        await withModelBoundary(async (model) => {
          expect(firstAgent.getRuntimeId()).toBe(secondAgent.getRuntimeId());
          const first = model.start(firstAgent, 'First agent stays blocked');
          await model.entered;
          expectSuccessful(
            await model.start(secondAgent, 'Second agent completes'),
          );
          expect(model.requests()).toHaveLength(2);
          model.release();
          expectSuccessful(await first);
        });
      });
    });
  }, 30_000);

  it('delivers steering to the admitted run without a configuration change', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const first = model.start(agent, 'Ordinary turn');
        await model.entered;
        agent.injectSteer('Include the admission follow-up');
        model.release();
        const completed = await first;
        expect(completed.rejection).toBeUndefined();
        expect(
          completed.events.filter((event) => event.type === 'error'),
        ).toStrictEqual([]);
        expect(model.requests()).toHaveLength(2);
        expect(model.requests()[1]).toContain(
          'Include the admission follow-up',
        );
      });
    });
  }, 30_000);

  it('keeps steering addressed to the admitted run after a rejected model change', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const abort = new AbortController();
        try {
          const first = model.start(agent, 'Run admitted before model change', {
            signal: abort.signal,
            mcpDiscovery: 'skip',
          });
          await model.entered;
          await expect(
            agent.setModel('admission-model-next'),
          ).rejects.toBeInstanceOf(AgentBusyError);
          expect(agent.getModel()).not.toBe('admission-model-next');
          agent.injectSteer('Keep this follow-up on the admitted run');
          model.release();
          const completed = await first;
          expect(completed.rejection).toBeUndefined();
          expect(
            completed.events.filter((event) => event.type === 'error'),
          ).toStrictEqual([]);
          expect(model.requests()).toHaveLength(2);
          expect(model.requests()[1]).toContain(
            'Keep this follow-up on the admitted run',
          );
        } finally {
          abort.abort();
        }
      });
    });
  }, 30_000);

  it('does not admit another ordinary stream after rejecting a competing rebuild', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const abort = new AbortController();
        try {
          const first = model.start(agent, 'Run admitted before rebuild', {
            signal: abort.signal,
            mcpDiscovery: 'skip',
          });
          await model.entered;
          await expect(
            agent.setModel('admission-model-next'),
          ).rejects.toBeInstanceOf(AgentBusyError);
          expect(agent.getModel()).not.toBe('admission-model-next');
          const second = model.start(
            agent,
            'Must not enter a replacement loop',
          );
          const rejection = await beforeNextIO(second);
          expect(model.requests()).toHaveLength(1);
          expectTypedBusy(rejection);
          model.release();
          expectSuccessful(await first);
        } finally {
          abort.abort();
        }
      });
    });
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
