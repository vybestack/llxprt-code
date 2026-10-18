import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
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
import { beforeAll, afterAll, describe, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { type MessageBus } from './helpers/fixture-data.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import {
  fromConfig,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  drain,
  countType,
  internalConfig,
  ASYNC_PROPERTY_TIMEOUT_MS,
  IDENTITY_PROPERTY_TIMEOUT_MS,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P08
 * @requirement:REQ-001,REQ-INT-001
 *
 * BEHAVIORAL RED suite for the (not-yet-implemented) public `fromConfig` API.
 * Every test fails at RED because the P06 stub raises NotYetImplemented before
 * any agent is returned, so identity/turn/ownership assertions are never
 * reached. These are genuine forward behavioral assertions (identities and
 * values), not assertions about the stub error itself, and contain no mock
 * theater.
 *
 * The suite reuses the CANONICAL config builder (buildCliStyleConfig) and the
 * established disposal-observation probe (disposalProbe) — no duplication.
 * At GREEN (P09) `fromConfig` adopts the external Config and the SAME
 * assertions pass with no rewrite.
 */

// ─── Structural identity probes (cast-free, mirrors agentHarness idiom) ──────
//
// The public Agent surface is opaque (no getRuntimeId / getProviderManager
// accessor). The identity invariants under test (T1e runtime id, T6 provider
// manager, T6c caller MessageBus adoption) are reached via the SAME documented
// structural narrowing idiom the codebase already uses
// (captureHistoryServiceIdentity in agentHarness.ts): treat the Agent as a
// Record<string, unknown> and probe a documented internal field. At RED these
// return undefined because fromConfig throws NotYetImplemented before any agent
// is returned; the identity assertions fail naturally. At GREEN the fields are
// populated and the SAME assertions pass.

interface RecordLike {
  readonly [key: string]: unknown;
}

function asRecord(v: unknown): RecordLike | null {
  return typeof v === 'object' && v !== null ? (v as RecordLike) : null;
}

/** Reaches the AgentImpl providerManager field (agentImpl.ts AgentDeps). */
function captureProviderManager(agent: Agent): unknown {
  const impl = asRecord(agent);
  if (impl === null) {
    return undefined;
  }
  const pm = impl['providerManager'] ?? impl['manager'];
  return pm ?? undefined;
}

/** Reaches the AgentImpl messageBus field (agentImpl.ts AgentDeps). */
function captureAgentMessageBus(agent: Agent): unknown {
  const impl = asRecord(agent);
  if (impl === null) {
    return undefined;
  }
  return impl['messageBus'] ?? impl['bus'] ?? undefined;
}

/** Reaches the AgentImpl runtimeId field (agentImpl.ts AgentDeps). */
function captureRuntimeId(agent: Agent): unknown {
  const impl = asRecord(agent);
  if (impl === null) {
    return undefined;
  }
  const id = impl['runtimeId'];
  return typeof id === 'string' ? id : undefined;
}

describe('fromConfig caller properties', () => {
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
  const callerFactories = createAgentRuntimeFactoryBindings();
  let callerRelease: AcquisitionRelease;
  let callerFiles: ProviderFileLifecycle;
  let callerRuntimeId: string;
  let callerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let callerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let callerContent: ReturnType<typeof createRuntimeContentGeneratorFactory>;

  async function openCaller(fixture: string): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'caller-adoption-')),
    );
    callerConfig = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    callerSettings = new SettingsService();
    callerPolicy = new RuntimePolicyOwner(callerConfig);
    injectConfirmationForcingPolicy(callerPolicy.session.confirmation);
    callerMcp = await buildTestMcpRuntime(
      callerConfig,
      callerPolicy.session.messageBus,
      {},
      undefined,
      callerPolicy,
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
      await activateCallerClient();
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
  async function activateCallerClient(): Promise<void> {
    const activation = await executeProviderActivation(
      callerConfig,
      { provider: callerConfig.getProvider(), model: callerConfig.getModel() },
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

  // ─── Property-based tests (>=30% of total) ──────────────────────────────

  it(
    'PROP1 for any valid sessionId string, fromConfig identity holds: internalConfig(agent) === the caller Config @requirement:REQ-001 @scenario:property-identity @given:any non-empty sessionId string @when:fromConfig({ config, sessionId }) @then:internalConfig(agent) is the SAME Config instance for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          await openCaller('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig(
              callerConfig,
              callerSettings,
              { sessionId },
              callerSettingsOwner,
              callerManager,
              undefined,
              undefined,
              callerMcp,
              undefined,
              callerOwner.getAgentClient(),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              return internalConfig(agent) === callerConfig;
            } finally {
              await agent.dispose();
            }
          } finally {
            await callerClose();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP2 for any valid sessionId string, the runtime id observable equals the supplied sessionId @requirement:REQ-001 @scenario:property-runtimeId @given:any non-empty sessionId string @when:fromConfig({ config, sessionId }) @then:captureRuntimeId(agent) === sessionId for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          await openCaller('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig(
              callerConfig,
              callerSettings,
              { sessionId },
              callerSettingsOwner,
              callerManager,
              undefined,
              undefined,
              callerMcp,
              undefined,
              callerOwner.getAgentClient(),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              return captureRuntimeId(agent) === sessionId;
            } finally {
              await agent.dispose();
            }
          } finally {
            await callerClose();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP3 for any subset of optional handlers provided, internalConfig(agent) identity holds @requirement:REQ-001 @scenario:property-handler-subset @given:any subset of { onApproval, onOAuthPrompt, editorCallbacks } @when:fromConfig({ config, ...subset }) @then:internalConfig(agent) === the caller Config for every generated subset',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            withApproval: fc.boolean(),
            withOauth: fc.boolean(),
            withEditor: fc.boolean(),
          }),
          async (subset) => {
            await openCaller('plain-text.jsonl');
            try {
              const agent: Agent = await fromConfig(
                callerConfig,
                callerSettings,
                {},
                undefined,
                callerManager,
                undefined,
                undefined,
                callerMcp,
                undefined,
                callerOwner.getAgentClient(),
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
                subset.withApproval
                  ? () => ToolConfirmationOutcome.ProceedOnce
                  : undefined,
                subset.withOauth ? () => true : undefined,
                subset.withEditor ? {} : undefined,
              );
              try {
                return internalConfig(agent) === callerConfig;
              } finally {
                await agent.dispose();
              }
            } finally {
              await callerClose();
            }
          },
        ),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP4 for any subset of optional handlers provided, the no-second-manager invariant holds (the runtime manager IS the caller manager) @requirement:REQ-001 @scenario:property-no-double-manager @given:any subset of optional handlers @when:fromConfig({ config, ...subset }) @then:captureProviderManager(agent) === config.getProviderManager() for every generated subset',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            withApproval: fc.boolean(),
            withOauth: fc.boolean(),
          }),
          async (subset) => {
            await openCaller('plain-text.jsonl');
            try {
              const agent: Agent = await fromConfig(
                callerConfig,
                callerSettings,
                {},
                undefined,
                callerManager,
                undefined,
                undefined,
                callerMcp,
                undefined,
                callerOwner.getAgentClient(),
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
                subset.withApproval
                  ? () => ToolConfirmationOutcome.ProceedOnce
                  : undefined,
                subset.withOauth ? () => true : undefined,
              );
              try {
                return captureProviderManager(agent) === callerManager;
              } finally {
                await agent.dispose();
              }
            } finally {
              await callerClose();
            }
          },
        ),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP5 for any non-empty sessionId, the caller-supplied MessageBus adoption invariant holds (the runtime bus IS the caller bus) @requirement:REQ-001 @scenario:property-caller-bus @given:any non-empty sessionId and a caller-supplied messageBus @when:fromConfig({ config, messageBus, sessionId }) @then:captureAgentMessageBus(agent) === callerBus for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          await openCaller('plain-text.jsonl');
          try {
            const callerBus: MessageBus = callerPolicy.session.messageBus;
            const agent: Agent = await fromConfig(
              callerConfig,
              callerSettings,
              { sessionId },
              callerSettingsOwner,
              callerManager,
              undefined,
              callerBus,
              callerMcp,
              undefined,
              callerOwner.getAgentClient(),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              return captureAgentMessageBus(agent) === callerBus;
            } finally {
              await agent.dispose();
            }
          } finally {
            await callerClose();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP6 for any non-empty sessionId, a single stream turn yields exactly one done event (turn-drive parity) @requirement:REQ-INT-001 @scenario:property-turn-drive @given:any non-empty sessionId @when:agent.stream("hello") is drained @then:exactly one done event is emitted for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          await openCaller('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig(
              callerConfig,
              callerSettings,
              { sessionId },
              callerSettingsOwner,
              callerManager,
              undefined,
              undefined,
              callerMcp,
              undefined,
              callerOwner.getAgentClient(),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              const events: AgentEvent[] = await drain(agent.stream('hello'));
              return countType(events, 'done') === 1;
            } finally {
              await agent.dispose();
            }
          } finally {
            await callerClose();
          }
        }),
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP7 for any non-empty sessionId, fromConfig with a caller bus AND sessionId preserves both the config identity AND the caller-bus identity @requirement:REQ-001 @scenario:property-combined-identity @given:any non-empty sessionId and a caller-supplied messageBus @when:fromConfig({ config, messageBus, sessionId }) @then:both internalConfig(agent) === config AND captureAgentMessageBus(agent) === callerBus hold for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          await openCaller('plain-text.jsonl');
          try {
            const callerBus: MessageBus = callerPolicy.session.messageBus;
            const agent: Agent = await fromConfig(
              callerConfig,
              callerSettings,
              { sessionId },
              callerSettingsOwner,
              callerManager,
              undefined,
              callerBus,
              callerMcp,
              undefined,
              callerOwner.getAgentClient(),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              return (
                internalConfig(agent) === callerConfig &&
                captureAgentMessageBus(agent) === callerBus
              );
            } finally {
              await agent.dispose();
            }
          } finally {
            await callerClose();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );
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
