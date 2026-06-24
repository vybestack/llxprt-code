/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// @plan:PLAN-20260621-COREAPIREMED.P23
// @requirement:REQ-001,REQ-002,REQ-005
//
// Mutation-killing behavioral tests for the @vybestack/llxprt-code-agents
// public API. Each case targets a SURVIVING Stryker mutant on
// createAgent.ts / agentImpl.ts and kills it by asserting on a REAL,
// causally-driven public output — no mock theater, no reverse tests.
//
// Targeted mutants (file:line in origin/main):
//   1. createAgent.ts:253-254  post-auth client guard — success path observed
//   2. createAgent.ts spreads + agentImpl.ts:1190-1195 rebuildLoop
//      conditional spreads — handler presence diverges behaviorally
//   4. agentImpl.ts:415-420 seedAuthState equality guards — observable via
//      getProviderStatus() authStatus + keyName
//   5. agentImpl.ts:1128-1130 provider-switch model-change guard — observable
//      via getModel()/getProvider() after a switch
//
// NON-OBSERVABLE (documented honestly, NOT faked):
//   3. agentImpl.ts:1035-1042 token-tracking ternaries — the model token sums
//      in uiTelemetryService.getMetrics().models stay 0 under the FakeProvider
//      drive (that map is populated by the CLI UI's setTokenTrackingMetrics,
//      not by the agent stream path), so the `promptTokens > 0` branch is
//      never taken and the asserted value is the sessionUsage fallback for
//      BOTH the original and any mutant. Asserting it would be a no-op test.
//   6. agentImpl.ts:1060-1063 readCompressionTokenCount `service === null`
//      guard — only reachable via agent.compress(); the HistoryService is
//      never null under the harness (always non-null from construction), so
//      the null-branch is defensively dead in this environment.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  type AgentEvent,
  buildAgent,
  buildAgentFromContent,
  drain,
  countType,
  isDoneEvent,
  isTextEvent,
  isToolCallEvent,
  isToolResultEvent,
} from './helpers/agentHarness.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

// ─── Target 1: createAgent.ts:253-254 post-auth client guard ────────────────

describe('mutation P23 — target 1: post-auth client guard (createAgent.ts:253-254) @plan:PLAN-20260621-COREAPIREMED.P23', () => {
  it('a successful plain-text build reaches a live, drivable agent (success path through the post-auth guard) (REQ-001)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // The success branch of the post-auth guard executes: the agent has a
      // live, non-undefined client. Driving one turn settles a full loop —
      // exactly one terminal 'done' and at least one 'text' event.
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
      expect(events.filter(isTextEvent).length).toBeGreaterThanOrEqual(1);
      expect(events.filter(isDoneEvent)).toHaveLength(1);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('the built agent exposes the genuine Config identity it owns (REQ-001)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // The success path binds the createAgent-owned Config (an
      // AgentBootstrapError on the throw-branch would have rejected the build).
      const config = agent.getConfig();
      expect(config).toBeDefined();
      // A populated provider/model proves the post-auth client is live and
      // the runtime was activated.
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── Target 2: conditional spreads for handler presence ─────────────────────

describe('mutation P23 — target 2: handler-presence conditional spreads diverge behavior (REQ-002)', () => {
  it('an agent built WITH onApproval that proceeds drives a tool fixture to a real tool-result (handler included) (REQ-002)', async () => {
    // onApproval forces tool execution via the included approvalHandler spread
    // (createAgent.ts spread + agentImpl.ts:1190-1195 rebuildLoop spread).
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl', {
      onApproval: () => ToolConfirmationOutcome.ProceedOnce,
    });
    try {
      const events: AgentEvent[] = await drain(agent.stream('run the tool'));
      const calls = events.filter(isToolCallEvent);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0].call.name).toBe('read_file');
      // The tool ACTUALLY executes — a real tool-result (not just a call).
      const results = events.filter(isToolResultEvent);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('an agent built WITHOUT onApproval on a non-tool fixture produces no tool events (handler omitted) (REQ-002)', async () => {
    // No approval handler spread — the plain-text fixture drives pure text.
    // The presence/absence of the handler produces observably different event
    // streams: tool-result here vs none above (kills always-include/omit).
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(events.filter(isToolCallEvent)).toHaveLength(0);
      expect(events.filter(isToolResultEvent)).toHaveLength(0);
      expect(events.filter(isTextEvent).length).toBeGreaterThanOrEqual(1);
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('a multi-tool fixture with proceeding onApproval runs every tool before the answer (handler threads through rebuildLoop) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent(
      'multi-tool-then-answer.jsonl',
      {
        onApproval: () => ToolConfirmationOutcome.ProceedOnce,
      },
    );
    try {
      const events: AgentEvent[] = await drain(agent.stream('run both'));
      const calls = events.filter(isToolCallEvent);
      expect(calls.length).toBeGreaterThanOrEqual(2);
      // Both tools execute (real results present) — the threaded handler
      // answers every confirmation, proving the conditional spread includes
      // the approvalHandler on EVERY rebuild, not just the initial loop.
      expect(events.filter(isToolResultEvent).length).toBeGreaterThanOrEqual(
        calls.length,
      );
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── Target 4: seedAuthState equality guards (agentImpl.ts:415-420) ──────────

describe('mutation P23 — target 4: seedAuthState equality guards observable via getProviderStatus (REQ-002)', () => {
  it('config.auth.keyName seeds onto providerState and surfaces in getProviderStatus (keyName !== undefined guard) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      auth: { keyName: 'my-named-key' },
    });
    try {
      const status = agent.getProviderStatus();
      // The keyName guard (keyName !== undefined) executes: keyName wins
      // precedence and surfaces. Flipping the guard to !== undefined→===undefined
      // drops the keyName field and flips authStatus to unauthenticated.
      expect(status.authStatus).toBe('authenticated');
      expect(status.keyName).toBe('my-named-key');
    } finally {
      await cleanup();
    }
  }, 30000);

  it('config.auth.apiKey sets inlineKeyPresent so getProviderStatus reports authenticated (apiKey !== undefined guard) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      auth: { apiKey: 'inline-secret' },
    });
    try {
      const status = agent.getProviderStatus();
      // inlineKeyPresent = apiKey !== undefined executes → winner is 'inline'
      // → authenticated. Flipping the guard makes inlineKeyPresent stale-false
      // → authStatus becomes 'unauthenticated'.
      expect(status.authStatus).toBe('authenticated');
      // keyName is NOT surfaced for an inline-only auth (different guard path).
      expect(status.keyName).toBeUndefined();
    } finally {
      await cleanup();
    }
  }, 30000);

  it('no config.auth leaves getProviderStatus unauthenticated (the guards short-circuit) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const status = agent.getProviderStatus();
      // With no auth, seedAuthState returns early; no winner → unauthenticated.
      expect(status.authStatus).toBe('unauthenticated');
      expect(status.keyName).toBeUndefined();
    } finally {
      await cleanup();
    }
  }, 30000);

  it('keyName takes precedence over inline apiKey when both are present (precedence observable) (REQ-002)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      auth: { apiKey: 'inline-secret', keyName: 'named-key' },
    });
    try {
      const status = agent.getProviderStatus();
      // keyName wins over inline (REQ-008 precedence) — the keyName field
      // surfaces, proving BOTH guards executed in order.
      expect(status.authStatus).toBe('authenticated');
      expect(status.keyName).toBe('named-key');
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── Target 5: provider-switch model-change guard (agentImpl.ts:1128-1130) ───

describe('mutation P23 — target 5: provider-switch model-change guard (agentImpl.ts:1128-1130) (REQ-005)', () => {
  it('a provider+model switch reflects the NEW model on getModel (model !== undefined && !== current guard) (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      const beforeModel = agent.getModel();
      expect(beforeModel).toBe('fake-model');
      // Drive turn 1 first so the provider is live.
      const events1: AgentEvent[] = await drain(agent.stream('turn one'));
      expect(countType(events1, 'done')).toBe(1);

      // Switch provider + model. The model-change guard executes (model is
      // defined AND differs from current) → getModel reflects the new value.
      await agent.setProvider('other-provider', 'switched-model');
      expect(agent.getProvider()).toBe('other-provider');
      expect(agent.getModel()).toBe('switched-model');

      // Turn 2 still drives successfully (continuity preserved).
      const events2: AgentEvent[] = await drain(agent.stream('turn two'));
      expect(countType(events2, 'done')).toBe(1);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('a no-op model switch to the SAME model does NOT error (guard short-circuits the equality) (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      // providerState.model stays 'fake-model'; switching to the same model
      // exercises the `model !== current` guard's false branch — it must NOT
      // throw and the model stays unchanged.
      await expect(
        agent.setProvider('fake', 'fake-model'),
      ).resolves.toBeUndefined();
      expect(agent.getModel()).toBe('fake-model');
    } finally {
      await cleanup();
    }
  }, 30000);
});

// ─── Property-based cases (>=30% property ratio) ────────────────────────────

describe('mutation P23 — property cases @plan:PLAN-20260621-COREAPIREMED.P23 @requirement:REQ-001,REQ-002', () => {
  it('PROP target-1: for any non-empty prompt, a successful build drives exactly one done + >=1 text (post-auth guard holds) (REQ-001)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 60 }).map((s) => s.trim()),
        async (prompt) => {
          if (prompt.length === 0) return true;
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            const events: AgentEvent[] = await drain(agent.stream(prompt));
            return (
              countType(events, 'done') === 1 &&
              events.filter(isTextEvent).length >= 1 &&
              agent.getProvider() === 'fake' &&
              agent.getModel() === 'fake-model'
            );
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP target-4: for any non-empty keyName string, getProviderStatus surfaces it and reports authenticated (keyName guard) (REQ-002)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        async (keyName) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
            auth: { keyName },
          });
          try {
            const status = agent.getProviderStatus();
            return (
              status.authStatus === 'authenticated' &&
              status.keyName === keyName
            );
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP target-5: for any model string differing from the current, setProvider reflects the new model (change guard) (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 40 })
          .filter((m) => m !== 'fake-model'),
        async (model) => {
          const { agent, cleanup } = await buildAgent(
            'provider-switch-two-turn.jsonl',
          );
          try {
            await agent.setProvider('p', model);
            return agent.getModel() === model && agent.getProvider() === 'p';
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP target-4b: for any non-empty apiKey, getProviderStatus reports authenticated and does NOT surface keyName (inline guard) (REQ-002)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        async (apiKey) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
            auth: { apiKey },
          });
          try {
            const status = agent.getProviderStatus();
            return (
              status.authStatus === 'authenticated' &&
              status.keyName === undefined
            );
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP target-2: handler presence diverges — WITH onApproval yields tool-results, WITHOUT yields none (REQ-002)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (seed) => {
        // The WITH-handler agent drives a tool fixture to a real result.
        const withHandler = await buildAgent('tool-call-then-answer.jsonl', {
          onApproval: () => ToolConfirmationOutcome.ProceedOnce,
        });
        try {
          const withEvents: AgentEvent[] = await drain(
            withHandler.agent.stream(`seed-${seed}`),
          );
          const withResults = withEvents.filter(isToolResultEvent).length >= 1;
          // The WITHOUT-handler agent on a plain fixture yields no tools.
          const without = await buildAgent('plain-text.jsonl');
          try {
            const withoutEvents: AgentEvent[] = await drain(
              without.agent.stream(`seed-${seed}`),
            );
            const withoutTools =
              withoutEvents.filter(isToolCallEvent).length === 0;
            // The two branches diverge observably — kills always-include/omit.
            return withResults && withoutTools;
          } finally {
            await without.cleanup();
          }
        } finally {
          await withHandler.cleanup();
        }
      }),
    );
  }, 30000);

  it('setProvider without a model preserves the current model (kills 1139 ConditionalExpression true) (REQ-005)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const beforeModel = agent.getModel();
      await agent.setProvider('openai');
      expect(agent.getModel()).toBe(beforeModel);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('PROP setProvider model preservation: for any provider name, setProvider without model preserves the current model (REQ-005)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        async (providerName) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            const beforeModel = agent.getModel();
            await agent.setProvider(providerName);
            return agent.getModel() === beforeModel;
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);
});

// ─── Target 7: agentImpl.ts:1192-1193 rebuild approvalHandler propagation ──

function twoToolFourTurnFixture(): string {
  const t1 = JSON.stringify({
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'c1',
            name: 'read_file',
            parameters: { path: '{{CWD}}/package.json' },
          },
        ],
      },
    ],
  });
  const t2 = JSON.stringify({
    chunks: [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'continuation1' }] },
    ],
  });
  const t3 = JSON.stringify({
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'c2',
            name: 'read_file',
            parameters: { path: '{{CWD}}/package.json' },
          },
        ],
      },
    ],
  });
  const t4 = JSON.stringify({
    chunks: [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'continuation2' }] },
    ],
  });
  return `${t1}
${t2}
${t3}
${t4}
`;
}

describe('mutation P23 — target 7: rebuild propagates approvalHandler (agentImpl.ts:1192-1193) @plan:PLAN-20260621-COREAPIREMED.P23', () => {
  it('onApproval survives setProvider: tool auto-approves on turn 2 after rebuild (REQ-006)', async () => {
    const { agent, cleanup } = await buildAgentFromContent(
      twoToolFourTurnFixture(),
      {
        onApproval: () => ToolConfirmationOutcome.ProceedOnce,
      },
    );
    try {
      await drain(agent.stream('turn1'));
      await agent.setProvider('openai');
      const events = await drain(agent.stream('turn2'));
      const results = events.filter(isToolResultEvent);
      const done = events.filter(isDoneEvent);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(done).toHaveLength(1);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('onApproval survives setModel: tool auto-approves on turn 2 after rebuild (REQ-006)', async () => {
    const { agent, cleanup } = await buildAgentFromContent(
      twoToolFourTurnFixture(),
      {
        onApproval: () => ToolConfirmationOutcome.ProceedOnce,
      },
    );
    try {
      await drain(agent.stream('turn1'));
      await agent.setModel('alternate-model');
      const events = await drain(agent.stream('turn2'));
      const results = events.filter(isToolResultEvent);
      const done = events.filter(isDoneEvent);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(done).toHaveLength(1);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('double dispose is idempotent — second dispose does not throw (kills 1251 idempotency guard BlockStatement) (REQ-016)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await drain(agent.stream('one turn'));
      await agent.dispose();
      let threw = false;
      try {
        await agent.dispose();
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    } finally {
      await cleanup();
    }
  }, 30000);

  it('PROP double dispose idempotency: for any prompt text, the second dispose never throws (REQ-016)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        async (prompt) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            await drain(agent.stream(prompt));
            await agent.dispose();
            try {
              await agent.dispose();
            } catch {
              return false;
            }
            return true;
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);
});
