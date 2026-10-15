import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../../../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, afterEach } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../../../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../../../agents/src/api/model-selection.js';
import { AgentConfig } from '../../../../agents/src/api/config-types.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { act } from 'react';
import { cleanup, renderHook } from '../../__tests__/render.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { TaskTool } from '../../../../agents/src/tools/task.js';
import { SubAgentScope } from '../../../../agents/src/core/subagent.js';
import { SubagentOrchestrator } from '../../../../agents/src/core/subagentOrchestrator.js';
import { createStatelessRuntimeBundle } from '../../../../agents/src/core/__tests__/subagent-test-helpers.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import {
  PolicyDecision,
  AgentEventType,
  type ToolCallRequestInfo,
  type CompletedToolCall,
} from '@vybestack/llxprt-code-core';
import { useReactToolScheduler } from './useReactToolScheduler.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function gate() {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const noop = (): void => {};

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
describe('Mounted CLI child execution ownership', () => {
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

  const cleanupOwners: Array<() => Promise<void>> = [];

  const finishes: Array<() => void> = [];

  afterEach(async () => {
    cleanup();
    finishes.splice(0).forEach((finish) => finish());
    for (const dispose of cleanupOwners.splice(0).reverse()) await dispose();
  });

  async function owner(
    name: string,
    mounted = true,
    decision = PolicyDecision.ALLOW,
  ) {
    const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/' + 'plain-text.jsonl',
        import.meta.url,
      ),
    );
    const builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
      sessionId: 'equal-child-owner-label',
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
    };
    const builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...builtCallerOverrides,
      workingDir: builtCallerDirectory,
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

    const base = join(tmpdir(), 'llxprt-cli-child-scheduler-deletion');
    await mkdir(base, { recursive: true });
    const dir = await mkdtemp(resolve(base, 'child-fixture-'));
    const profiles = new ProfileManager(resolve(dir, 'profiles'));
    await profiles.saveProfile('child', {
      version: 1,
      provider: 'fake',
      model: 'fake-model',
      modelParams: {},
      ephemeralSettings: {},
    });
    const subagents = new SubagentManager(resolve(dir, 'subagents'), profiles);
    await subagents.saveSubagent('worker', 'child', 'Run one record tool.');
    const effects: string[] = [];
    const started = gate();
    const finish = gate();
    finishes.push(finish.release);
    builtCallerPolicy.session.confirmation.addRule({
      toolName: 'task',
      decision: PolicyDecision.ALLOW,
      priority: 10000,
    });
    builtCallerPolicy.session.confirmation.addRule({
      toolName: 'child_record',
      decision,
      priority: 10000,
    });
    const childRegistry = new ToolRegistry(
      builtCallerConfig,
      new CoreMessageBusAdapter(builtCallerPolicy.session.messageBus),
      assembleTaskSchemaPolicy(builtCallerSettings),
    );
    const parentRecord = new MockTool({
      name: 'child_record',
      execute: async () => {
        throw new Error('Parent registry must not execute the child tool');
      },
    });
    childRegistry.registerTool(
      new MockTool({
        name: 'child_record',
        canUpdateOutput: true,
        shouldConfirmExecute: async () => ({
          type: 'info',
          title: name,
          prompt: name,
          onConfirm: async () => {},
        }),
        execute: async (_args, signal, updateOutput) => {
          effects.push(name);
          updateOutput?.({
            mode: 'append',
            data: `${name} streaming child work`,
          });
          started.release();
          await Promise.race([
            finish.promise,
            new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else
                signal.addEventListener('abort', () => resolve(), {
                  once: true,
                });
            }),
          ]);
          signal.throwIfAborted();
          return {
            llmContent: `${name} child work`,
            returnDisplay: `${name} child display`,
          };
        },
      }),
    );
    let scope: SubAgentScope | undefined;
    const task = new TaskTool(builtCallerConfig, {
      createChildSettings: () => builtCallerSettingsOwner.createChildStore(),
      readRunPolicy: () => builtCallerSettingsOwner.readSubagentRunPolicy(),
      readTaskPolicy: () => builtCallerSettingsOwner.readTaskPolicy(),
      readGovernance: () =>
        builtCallerSettingsOwner.readToolGovernance(
          builtCallerConfig.getExcludeTools() ?? [],
        ),
      instructions: emptyInstructionReads,
      workspacePaths: builtCallerMcp.workspacePaths,
      readMcpInstructions: builtCallerMcp.readInstructions,
      messageBus: builtCallerPolicy.session.messageBus,
      isInteractiveEnvironment: () => true,
      orchestratorFactory: (messageBus) =>
        new SubagentOrchestrator({
          credentialAuthority: new CredentialAuthority(),
          workspaceTrust: builtCallerMcp.trust,
          createChildSettings: () =>
            builtCallerSettingsOwner.createChildStore(),
          readRunPolicy: () => builtCallerSettingsOwner.readSubagentRunPolicy(),
          instructions: emptyInstructionReads,
          workspacePaths: builtCallerMcp.workspacePaths,
          readMcpInstructions: builtCallerMcp.readInstructions,
          foregroundConfig: builtCallerConfig,
          toolRegistry: childRegistry,
          messageBus,
          profileManager: profiles,
          subagentManager: subagents,
          runtimeLoader: async (options) => {
            const bundle = createStatelessRuntimeBundle({
              history: new HistoryService(),
              toolRegistry: childRegistry,
              toolsView: {
                listToolNames: () => ['child_record'],
                getToolMetadata: (toolName) => ({
                  name: toolName,
                  description: toolName,
                  parameterSchema: { type: 'object', properties: {} },
                }),
              },
            });
            return loadAgentRuntime({
              ...options,
              overrides: {
                ...options.overrides,
                historyService: new HistoryService(),
                toolsView: bundle.toolsView,
                contentGenerator: bundle.contentGenerator,
              },
            });
          },
          scopeFactory: async (
            childName,
            config,
            prompt,
            model,
            run,
            tools,
            outputs,
            runtime,
            generator,
            telemetry,
            registry,
            view,
            instructions,
            paths,
            readMcp,
            bus,
            settings,
            _environment,
            readApproval,
            admitParameters,
            lifecycle,
            hooks,
            retryFailover,
            readBucket,
            signal,
          ) => {
            let turn = 0;
            scope = await SubAgentScope.create(
              childName,
              config,
              prompt,
              model,
              run,
              tools,
              outputs,
              runtime,
              generator,
              telemetry,
              registry,
              view,
              instructions,
              paths,
              readMcp,
              bus,
              settings,
              async () => [],
              readApproval,
              admitParameters,
              lifecycle,
              hooks,
              retryFailover,
              readBucket,
              signal,
              {
                createTurn: (_chat, promptId, agentId) => {
                  const requests: ToolCallRequestInfo[] =
                    turn++ === 0
                      ? [
                          {
                            callId: 'same-child-call',
                            name: 'child_record',
                            args: {},
                            prompt_id: promptId,
                            agentId,
                            isClientInitiated: false,
                          },
                        ]
                      : [];
                  return {
                    pendingToolCalls: requests,
                    async *run() {
                      yield {
                        type: AgentEventType.Content,
                        value: requests.length > 0 ? 'Recording' : 'Done',
                      };
                    },
                  };
                },
              },
            );
            return scope;
          },
        }),
    });
    const agent: Agent = await fromConfig({
      settingsService: builtCallerSettings,
      settingsOwner: builtCallerSettingsOwner,
      prepareSessionTools: (_config, _bus, tools) => {
        tools.registerTool(parentRecord);
        tools.registerTool(task);
      },
      agentClient: builtCallerOwner.getAgentClient(),
      providerManager: builtCallerManager,
      config: builtCallerConfig,
      mcpRuntime: builtCallerMcp,
      messageBus: builtCallerPolicy.session.messageBus,
    });
    cleanupOwners.push(async () => {
      await agent.dispose();
      await builtCallerConfig.dispose();
      await builtCallerClose();
      await rm(dir, { recursive: true, force: true });
    });
    const completed: Array<{ primary: boolean; calls: CompletedToolCall[] }> =
      [];
    const runtime = { agent };
    const hook = mounted
      ? renderHook(() =>
          useReactToolScheduler(
            (_id, calls, options) => {
              completed.push({ primary: options.isPrimary, calls });
            },
            runtime,
            noop,
            () => undefined,
            noop,
          ),
        )
      : undefined;
    if (hook) await waitFor(() => expect(hook.result.current[5]).toBe(true));
    const channel = mounted ? undefined : agent.tools.openClientChannel();
    if (channel) await channel.ready;
    async function run(detached = false) {
      const request: ToolCallRequestInfo = {
        callId: `${name}-task`,
        name: 'task',
        args: {
          subagent_name: 'worker',
          goal_prompt: 'Record work',
          tool_whitelist: ['child_record'],
        },
        prompt_id: `${name}-prompt`,
        isClientInitiated: false,
      };
      if (detached) {
        const execution = agent.tools.openClientChannel();
        try {
          await execution.schedule(request, new AbortController().signal);
        } finally {
          await execution.release();
        }
      } else if (hook)
        await hook.result.current[1](request, new AbortController().signal);
      else await channel?.schedule(request, new AbortController().signal);
    }
    return {
      agent,
      hook,
      completed,
      started,
      finish,
      effects,
      run,
      getScope: () => scope,
    };
  }

  it('cancels child work through its owning task signal', async () => {
    const a = await owner('cancel');
    let run!: Promise<void>;
    act(() => {
      run = a.run();
    });
    await a.started.promise;
    act(() => {
      a.hook?.result.current[3]();
    });
    await act(async () => {
      await run;
    });
    expect(a.effects).toStrictEqual(['cancel']);
    expect(
      a.completed
        .flatMap((entry) => entry.calls)
        .some((call) => call.status === 'cancelled'),
    ).toBe(true);
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
