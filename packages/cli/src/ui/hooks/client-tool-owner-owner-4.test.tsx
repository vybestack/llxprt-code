import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../../../../agents/src/api/agentConfig.adapter.js';
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
import { act } from 'react';
import { renderHook, cleanup } from '../../__tests__/render.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import {
  type CompletedToolCall,
  type ToolCallRequestInfo,
  PolicyDecision,
} from '@vybestack/llxprt-code-core';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { useReactToolScheduler } from './useReactToolScheduler.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function gate() {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
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
describe('Agent-owned CLI client tools', () => {
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

  const configCredentials = useOwnedCredentials();

  const noop = (): void => {};

  const callerCloses: Array<() => Promise<void>> = [];

  const agents: Agent[] = [];

  const releases: Array<() => void> = [];

  const previousFake = process.env.LLXPRT_FAKE_RESPONSES;

  afterEach(async () => {
    cleanup();
    releases.splice(0).forEach((release) => release());
    await Promise.all(agents.splice(0).map((agent) => agent.dispose()));
    await runCleanupSteps(callerCloses.splice(0));
    if (previousFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousFake;
  });

  async function owner(
    name: string,
    decision = PolicyDecision.ALLOW,
    awaitReady = true,
  ) {
    const configCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/' + 'plain-text.jsonl',
        import.meta.url,
      ),
    );
    const configCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const configCallerOverrides: Readonly<Partial<AgentConfig>> = {
      sessionId: 'client-tool-equal-label',
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
    };
    const configCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...configCallerOverrides,
      workingDir: configCallerDirectory,
    };
    const configCallerParameters = {
      ...toConfigParameters(configCallerSelection),
      ...{},
    };
    configCallerParameters.interactive = true;

    configCallerParameters.includeDirectories = [
      ...(configCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const configCallerConfig = new Config(configCallerParameters);
    const configCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const configCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      configCallerConfig.getInitialSettings(),
    ))
      configCallerSettings.set(key, value);
    const configCallerPolicy = new RuntimePolicyOwner(configCallerConfig);
    injectConfirmationForcingPolicy(configCallerPolicy.session.confirmation);
    const configCallerMcp = await buildTestMcpRuntime(
      configCallerConfig,
      configCallerPolicy.session.messageBus,
      configCallerOverrides,
      undefined,
      configCallerPolicy,
      undefined,
    );
    const configCallerRuntimeId = 'caller-' + randomUUID();
    const configCallerRelease = new AcquisitionRelease();
    const configCallerSettingsOwner = new SessionSettingsOwner(
      configCallerSettings,
    );
    configCallerRelease.acquire('settings', () =>
      configCallerSettingsOwner.dispose(),
    );
    configCallerSettingsOwner.initializeProviderSelection(
      configCallerConfig.getProvider(),
      configCallerConfig.getModel(),
    );
    configCallerSettingsOwner.bindTelemetry(configCallerConfig);
    const configCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      configCallerRuntimeId,
      configCallerConfig.getSessionId(),
    ])
      configCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(configCallerFiles, scope),
      );
    const configCallerManager = acquirePreferredProviderManager(
      configCallerConfig,
      configCallerSettings,
      configCallerSettingsOwner,
      configCallerFiles,
      configCallerRuntimeId,
      configCredentials().authority,
      configCallerRelease,
    );
    const configCallerTokenizer =
      configureProviderTokenizer(configCallerManager);
    const configCallerContent = createRuntimeContentGeneratorFactory();
    const configCallerOAuth = acquirePreferredOAuth(
      undefined,
      configCallerPolicy.session.messageBus,
      configCallerConfig,
      configCallerSettings,
      configCallerManager,
      configCallerRuntimeId,
      configCallerMcp.profileDefinitions,
      configCredentials().authority,
      configCallerRelease,
      undefined,
    );
    const configCallerMedia = new SessionMediaOwner(
      configCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const configCallerOwner = await SessionClientOwner.create(
      configCallerConfig,
      assembleTaskSchemaPolicy(configCallerSettings),
      configCallerManager,
      configCallerFactories.agentClientFactory,
      configCallerMedia.store,
      configCallerMcp.readInstructions,
      configCallerMcp.workspacePaths,
      configCallerSettingsOwner,
      configCallerContent,
      configCallerTokenizer,
    );
    configCallerOwner.bindMcpRuntime(configCallerMcp);
    configCallerOwner.bindProviderFiles(configCallerFiles, (provider) =>
      configCallerOAuth.composeRetryOperations(provider),
    );
    configCallerOwner.bindHooks();
    const configCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => configCallerOwner.dispose(),
        () => configCallerRelease.close(),
        () => configCallerMedia.dispose(),
        () => configCallerMcp.dispose(),
        () => configCallerConfig.dispose(),
        () => rm(configCallerDirectory, { recursive: true, force: true }),
      ],
      configCallerPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        configCallerConfig,
        configCallerSettings,
        configCallerSettingsOwner,
        configCallerManager,
        configCallerOAuth,
        configCallerRuntimeId,
        configCallerTokenizer,
        undefined,
      );
      await configCallerMcp.initialize();
      const activation = await executeProviderActivation(
        configCallerConfig,
        configCallerSelection.activation ?? {
          provider: configCallerConfig.getProvider(),
          model: configCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          configCallerConfig,
          configCallerSettings,
          configCallerManager,
          configCallerOAuth,
          () => 'agent',
          () => configCallerOwner.refreshAuth(),
          configCallerSettingsOwner,
        ),
        configCallerSettings,
        configCallerManager,
        (method) => configCallerOwner.refreshAuth(method),
        assembleModelSelection(configCallerSettingsOwner),
      );
      requireCallerActivation(activation);
      await configCallerOwner.initializeTools();
      await configCallerOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, configCallerClose);
    }

    callerCloses.push(configCallerClose);
    configCallerPolicy.session.confirmation.addRule({
      toolName: 'external_record',
      decision,
      priority: 1000,
    });
    const entered = gate();
    const finish = gate();
    releases.push(finish.release);
    const effects: string[] = [];
    const record = new MockTool({
      name: 'external_record',
      shouldConfirmExecute: async () => ({
        type: 'info',
        title: name,
        prompt: name,
        onConfirm: async () => {},
      }),
      execute: async () => {
        effects.push(name);
        entered.release();
        await finish.promise;
        return {
          llmContent: `${name} result`,
          returnDisplay: `${name} display`,
        };
      },
    });
    const agent = await fromConfig(
      configCallerConfig,
      configCallerSettings,
      {},
      undefined,
      configCallerManager,
      undefined,
      configCallerPolicy.session.messageBus,
      configCallerMcp,
      undefined,
      configCallerOwner.getAgentClient(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (_config, _bus, tools) => tools.registerTool(record),
    );
    agents.push(agent);
    await agent.agentClient.startChat();
    const runtime = {
      scheduler: {},
      session: { getSessionId: () => configCallerConfig.getSessionId() },
      agent,
    };
    const completed: CompletedToolCall[][] = [];
    const hook = renderHook(() =>
      useReactToolScheduler(
        (_id, calls) => {
          completed.push(calls);
        },
        runtime,
        noop,
        () => undefined,
        noop,
      ),
    );
    if (awaitReady)
      await waitFor(() => expect(hook.result.current[5]).toBe(true));
    else hook.unmount();
    return {
      borrow: () =>
        fromConfig(
          configCallerConfig,
          configCallerSettings,
          {},
          undefined,
          configCallerManager,
          undefined,
          configCallerPolicy.session.messageBus,
          configCallerMcp,
          undefined,
          configCallerOwner.getAgentClient(),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          (_config, _bus, tools) => tools.registerTool(record),
        ),
      agent,
      hook,
      entered,
      finish,
      effects,
      completed,
      record,
    };
  }

  function request(callId: string): ToolCallRequestInfo {
    return {
      callId,
      name: 'external_record',
      args: {},
      isClientInitiated: true,
      prompt_id: callId,
    };
  }

  it('routes equal-call-id confirmations to their own bus', async () => {
    const a = await owner('alpha', PolicyDecision.ASK_USER);
    const b = await owner('beta', PolicyDecision.ASK_USER);
    act(() => {
      void a.hook.result.current[1](
        request('same-id'),
        new AbortController().signal,
      );
      void b.hook.result.current[1](
        request('same-id'),
        new AbortController().signal,
      );
    });
    await waitFor(() => {
      expect(a.hook.result.current[0][0]?.status).toBe('awaiting_approval');
      expect(b.hook.result.current[0][0]?.status).toBe('awaiting_approval');
    });
    const approval = a.hook.result.current[0][0];
    if (
      approval.status !== 'awaiting_approval' ||
      !('onConfirm' in approval.confirmationDetails)
    )
      throw new Error('Missing confirmation');
    const approve = approval.confirmationDetails.onConfirm;
    a.finish.release();
    await act(async () => {
      await approve(ToolConfirmationOutcome.ProceedOnce);
    });
    await waitFor(() => expect(a.completed).toHaveLength(1));
    expect(a.effects).toStrictEqual(['alpha']);
    expect(b.effects).toStrictEqual([]);
    expect(b.hook.result.current[0][0]?.status).toBe('awaiting_approval');
    const denial = b.hook.result.current[0][0];
    if (
      denial.status !== 'awaiting_approval' ||
      !('onConfirm' in denial.confirmationDetails)
    )
      throw new Error('Missing second confirmation');
    const deny = denial.confirmationDetails.onConfirm;
    await act(async () => {
      await deny(ToolConfirmationOutcome.Cancel);
    });
    await waitFor(() => expect(b.completed).toHaveLength(1));
    expect(b.completed[0]?.[0]?.status).toBe('cancelled');
  }, 30_000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
