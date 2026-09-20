/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
  createAgentClient,
  createTaskRegistration,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { disposeCliRuntime } from '@vybestack/llxprt-code-providers/runtime.js';
import type { AnyDeclarativeTool } from '@vybestack/llxprt-code-tools';
import {
  buildFactoryLessConfig,
  type BuiltFactoryLessConfig,
  type CallerAgentRuntimeFactories,
} from './helpers/buildCliStyleConfig.js';
import {
  drain,
  countType,
  internalConfig,
  ASYNC_PROPERTY_TIMEOUT_MS,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';

/** Registry-level presence probe for the shipped task tool ('task'). */
function registryTaskTool(
  config: BuiltFactoryLessConfig['config'],
): AnyDeclarativeTool | undefined {
  return config.getToolRegistry().getTool('task');
}

/** The agent runtime's projected tool-name surface. */
function agentToolNames(agent: Agent): readonly string[] {
  return agent.tools.list().map((tool) => tool.name);
}

describe('fromConfig task-tool reconcile @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
  it('T3a a Config the caller initialized WITHOUT a task-tool registration gains the shipped task tool on adoption @requirement:REQ-3222-AC2 @scenario:caller-initialized-reconcile @given:a minimal Config with an agentClientFactory but NO taskToolRegistration, initialized by the caller so the registry is built without the task tool @when:fromConfig({ config, sessionId, messageBus }) @then:the returned Agent\'s runtime lists the shipped "task" tool and a turn still drives', async () => {
    const callerFactories: CallerAgentRuntimeFactories = {
      agentClientFactory: (config, runtimeState) =>
        createAgentClient(config, runtimeState),
    };
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      callerFactories,
    );
    const runtimeId = 'issue3222-fromconfig-tasktool-reconcile';
    try {
      // The caller initializes the Config THEMSELVES: the registry is built
      // while the registration is still absent (the bug precondition).
      await built.config.initialize({ messageBus: built.messageBus });
      expect(built.config.getTaskToolRegistration()).toBeUndefined();
      expect(registryTaskTool(built.config)).toBeUndefined();
      expect(
        built.config
          .getToolRegistryInfo()
          .unregistered.some(
            (record) => record.toolName === 'TaskTool' && !record.isRegistered,
          ),
      ).toBe(true);

      const agent: Agent = await fromConfig({
        config: built.config,
        sessionId: runtimeId,
        messageBus: built.messageBus,
      });
      try {
        const config = internalConfig(agent);

        // The default registration fromConfig installed reached the LIVE
        // registry: the agent's runtime projects the shipped task tool.
        expect(config.getTaskToolRegistration()).toBeDefined();
        expect(registryTaskTool(config)).toBeDefined();
        expect(agentToolNames(agent)).toContain('task');

        // The settings surface no longer reports the task tool under the
        // missing-registration diagnostic.
        expect(
          config
            .getToolRegistryInfo()
            .registered.some((record) => record.toolName === 'TaskTool'),
        ).toBe(true);

        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await disposeCliRuntime(runtimeId);
      await built.cleanup();
    }
  });

  it('T3b a caller-supplied registration is never overridden on a caller-initialized Config: the registration identity AND the registry tool instance survive adoption @requirement:REQ-3222-AC2 @scenario:caller-wins @given:a caller-initialized Config whose registration already built the registry task tool @when:fromConfig({ config, sessionId, messageBus }) @then:getTaskToolRegistration() is STILL the caller instance and the registry task tool is STILL the pre-adoption instance (no re-registration)', async () => {
    const callerRegistration = createTaskRegistration();
    const callerFactories: CallerAgentRuntimeFactories = {
      agentClientFactory: (config, runtimeState) =>
        createAgentClient(config, runtimeState),
      taskToolRegistration: callerRegistration,
    };
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      callerFactories,
    );
    const runtimeId = 'issue3222-fromconfig-tasktool-callersupplied';
    try {
      await built.config.initialize({ messageBus: built.messageBus });
      const preAdoptionTaskTool = registryTaskTool(built.config);
      expect(preAdoptionTaskTool).toBeDefined();

      const agent: Agent = await fromConfig({
        config: built.config,
        sessionId: runtimeId,
        messageBus: built.messageBus,
      });
      try {
        const config = internalConfig(agent);
        expect(config.getTaskToolRegistration()).toBe(callerRegistration);
        expect(registryTaskTool(config)).toBe(preAdoptionTaskTool);
        expect(agentToolNames(agent)).toContain('task');
      } finally {
        await agent.dispose();
      }
    } finally {
      await disposeCliRuntime(runtimeId);
      await built.cleanup();
    }
  });

  it('T3c excludeTools governance is never overridden: a caller-excluded task tool stays absent after the reconcile @requirement:REQ-3222-AC2 @scenario:exclusion-respected @given:a caller-initialized Config with excludeTools ["task"] and NO taskToolRegistration @when:fromConfig({ config, sessionId, messageBus }) @then:the shipped task tool is still NOT registered (the deny-list wins over the reconcile)', async () => {
    const callerFactories: CallerAgentRuntimeFactories = {
      agentClientFactory: (config, runtimeState) =>
        createAgentClient(config, runtimeState),
    };
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      callerFactories,
      { excludeTools: ['task'] },
    );
    const runtimeId = 'issue3222-fromconfig-tasktool-excluded';
    try {
      await built.config.initialize({ messageBus: built.messageBus });
      expect(registryTaskTool(built.config)).toBeUndefined();

      const agent: Agent = await fromConfig({
        config: built.config,
        sessionId: runtimeId,
        messageBus: built.messageBus,
      });
      try {
        expect(registryTaskTool(internalConfig(agent))).toBeUndefined();
        expect(agentToolNames(agent)).not.toContain('task');
      } finally {
        await agent.dispose();
      }
    } finally {
      await disposeCliRuntime(runtimeId);
      await built.cleanup();
    }
  });

  it(
    'T3a-PROP for any non-empty sessionId, a caller-initialized Config without a task-tool registration gains the shipped task tool on adoption @requirement:REQ-3222-AC2 @scenario:property-reconcile @given:any non-empty sessionId @when:fromConfig({ config, sessionId, messageBus }) @then:the agent runtime lists the "task" tool for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const callerFactories: CallerAgentRuntimeFactories = {
            agentClientFactory: (config, runtimeState) =>
              createAgentClient(config, runtimeState),
          };
          const built = await buildFactoryLessConfig(
            'plain-text.jsonl',
            callerFactories,
          );
          try {
            await built.config.initialize({ messageBus: built.messageBus });
            const agent: Agent = await fromConfig({
              config: built.config,
              sessionId,
              messageBus: built.messageBus,
            });
            try {
              return agentToolNames(agent).includes('task');
            } finally {
              await agent.dispose();
            }
          } finally {
            await disposeCliRuntime(sessionId);
            await built.cleanup();
          }
        }),
        { numRuns: 5 },
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );
});
