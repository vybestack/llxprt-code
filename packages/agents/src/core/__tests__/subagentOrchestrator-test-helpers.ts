import { makeRuntimeContext } from './structural-history-fixture.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
import { createTestChildOrchestrator } from './child-launch-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

/**
 * Shared helpers for subagent orchestrator test files. Extracted from the
 * original monolithic subagentOrchestrator.test.ts so no file-level
 * max-lines disable is needed.
 */

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  SubagentTerminateMode,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import {
  SettingsService,
  type Profile,
  type ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { ToolRegistry, type ToolSelection } from '@vybestack/llxprt-code-tools';
import { afterEach, vi } from 'bun:test';
import type { SubAgentScopeFactory } from '../subagent.js';
import type {
  ChildAgentScope,
  SubagentOrchestrator,
} from '../subagentOrchestrator.js';

const foregroundConfigs: Config[] = [];
const histories: HistoryService[] = [];
const launches: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  for (const launch of launches.splice(0)) await launch.dispose();
  for (const history of histories.splice(0)) await history.dispose();
  for (const config of foregroundConfigs.splice(0)) await config.dispose();
});

export async function launchForTest(
  orchestrator: SubagentOrchestrator,
  request: Parameters<SubagentOrchestrator['launch']>[0],
  parentSignal: AbortSignal = new AbortController().signal,
): ReturnType<SubagentOrchestrator['launch']> {
  const result = await orchestrator.launch(request, parentSignal);
  launches.push(result);
  return result;
}

export function makeForegroundConfig(
  initialSettings: Readonly<Record<string, unknown>> = {},
): Config {
  const config = new Config({
    sessionId: 'primary-session',
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    initialSettings,
  });
  foregroundConfigs.push(config);
  return config;
}

export function fakeChildScope(
  overrides: Partial<ChildAgentScope> = {},
): ChildAgentScope {
  return {
    output: { terminate_reason: SubagentTerminateMode.GOAL, emitted_vars: {} },
    runInteractive: async () => {},
    runNonInteractive: async () => {},
    cancel: () => {},
    getAgentId: () => 'fake-agent',
    dispose: async () => {},
    ...overrides,
  };
}

/**
 * Creates a stub scope factory and fake scope, returning both so callers can
 * inspect the `runConfig` (5th positional arg — index 4) passed to
 * `SubAgentScope.create`.
 */
export function createScopeFactory() {
  const fakeScope = fakeChildScope({ getAgentId: () => 'agent-helper-123' });

  const factory = vi.fn<SubAgentScopeFactory>(async () => fakeScope);
  return { factory, fakeScope };
}

/**
 * Convenience builder that wires stub subagent/profile managers around a
 * single profile + subagent config, then constructs a real
 * {@link SubagentOrchestrator} with stubbed runtime/scope layers. Eliminates
 * the repeated manager-creation boilerplate across max-turns precedence tests.
 */
export function createOrchestratorForTurns(options: {
  subagentName: string;
  profileName?: string;
  systemPrompt?: string;
  profile: Profile;
  foregroundConfig?: Config;
  loadProfile?: (profileName: string) => Promise<Profile>;
}) {
  const subagentConfig: SubagentConfig = {
    name: options.subagentName,
    profile: options.profileName ?? 'default-profile',
    systemPrompt: options.systemPrompt ?? 'Assist.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
  const subagentManager = {
    loadSubagent,
  } as unknown as SubagentManager;

  const loadProfile = vi.fn(
    options.loadProfile ?? (async () => options.profile),
  );
  const profileManager = {
    loadProfile,
  } as unknown as ProfileManager;

  const { factory } = createScopeFactory();
  const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());

  const foregroundConfig1 = options.foregroundConfig ?? makeForegroundConfig();
  const foregroundSettings1 = createSessionSettingsFixture(foregroundConfig1);
  const orchestrator = createTestChildOrchestrator({
    credentialAuthority: new CredentialAuthority(),
    workspaceTrust: foregroundSettings1.workspaceTrust,
    createChildSettings: () =>
      foregroundSettings1.settingsOwner.createChildStore(),
    readRunPolicy: () =>
      foregroundSettings1.settingsOwner.readSubagentRunPolicy(),

    instructions: emptyInstructionReads,
    toolRegistry: fixtureToolSelection(),
    workspacePaths: fixturePaths(),
    readMcpInstructions: () => undefined,
    subagentManager,
    profileManager,
    foregroundConfig: foregroundConfig1,
    scopeFactory: factory,
    runtimeLoader,
    messageBus: new MessageBus(),
  });

  return { orchestrator, factory };
}

/**
 * Extracts the `runConfig` (5th positional arg — index 4) passed to the scope
 * factory on the given invocation, so tests can assert `max_turns` values.
 */
export function extractRunConfig(
  factory: ReturnType<typeof createScopeFactory>['factory'],
  callIndex = 0,
): RunConfig {
  if (callIndex < 0 || callIndex >= factory.mock.calls.length) {
    throw new Error(`Scope factory call ${callIndex} does not exist`);
  }
  const factoryCall = factory.mock.calls[callIndex];
  return factoryCall[0].run;
}

export function createRuntimeBundle(
  label = 'bundle',
  ownedHistory = new HistoryService(),
) {
  histories.push(ownedHistory);
  vi.spyOn(ownedHistory, 'clear');
  const base = makeRuntimeContext(false);
  const runtimeContext: AgentRuntimeContext = {
    ...base,
    state: {
      ...base.state,
      runtimeId: label + '-runtime-id',
      sessionId: label + '-session',
    },
    history: ownedHistory,
  };
  return {
    runtimeContext,
    history: ownedHistory,
    providerAdapter: runtimeContext.provider,
    telemetryAdapter: runtimeContext.telemetry,
    telemetryRoot: createSessionSettingsFixture(makeForegroundConfig())
      .settingsOwner.telemetry,
    toolsView: runtimeContext.tools,
    contentGenerator: {
      generateContent: async (): Promise<never> => {
        throw new Error('Unused content generator');
      },
      generateContentStream: async (): Promise<never> => {
        throw new Error('Unused content stream');
      },
      countTokens: async () => ({ totalTokens: 0 }),
      embedContent: async (): Promise<never> => {
        throw new Error('Unused embedding');
      },
    },
    toolRegistry: fixtureToolSelection(),
    settingsSnapshot: {},
  };
}

export function fixtureToolSelection(): ToolSelection {
  return new ToolRegistry(
    { getCoreTools: () => [], isTrustedFolder: () => true },
    new CoreMessageBusAdapter(new MessageBus()),
    assembleTaskSchemaPolicy(new SettingsService()),
  );
}
