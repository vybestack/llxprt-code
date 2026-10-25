/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import { countType, drain } from './helpers/agentHarness.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { useConsumerPromptDirectory } from './helpers/consumer-owner-primitives.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * Behavioral suite for the public `fromConfig` API over a minimal `Config` the
 * caller built: the agent assembles its own runtime, registers the shipped task
 * tool, drives a turn, and applies an activation intent.
 */

describe('fromConfig agent-owned assembly @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
  useConsumerPromptDirectory();
  const credentials = useOwnedCredentials();
  useFakeResponsesReplay('plain-text.jsonl');

  it('T2a adopting a factory-less minimal Config yields a working Agent client and registers the shipped task tool @requirement:REQ-3222-AC2 @scenario:factory-less-adoption @given:a minimal Config carrying NO agentClientFactory, toolSchedulerFactory, or taskToolRegistration @when:fromConfig({ config, sessionId }) @then:the tool surface lists the shipped "task" tool and a turn completes', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: { sessionId: 'issue3222-fromconfig-factoryless' },
    });
    try {
      const agent: Agent = built.agent;
      const names = agent.tools.list().map((tool) => tool.name);
      expect(names).toContain('task');

      // Chat creation is lazy by design in AgentClient: the turn is what
      // starts the client, so one terminal done event shows it initialized.
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await built.close();
    }
  });

  it('T2c adopting with an activation intent selects the activation provider and model @requirement:REQ-3222-AC2 @scenario:activation-intent @given:a minimal Config and an activation intent for the fake provider with another model @when:fromConfig({ config, activation }) @then:the agent reports the activation provider and model and a turn completes', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {
        activation: {
          provider: 'fake',
          model: 'adopted-model',
          authMode: 'none',
        },
      },
    });
    try {
      const agent: Agent = built.agent;
      expect(agent.getModel()).toBe('adopted-model');
      expect(agent.getProvider()).toBe('fake');

      await agent.sessionClient.refreshAuth();
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await built.close();
    }
  });
});
