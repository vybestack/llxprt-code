import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { CallerAgentRuntimeFactories } from './helpers/fixture-data.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { beforeAll, afterAll, describe, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { requireInstructionReads } from '../../core/chat-system-prompt.js';
import { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { createAgentClient, type Agent } from '@vybestack/llxprt-code-agents';
import { ASYNC_PROPERTY_TIMEOUT_MS } from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function requirePaths(
  paths: WorkspacePathOperations | undefined,
): WorkspacePathOperations {
  if (paths === undefined)
    throw new Error('Fixture factory requires workspace paths');
  return paths;
}

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * BEHAVIORAL suite for fromConfig's task-tool reconciliation on Configs the
 * CALLER initialized before adoption (review finding on #3222):
 * ensureAgentRuntimeFactories installs the shipped task-tool registration as
 * a field default, but the registration is consumed only at tool-registry
 * construction and ensureInitialized is a no-op for an already-initialized
 * Config — so the registry the caller built stays without the task tool
 * unless adoption carries the late-installed default into the LIVE registry.
 * These tests initialize the Config THEMSELVES (with an agent-client factory
 * but no task-tool registration), then adopt it via fromConfig and observe
 * the returned Agent's runtime. Caller-supplied registrations and
 * excludeTools governance must never be overridden by the reconcile.
 */

/** The agent runtime's projected tool-name surface. */
function agentToolNames(agent: Agent): readonly string[] {
  return agent.tools.list().map((tool) => tool.name);
}

async function settleFactorylessRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previous: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  }
}
describe('fromConfig task-tool reconcile @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
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
  useOwnedCredentials();

  it(
    'T3a-PROP for any non-empty sessionId, a caller-initialized Config without a task-tool registration gains the shipped task tool on adoption @requirement:REQ-3222-AC2 @scenario:property-reconcile @given:any non-empty sessionId @when:fromConfig({ config, sessionId, messageBus }) @then:the agent runtime lists the "task" tool for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const callerFactories: CallerAgentRuntimeFactories = {
            agentClientFactory: (
              config,
              runtimeState,
              readMcpInstructions = () => undefined,
              mediaStore,
              workspacePaths,
              instructions,
            ) =>
              createAgentClient(
                config,
                runtimeState,
                readMcpInstructions,
                mediaStore,
                requirePaths(workspacePaths),
                requireInstructionReads(instructions),
              ),
          };

          const builtFactorylessPreviousReplay =
            process.env.LLXPRT_FAKE_RESPONSES;
          process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
            new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
          );
          const builtFactorylessDirectory = await realpath(
            await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
          );
          const builtFactorylessSupplied: CallerAgentRuntimeFactories =
            callerFactories;
          const builtFactorylessConfig = new Config(
            toConfigParameters({
              ...{
                provider: 'fake',
                model: 'fake-model',
                workingDir: builtFactorylessDirectory,
              },
              ...{},
            }),
          );
          const builtFactorylessSettings = new SettingsService();
          for (const [key, value] of Object.entries(
            builtFactorylessConfig.getInitialSettings(),
          ))
            builtFactorylessSettings.set(key, value);
          const builtFactorylessSettingsOwner = new SessionSettingsOwner(
            builtFactorylessSettings,
          );
          builtFactorylessSettingsOwner.bindTelemetry(builtFactorylessConfig);
          builtFactorylessSettingsOwner.initializeProviderSelection(
            builtFactorylessConfig.getProvider(),
            builtFactorylessConfig.getModel(),
          );
          const builtFactorylessPolicy = new RuntimePolicyOwner(
            builtFactorylessConfig,
          );
          const builtFactorylessTask =
            builtFactorylessSupplied.taskToolRegistration;
          const builtFactorylessFactories = {
            ...createAgentRuntimeFactoryBindings(),
            ...(builtFactorylessSupplied.agentClientFactory
              ? {
                  agentClientFactory:
                    builtFactorylessSupplied.agentClientFactory,
                }
              : {}),
            ...(builtFactorylessTask
              ? { taskToolRegistration: () => builtFactorylessTask }
              : {}),
          };
          const builtFactorylessNoClient = undefined;
          const builtFactorylessNoManager = undefined;
          const builtFactorylessClose = settleFactorylessRelease.bind(
            undefined,
            [
              () => builtFactorylessSettingsOwner.dispose(),
              () => builtFactorylessPolicy.dispose(),
              () => builtFactorylessConfig.dispose(),
              () =>
                rm(builtFactorylessDirectory, { recursive: true, force: true }),
            ],
            builtFactorylessPreviousReplay,
          );

          const callerMcp = await buildTestMcpRuntime(
            builtFactorylessConfig,
            builtFactorylessPolicy.session.messageBus,
            {},
            undefined,
            builtFactorylessPolicy,
          );
          try {
            await callerMcp.initialize();
            const agent: Agent = await fromConfig(
              builtFactorylessConfig,
              builtFactorylessSettings,
              { sessionId },
              builtFactorylessSettingsOwner,
              builtFactorylessNoManager,
              undefined,
              builtFactorylessPolicy.session.messageBus,
              callerMcp,
              undefined,
              builtFactorylessNoClient,
              undefined,
              undefined,
              undefined,
              builtFactorylessFactories,
              undefined,
              undefined,
              builtFactorylessPolicy,
            );
            try {
              return agentToolNames(agent).includes('task');
            } finally {
              await agent.dispose();
            }
          } finally {
            await callerMcp.dispose();
            await builtFactorylessClose();
          }
        }),
        { numRuns: 5 },
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );
});
