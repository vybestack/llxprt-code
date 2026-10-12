/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { requireInstructionReads } from '../../core/chat-system-prompt.js';

import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
function requirePaths(
  paths: WorkspacePathOperations | undefined,
): WorkspacePathOperations {
  if (paths === undefined)
    throw new Error('Fixture factory requires workspace paths');
  return paths;
}
import { listProviders } from '@vybestack/llxprt-code-providers/runtime.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';

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

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
  fromConfig,
  assembleAgentActivationBootstrap,
  createAgentClient,
  createTaskRegistration,
  type Agent,
  type AgentEvent,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import {
  buildFactoryLessConfig,
  buildTestMcpRuntime,
  buildCliStyleConfig,
  type CallerAgentRuntimeFactories,
} from './helpers/buildCliStyleConfig.js';
import {
  drain,
  countType,
  ASYNC_PROPERTY_TIMEOUT_MS,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';

/** The agent runtime's projected tool-name surface. */
function agentToolNames(agent: Agent): readonly string[] {
  return agent.tools.list().map((tool) => tool.name);
}

describe('fromConfig task-tool reconcile @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
  it('T3a a Config the caller initialized WITHOUT a task-tool registration gains the shipped task tool on adoption @requirement:REQ-3222-AC2 @scenario:caller-initialized-reconcile @given:a minimal Config with an agentClientFactory but NO taskToolRegistration, initialized by the caller so the registry is built without the task tool @when:fromConfig({ config, sessionId, messageBus }) @then:the returned Agent\'s runtime lists the shipped "task" tool and a turn still drives', async () => {
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
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      callerFactories,
    );
    const runtimeId = 'issue3222-fromconfig-tasktool-reconcile';
    const callerMcp = await buildTestMcpRuntime(
      built.config,
      built.messageBus,
      {},
      undefined,
      built.policyOwner,
    );
    try {
      // The caller initializes the Config THEMSELVES: the registry is built
      // while the registration is still absent (the bug precondition).
      await callerMcp.initialize();
      expect(callerMcp.toolSelection.getTool('task')).toBeUndefined();

      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        sessionId: runtimeId,
        messageBus: built.messageBus,
        policyOwner: built.policyOwner,
        mcpRuntime: callerMcp,
      });
      try {
        expect(agentToolNames(agent)).toContain('task');
        expect(
          agent.tools
            .describeConfiguration()
            .registered.some((record) => record.displayName === 'task'),
        ).toBe(true);

        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerMcp.dispose();
      await built.cleanup();
    }
  });

  it('T3b a caller-supplied registration is never overridden on a caller-initialized Config: the registration identity AND the registry tool instance survive adoption @requirement:REQ-3222-AC2 @scenario:caller-wins @given:a caller-initialized Config whose registration already built the registry task tool @when:fromConfig({ config, sessionId, messageBus }) @then:getTaskToolRegistration() is STILL the caller-initialized descriptor and the registry task tool is STILL the pre-adoption instance (no re-registration)', async () => {
    const callerRegistration = createTaskRegistration();
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
      taskToolRegistration: callerRegistration,
    };
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      callerFactories,
    );
    const runtimeId = 'issue3222-fromconfig-tasktool-callersupplied';
    const callerMcp = await buildTestMcpRuntime(
      built.config,
      built.messageBus,
      {},
      undefined,
      built.policyOwner,
    );
    try {
      await callerMcp.initialize();
      const preAdoptionRegistration = callerRegistration;
      expect(callerMcp.toolSelection.getTool('task')).toBeUndefined();

      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: {
          ...built.runtimeFactoryBindings,
          taskToolRegistration: () => preAdoptionRegistration,
        },
        config: built.config,
        sessionId: runtimeId,
        messageBus: built.messageBus,
        policyOwner: built.policyOwner,
        mcpRuntime: callerMcp,
      });
      try {
        const task = agent.agentClient.tools.getTool('task');
        expect(task instanceof callerRegistration.toolClass).toBe(true);
        expect(agentToolNames(agent)).toContain('task');
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerMcp.dispose();
      await built.cleanup();
    }
  });

  it('T3c excludeTools governance is never overridden: a caller-excluded task tool stays absent after the reconcile @requirement:REQ-3222-AC2 @scenario:exclusion-respected @given:a caller-initialized Config with excludeTools ["task"] and NO taskToolRegistration @when:fromConfig({ config, sessionId, messageBus }) @then:the shipped task tool is still NOT registered (the deny-list wins over the reconcile)', async () => {
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
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      callerFactories,
      { excludeTools: ['task'] },
    );
    const runtimeId = 'issue3222-fromconfig-tasktool-excluded';
    const callerMcp = await buildTestMcpRuntime(
      built.config,
      built.messageBus,
      {},
      undefined,
      built.policyOwner,
    );
    try {
      await callerMcp.initialize();
      expect(callerMcp.toolSelection.getTool('task')).toBeUndefined();

      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        sessionId: runtimeId,
        messageBus: built.messageBus,
        policyOwner: built.policyOwner,
        mcpRuntime: callerMcp,
      });
      try {
        expect(agent.tools.get('task')).toBeUndefined();
        expect(agentToolNames(agent)).not.toContain('task');
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerMcp.dispose();
      await built.cleanup();
    }
  });

  it('T3d a preflight-installed default registration still reaches the LIVE registry: preflightAgentActivation between caller initialization and fromConfig adoption must not suppress the reconcile @requirement:REQ-3222-AC2 @scenario:preflight-then-adopt @given:a caller-initialized CLI-style Config (agent-client factory present, NO taskToolRegistration, registry built without the task tool) on which preflightAgentActivation then installed the DEFAULT registration as a field @when:fromConfig({ config, sessionId, messageBus, activation, activationPreflightToken }) adopts the SAME Config consuming the preflight token @then:the LIVE registry has the shipped task tool and the agent runtime lists "task" (a registration FIELD installed by an earlier agent entrypoint is not caller provenance)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const runtimeId = 'issue3222-fromconfig-tasktool-preflight';
    try {
      // The caller-initialized precondition (same state T3a builds): the
      // registry was built while the registration was absent — here via the
      // CLI-style builder, whose initialize runs before any task-tool
      // registration exists, mirroring the CLI-at-preflight Config.
      expect(built.mcpRuntime.toolSelection.getTool('task')).toBeUndefined();
      expect(built.agentClient.tools.getTool('task')).toBeDefined();

      // The reviewer sequence's middle step: preflight runs BEFORE fromConfig
      // and installs the DEFAULT task-tool registration as a field. The
      // registry is not reconciled here — the field is consumed only at
      // registry construction, which already happened.
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };
      const manager = built.providerManager;

      const operation = assembleAgentActivationBootstrap(
        built.config,
        built.settingsService,
        manager,
        null,
        () => undefined,
        built.agentClient,
        built.mcpRuntime,
      );
      const preflight = await operation.preflight(intent);
      expect(preflight.authFailed).toBe(false);
      const token = preflight.token;
      expect(token).toBeDefined();
      if (!token)
        throw new Error('Preflight did not produce an activation token');
      expect(built.mcpRuntime.toolSelection.getTool('task')).toBeUndefined();
      expect(
        operation.sessionClient.getAgentClient().tools.getTool('task'),
      ).toBeDefined();

      // Adoption with the preflight token (the CLI flow: preflight, then
      // fromConfig consuming the completed activation instead of re-running).
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        sessionId: runtimeId,
        messageBus: built.messageBus,
        policyOwner: built.policyOwner,
        mcpRuntime: built.mcpRuntime,
        activation: intent,
        activationPreflight: { operation, token },
      });
      try {
        // The default registration preflight installed must reach the LIVE
        // registry: "a registration exists" is not "the caller supplied it".
        expect(agent.tools.get('task')).toBeDefined();
        expect(agentToolNames(agent)).toContain('task');
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

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
          const built = await buildFactoryLessConfig(
            'plain-text.jsonl',
            callerFactories,
          );
          const callerMcp = await buildTestMcpRuntime(
            built.config,
            built.messageBus,
            {},
            undefined,
            built.policyOwner,
          );
          try {
            await callerMcp.initialize();
            const agent: Agent = await fromConfig({
              settingsOwner: built.settingsOwner,
              settingsService: built.settingsService,
              agentClient: built.agentClient,
              providerManager: built.providerManager,
              runtimeFactoryBindings: built.runtimeFactoryBindings,
              config: built.config,
              sessionId,
              messageBus: built.messageBus,
              policyOwner: built.policyOwner,
              mcpRuntime: callerMcp,
            });
            try {
              return agentToolNames(agent).includes('task');
            } finally {
              await agent.dispose();
            }
          } finally {
            await callerMcp.dispose();
            await built.cleanup();
          }
        }),
        { numRuns: 5 },
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );
});
function createReadinessFactory(
  prepareTokenizer: (providerName: string, model?: string) => Promise<void>,
  countTokens: (providerName: string, model?: string) => number,
): RuntimeTokenizerFactory {
  return {
    prepareTokenizer,
    getTokenizer: (providerName, model) => ({
      fallbackPolicy: 'deny',
      countTokens: () => countTokens(providerName, model),
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'test-readiness',
      estimatorVersion: 'test-readiness-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    }),
  };
}

describe('fromConfig tokenizer readiness @requirement:REQ-3217-001 @requirement:REQ-3217-003', () => {
  it('awaits post-activation provider/model preparation before returning a usable Agent', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const preparationStarted = readinessSignal();
    const releasePreparation = readinessSignal();
    const events: string[] = [];
    let prepared = false;
    const factory = createReadinessFactory(
      async (providerName, model) => {
        events.push(`prepare:${providerName}:${model ?? ''}`);
        preparationStarted.resolve();
        await releasePreparation.promise;
        prepared = true;
        events.push('prepared');
      },
      (providerName, model) => {
        if (!prepared) {
          throw new Error('tokenizer used before preparation completed');
        }
        events.push(`tokenize:${providerName}:${model ?? ''}`);
        return 7;
      },
    );

    try {
      const pendingAgent = fromConfig({
        tokenizerFactory: factory,
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        activation: {
          provider: 'fake',
          model: 'ready-model',
          authMode: 'auto',
        },
      });
      await preparationStarted.promise;
      let completed = false;
      const observedAgent = pendingAgent.then((agent) => {
        completed = true;
        return agent;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(completed).toBe(false);

      releasePreparation.resolve();
      const agent = await observedAgent;
      try {
        await agent.agentClient.startChat(await agent.agentClient.getHistory());
        expect(built.providerManager.getTokenizerFactory?.()).toBe(factory);

        const turnEvents = await drain(agent.stream('hello'));
        expect(countType(turnEvents, 'done')).toBe(1);
        expect(events[0]).toBe('prepare:fake:ready-model');
        expect(events[1]).toBe('prepared');
        expect(
          events.some((event) => event === 'tokenize:fake:ready-model'),
        ).toBe(true);
      } finally {
        await agent.dispose();
      }
    } finally {
      releasePreparation.resolve();
      await built.cleanup();
    }
  });

  it('rejects with the causal preparation failure reached through authoritative post-activation state without allowing an ownerless accessor', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const failure = new Error('mandatory tokenizer readiness failed causally');
    const runtimeId = 'from-config-rejected-tokenizer-readiness';
    // Mutate the Config's provider field to stale state. The isolated runtime
    // manager still has 'fake' active (authoritative). fromConfig must derive
    // the readiness target from the manager, not from this stale Config field.
    Object.defineProperty(built.config, 'getProvider', {
      value: () => 'stale-config-provider',
    });
    let readinessTarget:
      | { readonly provider: string; readonly model: string }
      | undefined;
    const tokenizerFactory = createReadinessFactory(
      async (providerName, model) => {
        readinessTarget = { provider: providerName, model: model ?? '' };
        throw failure;
      },
      () => {
        throw new Error('unreachable tokenizer use');
      },
    );

    try {
      await expect(
        fromConfig({
          settingsOwner: built.settingsOwner,
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          runtimeFactoryBindings: built.runtimeFactoryBindings,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          sessionId: runtimeId,
          tokenizerFactory,
        }),
      ).rejects.toBe(failure);
      // Authoritative post-activation manager state ('fake'/'fake-model')
      // reached readiness — NOT the stale Config provider
      // ('stale-config-provider').
      expect(readinessTarget).toStrictEqual({
        provider: 'fake',
        model: 'fake-model',
      });
      expect(readinessTarget?.provider).not.toBe('stale-config-provider');
      expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
        'Provider listing requires an explicit owner',
      );
    } finally {
      await built.cleanup();
    }
  });
});

function readinessSignal() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
