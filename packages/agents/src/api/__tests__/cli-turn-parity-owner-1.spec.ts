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
import { join, resolve } from 'node:path';
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

import { describe, it } from 'bun:test';

import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { projectEvents, type MessageBus } from './helpers/fixture-data.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';

import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
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
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import {
  createAgenticLoop,
  mapLoopStream,
  type AgentEvent,
  type Agent,
  type AgenticLoopApprovalHandler,
} from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P19
 * @requirement:REQ-INT-002,REQ-INT-004
 *
 * Broad parity harness — CLI turn-parity. Exercises the SAME public entry
 * points the eventual #1595 CLI will use (`fromConfig`, `agent.stream`) against
 * a REAL CLI-style Config + a REAL FakeProvider JSONL fixture, comparing
 * turn-drive parity against the CLI's actual reference `AgenticLoop` drive.
 * This is a PARITY-EXPANSION / VERIFICATION gate (NOT a RED TDD phase): the
 * fromConfig turn-parity seam is already implemented (P09), so a PASSING suite
 * is the success condition.
 *
 * Scenarios (mirroring pseudocode cli-integration-adapter.md):
 *   T10 (lines 40-51) — Path A (fromConfig stream) projects identically to
 *     Path B (reference AgenticLoop) over the same fixture, with behavioral
 *     anchors (specific tool name, exactly one terminal done).
 *   T11 (lines 80-84) — boundary scan: the THREE parity spec files import ONLY
 *     the curated public root (no ./internals.js in Path A, no deep /src/,
 *     core/src, or providers/src anywhere).
 *   Property (lines 70-77) — Path A vs Path B projection equivalence holds
 *     across generated tool names and answer texts.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Drives the reference AgenticLoop (Path B) over the Config's agentClient and
 * maps its AgenticLoopEvents through the public event adapter to AgentEvents,
 * so Path A and Path B project to the SAME comparable event space. Mirrors the
 * CLI's useAgenticLoop.ts:254 object-form construction EXACTLY.
 */
async function driveReferenceLoop(
  config: Config,
  agentClient: AgentClientContract,
  messageBus: MessageBus,
  input: string,
  settingsOwner: SessionSettingsOwner,
  settingsService: SettingsService,
): Promise<readonly AgentEvent[]> {
  const approvalHandler: AgenticLoopApprovalHandler = async () => ({
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
          RootTelemetry.prepare({
            enabled: false,
            sessionId: 'isolated-caller-fixture',
            maxBytes: 1024,
            maxFiles: 1,
          }),
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

/**
 * Writes an inline JSONL fixture (two turns: a tool call then a final text
 * answer) to a temp directory and returns the absolute path. The cleanup
 * removes the temp directory. Mirrors the early slice's writeTempFixture.
 */
function writeTempFixture(
  toolName: string,
  answerText: string,
): { readonly path: string; readonly cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-parity-p19-'));
  const fixturePath = join(dir, 'generated.jsonl');
  const turn1 = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-gen-p19-1',
            name: toolName,
            parameters: { path: '{{CWD}}/package.json' },
          },
        ],
      },
    ],
  };
  const turn2 = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: answerText }],
      },
    ],
  };
  writeFileSync(
    fixturePath,
    `${JSON.stringify(turn1)}\n${JSON.stringify(turn2)}\n`,
    'utf8',
  );
  return {
    path: fixturePath,
    cleanup: (): void => rmSync(dir, { recursive: true, force: true }),
  };
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
describe('CLI turn-parity (broad) @plan:PLAN-20260621-COREAPIREMED.P19 @requirement:REQ-INT-002 @requirement:REQ-INT-004', () => {
  useConsumerPromptDirectory();

  const builtCredentials = useOwnedCredentials();
  const builtRefCredentials = useOwnedCredentials();

  it('PROP parity: Path A vs Path B projection equivalence holds across generated tool names and answer texts (REQ-INT-002)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('read_file', 'list_directory', 'glob', 'search'),
        fc.string({ minLength: 1, maxLength: 40 }),
        async (toolName, answerText) => {
          const fixture = writeTempFixture(toolName, answerText);
          try {
            const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
            process.env.LLXPRT_FAKE_RESPONSES = resolve(
              fileURLToPath(new URL('./fixtures/', import.meta.url)),
              fixture.path,
            );
            const builtCallerDirectory = await realpath(
              await mkdtemp(join(tmpdir(), 'explicit-caller-')),
            );
            try {
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

                const builtRefCallerPreviousReplay =
                  process.env.LLXPRT_FAKE_RESPONSES;
                process.env.LLXPRT_FAKE_RESPONSES = resolve(
                  fileURLToPath(new URL('./fixtures/', import.meta.url)),
                  fixture.path,
                );
                const builtRefCallerDirectory = await realpath(
                  await mkdtemp(join(tmpdir(), 'explicit-caller-')),
                );
                const builtRefCallerOverrides: Readonly<Partial<AgentConfig>> =
                  {};
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
                const builtRefCallerConfig = new Config(
                  builtRefCallerParameters,
                );
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
                  (provider) =>
                    builtRefCallerOAuth.composeRetryOperations(provider),
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
                    () =>
                      rm(builtRefCallerDirectory, {
                        recursive: true,
                        force: true,
                      }),
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
                    ownerClients(builtRefCallerOwner)[1],
                    builtRefCallerPolicy.session.messageBus,
                    'hello',
                    builtRefCallerSettingsOwner,
                    builtRefCallerSettings,
                  );
                  const pathB = projectEvents(pathBEvents);
                  return JSON.stringify(pathA) === JSON.stringify(pathB);
                } finally {
                  await builtRefCallerClose();
                }
              });
            } finally {
              if (builtCallerPreviousReplay === undefined)
                delete process.env.LLXPRT_FAKE_RESPONSES;
              else
                process.env.LLXPRT_FAKE_RESPONSES = builtCallerPreviousReplay;
              await rm(builtCallerDirectory, { recursive: true, force: true });
            }
          } finally {
            fixture.cleanup();
          }
        },
      ),
      // Each run builds two configs and drains two full streams; cap the case
      // count to keep the property well within the 30s timeout under parallel
      // test load (consistent with other heavy-agent property tests).
      { numRuns: 8 },
    );
  }, 60000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
