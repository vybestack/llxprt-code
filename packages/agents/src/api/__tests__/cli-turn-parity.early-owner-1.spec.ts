import { ownerClients } from './helpers/session-client-capture.js';
import { bindTurnModel } from '../../session/bind-turn-model.js';
import { TurnToolExecutionOwner } from '../../session/turn-tool-execution-owner.js';
import { bindSchedulerOwner } from '../../session/assembleSchedulerOwner.js';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import {
  useConsumerPromptDirectory,
  acquireConsumerPolicy,
  acquireConsumerRelease,
  selectConsumerTokenizer,
  createConsumerContentGenerator,
  acquireConsumerMedia,
  createConsumerSessionClient,
} from './helpers/consumer-owner-primitives.js';

import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { preparePreferredProviderCompletion } from '../preferred-provider-acquisition.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from './helpers/provider-acquisition.js';

import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';

import { describe, expect, it } from 'bun:test';

import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { projectEvents, type MessageBus } from './helpers/fixture-data.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';

import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import {
  resolveShellJobSettings,
  AsyncTaskManager,
} from '@vybestack/llxprt-code-core';
import {
  withFixtureAgent,
  drain,
  createAgent,
} from './helpers/agentHarness.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core';
import { TaskLaunchOwner } from '../../session/task-launch-owner.js';
import {
  createAgenticLoop,
  mapLoopStream,
  type AgentEvent,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P07
 * @requirement:REQ-INT-001,REQ-INT-002
 *
 * Early integration-first CLI turn-parity slice. Drives the public
 * `fromConfig` path against the CLI's reference `AgenticLoop` drive over a
 * REAL FakeProvider fixture.
 *
 * P09 Frozen-Driver Correction (applied to the P07 driver):
 *
 * The P07 driver was internally inconsistent and could never reach GREEN even
 * with a correct `fromConfig`. Two defects were masked at P07 because the
 * `fromConfig` stub rejected before reaching the tool drive. Both are
 * corrected here so the SAME behavioral assertions pass with no weakening:
 *
 *   Defect #1 (confirmation deadlock): the helper sets `interactive: true`
 *   and injects a priority-4.0 forcing-ASK policy, and the
 *   `parity-toolcall.jsonl` fixture issues a `read_file` tool call. Path B
 *   (the reference `AgenticLoop`) is constructed with an approval handler
 *   returning `ProceedOnce`, but Path A called `fromConfig({ config })` with
 *   no approval handler, so the tool's `TOOL_CONFIRMATION_REQUEST` was never
 *   answered and the turn hung indefinitely. Path A now mirrors Path B's
 *   approval semantics by passing
 *   `onApproval: () => ToolConfirmationOutcome.ProceedOnce` to every
 *   `fromConfig` call. This matches the established headless-approval pattern
 *   across this suite (core-tools.spec.ts T11, agent-bootstrap.spec.ts:443,
 *   disposal.spec.ts:123). A silent auto-approve default inside `fromConfig`
 *   is intentionally NOT introduced (it would be a security smell).
 *
 *   Defect #2 (fixture starvation): EP2/EP3 drove Path A then Path B over the
 *   SAME single built Config whose FakeProvider fixture has a finite 2-turn
 *   script. Path A consumed the script, leaving Path B to run on the drained
 *   Config and end with `doneReason: "error"`, so the projected-equality
 *   assertion could never hold. Each path now drives an independent
 *   fixture-config (its own Config + MessageBus + FakeProvider script) so
 *   neither drains the other. Both configs are cleaned up in `finally`.
 *
 * Coordinator probe evidence (proving the defects were in the DRIVER, not in
 * `fromConfig`): supplying `onApproval: () => ProceedOnce` to `fromConfig`
 * over `parity-toolcall.jsonl` drove the tool turn to exactly one terminal
 * `done` in ~180ms with no hang; and with each path given its own
 * `buildCliStyleConfig('parity-toolcall.jsonl')` plus Path A given the
 * `ProceedOnce` handler, `projectEvents(pathA)` `toStrictEqual`
 * `projectEvents(pathB)` passed (tool=`read_file`, one `done`).
 *
 * NO behavioral assertion was weakened, relaxed, deleted, or skipped. Every
 * original `expect(...)` — the projected-equality checks, the
 * `toHaveLength(1)` done/tool-call checks, and the `toBe('read_file')` anchor
 * — is preserved verbatim. The property generators and run ratio are
 * unchanged.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Drives the reference AgenticLoop (Path B) over the Config's agentClient and
 * maps its AgenticLoopEvents through the public event adapter to AgentEvents,
 * so Path A and Path B project to the SAME comparable event space.
 */
async function driveReferenceLoop(
  config: Config,
  settingsOwner: SessionSettingsOwner,
  settingsService: SettingsService,
  agentClient: AgentClientContract,
  messageBus: MessageBus,
  input: string,
): Promise<readonly AgentEvent[]> {
  const approvalHandler = async () => ({
    outcome: ToolConfirmationOutcome.ProceedOnce,
  });
  const taskLaunchOwner = new TaskLaunchOwner(new AsyncTaskManager());
  const loop = createAgenticLoop({
    readShellJobSettings: () => resolveShellJobSettings(settingsService),
    config,
    interactiveMode: false,
    displayCallbacks: {},
    ...bindTurnModel(agentClient),
    taskLaunchOwner,
    acquireTools: (decorateScheduler) =>
      new TurnToolExecutionOwner(
        messageBus,
        approvalHandler,
        bindSchedulerOwner(
          config,
          messageBus,
          false,
          agentClient.tools,
          decorateScheduler((options) => new CoreToolScheduler(options)),
          () => settingsOwner.readToolExecutionPolicy(),
          () =>
            settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
          undefined,
          settingsOwner.telemetry,
        ),
      ),
  });
  const controller = new AbortController();
  const loopEvents = loop.run(input, controller.signal);
  const agentEvents = mapLoopStream(loopEvents);
  try {
    return await drain(agentEvents);
  } finally {
    taskLaunchOwner.closeAdmissionAndAbort();
    await taskLaunchOwner.join();
  }
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
describe('CLI turn-parity (early RED) @plan:PLAN-20260621-COREAPIREMED.P07 @requirement:REQ-INT-001 @requirement:REQ-INT-002', () => {
  useConsumerPromptDirectory();

  const builtCredentials = useOwnedCredentials();
  const builtRefCredentials = useOwnedCredentials();

  it('EP2 Path A (fromConfig stream) projects identically to Path B (reference AgenticLoop) over the same fixture (REQ-INT-002)', async () => {
    const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'parity-toolcall.jsonl', import.meta.url),
    );
    const builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    try {
      // Path A: the public createAgent agent drives a turn over its OWN
      // Config + MessageBus + FakeProvider script so it does not drain the
      // Path B reference drive.
      const agent: Agent = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: builtCallerDirectory,
        interactive: true,
        includeDirectories: [process.cwd()],
        harness: {
          forceInteractive: false,
          forceConfirmations: false,
          includeProcessCwd: false,
        },
        credentialAuthority: builtCredentials().authority,
        onApproval: () => ToolConfirmationOutcome.ProceedOnce,
      });
      return await withFixtureAgent(agent, async () => {
        const pathAEvents = await drain(agent.stream('hello'));
        const pathA = projectEvents(pathAEvents);

        const builtRefCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
        process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
          new URL('fixtures/' + 'parity-toolcall.jsonl', import.meta.url),
        );
        const builtRefCallerDirectory = await realpath(
          await mkdtemp(join(tmpdir(), 'explicit-caller-')),
        );
        const builtRefCallerOverrides: Readonly<Partial<AgentConfig>> = {};
        const builtRefCallerSelection: AgentConfig = {
          provider: 'fake',
          model: 'fake-model',
          sessionId: randomUUID(),
          ...builtRefCallerOverrides,
          workingDir: builtRefCallerDirectory,
        };
        const builtRefCallerParameters = {
          ...toConfigParameters(builtRefCallerSelection),
          ...{},
        };
        builtRefCallerParameters.interactive = true;

        builtRefCallerParameters.includeDirectories = [
          ...(builtRefCallerParameters.includeDirectories ?? []),
          process.cwd(),
        ];
        const builtRefCallerConfig = new Config(builtRefCallerParameters);
        const builtRefCallerFactories = {
          agentClientFactory: buildAgentClientFactory(),
        };
        const builtRefCallerSettings = new SettingsService();
        for (const [key, value] of Object.entries(
          builtRefCallerConfig.getInitialSettings(),
        ))
          builtRefCallerSettings.set(key, value);
        const builtRefCallerPolicy =
          acquireConsumerPolicy(builtRefCallerConfig);

        const builtRefCallerMcp = await buildTestMcpRuntime(
          builtRefCallerConfig,
          builtRefCallerPolicy.session.messageBus,
          builtRefCallerOverrides,
          undefined,
          builtRefCallerPolicy,
          undefined,
        );
        const builtRefCallerRuntimeId = 'caller-' + randomUUID();

        const builtRefCallerSettingsOwner = new SessionSettingsOwner(
          builtRefCallerSettings,
        );

        builtRefCallerSettingsOwner.initializeProviderSelection(
          builtRefCallerConfig.getProvider(),
          builtRefCallerConfig.getModel(),
        );
        builtRefCallerSettingsOwner.bindTelemetry(builtRefCallerConfig);
        const builtRefCallerFiles = new ProviderFileLifecycle({
          maxFiles: 100,
          maxBytes: 512 * 1024 * 1024,
        });
        const builtRefCallerRelease = acquireConsumerRelease(
          builtRefCallerSettingsOwner,
          builtRefCallerFiles,
          builtRefCallerRuntimeId,
          builtRefCallerConfig.getSessionId(),
        );
        const builtRefCallerManager = acquirePreferredProviderManager(
          builtRefCallerConfig,
          builtRefCallerSettings,
          builtRefCallerSettingsOwner,
          builtRefCallerFiles,
          builtRefCallerRuntimeId,
          builtRefCredentials().authority,
          builtRefCallerRelease,
        );
        const builtRefCallerTokenizer = selectConsumerTokenizer(
          builtRefCallerManager,
        );
        const builtRefCallerContent = createConsumerContentGenerator();
        const builtRefCallerOAuth = acquirePreferredOAuth(
          undefined,
          builtRefCallerPolicy.session.messageBus,
          builtRefCallerConfig,
          builtRefCallerSettings,
          builtRefCallerManager,
          builtRefCallerRuntimeId,
          builtRefCallerMcp.profileDefinitions,
          builtRefCredentials().authority,
          builtRefCallerRelease,
          undefined,
        );
        const builtRefCallerMedia = acquireConsumerMedia(
          builtRefCallerConfig,
          1024 * 1024 * 1024,
        );
        const builtRefCallerOwner = await createConsumerSessionClient(
          builtRefCallerConfig,
          builtRefCallerSettings,
          builtRefCallerManager,
          builtRefCallerFactories.agentClientFactory,
          builtRefCallerMedia.store,
          builtRefCallerMcp.readInstructions,
          builtRefCallerMcp.workspacePaths,
          builtRefCallerSettingsOwner,
          builtRefCallerContent,
          builtRefCallerTokenizer,
        );
        builtRefCallerOwner.bindMcpRuntime(builtRefCallerMcp);
        builtRefCallerOwner.clients.bindProviderFiles(
          builtRefCallerFiles,
          (provider) => builtRefCallerOAuth.composeRetryOperations(provider),
        );
        builtRefCallerOwner.bindHooks();
        const builtRefCallerClose = settleEngineRelease.bind(
          undefined,
          [
            () => builtRefCallerOwner.dispose(),
            () => builtRefCallerRelease.close(),
            () => builtRefCallerMedia.dispose(),
            () => builtRefCallerMcp.dispose(),
            () => builtRefCallerConfig.dispose(),
            () => rm(builtRefCallerDirectory, { recursive: true, force: true }),
          ],
          builtRefCallerPreviousReplay,
        );
        try {
          await preparePreferredProviderCompletion(
            builtRefCallerConfig,
            builtRefCallerSettings,
            builtRefCallerSettingsOwner,
            builtRefCallerManager,
            builtRefCallerOAuth,
            builtRefCallerRuntimeId,
            builtRefCallerTokenizer,
            undefined,
            process.env.LLXPRT_FAKE_RESPONSES,
          );
          await builtRefCallerMcp.initialize();
          const activation = await executeProviderActivation(
            builtRefCallerConfig,
            builtRefCallerSelection.activation ?? {
              provider: builtRefCallerConfig.getProvider(),
              model: builtRefCallerConfig.getModel(),
            },
            assembleProviderSwitch(
              builtRefCallerConfig,
              builtRefCallerSettings,
              builtRefCallerManager,
              builtRefCallerOAuth,
              () => 'agent',
              () => builtRefCallerOwner.clients.refreshAuth(),
              builtRefCallerSettingsOwner,
            ),
            builtRefCallerSettings,
            builtRefCallerManager,
            (method) => builtRefCallerOwner.clients.refreshAuth(method),
            assembleModelSelection(builtRefCallerSettingsOwner),
          );
          requireCallerActivation(activation);
          await builtRefCallerOwner.initializeTools();
          await ownerClients(builtRefCallerOwner)[1].startChat();
        } catch (primary) {
          await cleanupAfterFailure(primary, builtRefCallerClose);
        }

        try {
          const pathBEvents = await driveReferenceLoop(
            builtRefCallerConfig,
            builtRefCallerSettingsOwner,
            builtRefCallerSettings,
            ownerClients(builtRefCallerOwner)[1],
            builtRefCallerPolicy.session.messageBus,
            'hello',
          );
          const pathB = projectEvents(pathBEvents);

          // REQ-INT-002: same projected tool names, isError flags, and single
          // terminal done reason. Internal fields (prompt_id, traceId) are
          // projected away — never compared.
          expect(pathA).toStrictEqual(pathB);
        } finally {
          await builtRefCallerClose();
        }

        // Behavioral anchor: at least one tool-call event is projected with a
        // specific tool name (parity must be behavioral, not vacuously empty).
        const toolCalls = pathA.filter((e) => e.type === 'tool-call');
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0].toolName).toBe('read_file');

        // Behavioral anchor: exactly one terminal done.
        const dones = pathA.filter((e) => e.type === 'done');
        expect(dones).toHaveLength(1);
      });
    } finally {
      if (builtCallerPreviousReplay === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = builtCallerPreviousReplay;
      await rm(builtCallerDirectory, { recursive: true, force: true });
    }
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
