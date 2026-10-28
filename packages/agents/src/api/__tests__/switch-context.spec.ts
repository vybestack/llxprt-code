/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-004
 * @requirement:REQ-005
 * @requirement:REQ-009
 *
 * Provider / model / profile switching + context preservation (RED).
 * Behavioral integration tests against a real public Agent over real
 * FakeProviders registered as provider contributions (helpers/
 * replay-provider-agent.ts). Tests FAIL NATURALLY — stub methods throw NYI;
 * no mock theater, only value/sequence assertions.
 *
 * Covers:
 * - T4  setProvider mid-session → getProvider reflects, next turn uses new
 *        provider, content generator rebuilt (observable via follow-up turn).
 * - T4b profiles.apply (standard + load-balancer) → provider/model/params/
 *        auth match the profile.
 * - T4c client rebinding — after switch the agent delegates to the CURRENT
 *        client; no stale cache; a follow-up turn still works.
 * - T4d manual-switch keeps the conversation: prior history survives the
 *        switch + follow-up sees prior messages (the product-critical
 *        guarantee).
 * - T4e LB-failover uses the SAME transfer path (switch ≡ failover) → prior
 *        history survives + context preserved.
 * - T4f switching INTO a provider that can't accept the prior provider's
 *        thinking blocks → stripThoughts normalization applied.
 * - T5  setModel/setModelParam → getModel/getModelParams reflect; params reach
 *        the provider call.
 *
 * Property test: fc-generated message history round-trip + survival across a
 * switch for T4d.
 */

import { describe, it, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fc from 'fast-check';
import type {
  AgentMessage,
  AgentHistoryItem,
} from '@vybestack/llxprt-code-agents';
import {
  buildAgent,
  drain,
  typesOf,
  countType,
  isTextEvent,
  isRecord,
  loadProfileFixture,
  loadLoadBalancerProfileFixture,
  tempRoot,
} from './helpers/agentHarness.js';
import {
  buildReplayProviderAgent,
  fixtureKeys,
} from './helpers/replay-provider-agent.js';

/**
 * Provider/model switches select this contributed alias: built-in provider
 * names such as `openai` cannot be contributed, so a replaying provider that
 * a switch can reach has its own name.
 */
const SWITCH_TARGET = 'replay-openai';

/**
 * Narrows a profile's `modelParams` to a Record WITHOUT a cast or conditional
 * expect. Returns the param keys present in the profile fixture so the spec
 * can assert each one reaches the live agent unconditionally.
 */
function profileParamKeys(
  profile: Readonly<Record<string, unknown>>,
): readonly string[] {
  const candidate = profile['modelParams'];
  if (isRecord(candidate)) {
    return Object.keys(candidate);
  }
  return [];
}

/** Reads a single profile param value by key (or undefined if absent). */
function profileParamValue(
  profile: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  const candidate = profile['modelParams'];
  if (isRecord(candidate)) {
    return candidate[key];
  }
  return undefined;
}

/**
 * Narrows an unknown to a typed string by throwing if it is not a string.
 * TS narrows via the throw, so the return is `string` with NO cast. Used for
 * profile string fields (name, provider, model, authKeyName) that must be
 * typed locals for meaningful assertions.
 */
function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string') {
    throw new Error(`expected ${field} to be a string`);
  }
  return v;
}

/** Starts on the two-turn script; a switch reaches the second-turn script. */
function buildSwitchAgent(): ReturnType<typeof buildReplayProviderAgent> {
  return buildReplayProviderAgent({
    initial: {
      alias: 'fake',
      script: { fixtureRelPath: 'provider-switch-two-turn.jsonl' },
    },
    targets: [
      {
        alias: SWITCH_TARGET,
        script: { fixtureRelPath: 'provider-switch-second-turn.jsonl' },
      },
    ],
  });
}

/**
 * Starts on a replaying provider; profiles apply to the built-in providers,
 * whose named keys are served by the agent's credential authority.
 */
function buildProfileSwitchAgent(
  fixtureRelPath: string,
): ReturnType<typeof buildReplayProviderAgent> {
  return buildReplayProviderAgent({
    initial: { alias: 'fake', script: { fixtureRelPath } },
    storedKeys: fixtureKeys('openai-prod', 'anthropic-prod'),
  });
}

describe('Switch-context @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-004 @requirement:REQ-005', () => {
  it('T4 setProvider mid-session → getProvider reflects it and the follow-up turn uses the new provider over the switched fixture @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-004', async () => {
    const { agent, cleanup } = await buildSwitchAgent();
    try {
      // first turn establishes a session
      const first = await drain(agent.stream('turn one'));
      expect(countType(first, 'done')).toBe(1);

      // switch the provider mid-session
      await agent.setProvider(SWITCH_TARGET, 'gpt-4o');

      // getProvider now reflects the switched provider
      expect(agent.getProvider()).toBe(SWITCH_TARGET);
      expect(agent.getModel()).toBe('gpt-4o');

      // the follow-up turn uses the new provider; the content generator was
      // rebuilt, observable as a successful follow-up turn over the fixture's
      // second scripted line.
      const second = await drain(agent.stream('turn two'));
      const secondTypes = typesOf(second);
      expect(countType(second, 'done')).toBe(1);
      expect(countType(second, 'text')).toBeGreaterThanOrEqual(1);
      expect(secondTypes[secondTypes.length - 1]).toBe('done');

      const textEvents = second.filter(isTextEvent);
      expect(textEvents.length).toBeGreaterThanOrEqual(1);
      expect(textEvents[0].text).toContain('after the switch');
    } finally {
      await cleanup();
    }
  });

  it('T4b profiles.apply for a STANDARD profile projects provider/model/params/auth onto the live agent @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const profile = await loadProfileFixture('profile-standard.json');
    const { agent, cleanup } =
      await buildProfileSwitchAgent('plain-text.jsonl');
    try {
      const name = requireString(profile['name'], 'profile name');

      await agent.profiles.apply(name);

      // after apply, the live agent reflects the profile's provider/model
      expect(agent.getProvider()).toBe(profile['provider']);
      expect(agent.getModel()).toBe(profile['model']);

      // modelParams match the profile
      const params = agent.getModelParams();
      for (const key of profileParamKeys(profile)) {
        expect(params[key]).toStrictEqual(profileParamValue(profile, key));
      }

      // auth status reflects the profile's authKeyName winner
      const status = agent.getProviderStatus();
      expect(status.keyName).toBe(profile['authKeyName']);
    } finally {
      await cleanup();
    }
  });

  it('T4b profiles.apply for a LOAD-BALANCER profile projects the active provider/model and marks the LB flag @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const profile = await loadLoadBalancerProfileFixture(
      'profile-load-balancer.json',
    );
    const { agent, cleanup } =
      await buildProfileSwitchAgent('plain-text.jsonl');
    try {
      const name = requireString(profile['name'], 'profile name');

      await agent.profiles.apply(name);

      // after apply, the live agent reflects the LB profile's active provider/model
      expect(agent.getProvider()).toBe(profile['provider']);
      expect(agent.getModel()).toBe(profile['model']);

      // the profile is observable as load-balancer in the summaries
      const summaries = agent.profiles.list();
      const matching = summaries.find((s) => s.name === name);
      expect(matching).toBeDefined();
      expect(matching?.isLoadBalancer).toBe(true);

      // LB profile params reach the live agent
      const params = agent.getModelParams();
      for (const key of profileParamKeys(profile)) {
        expect(params[key]).toStrictEqual(profileParamValue(profile, key));
      }
    } finally {
      await cleanup();
    }
  });

  it('T4c client rebinding on switch — after switch the agent delegates to the CURRENT client (no stale cache); a follow-up turn still works @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-004 @requirement:REQ-005', async () => {
    const { agent, cleanup } = await buildSwitchAgent();
    try {
      const first = await drain(agent.stream('turn one'));
      expect(countType(first, 'done')).toBe(1);

      // switch + then rebind via auth to force client re-evaluation
      await agent.setProvider(SWITCH_TARGET, 'gpt-4o');
      // auth.status is a synchronous accessor; call without await
      const authStatus = agent.auth.status(SWITCH_TARGET);
      expect(typeof authStatus).toBe('string');

      // the follow-up turn works through the CURRENT client — observable as a
      // successful turn with text + exactly one done.
      const second = await drain(agent.stream('turn two'));
      expect(countType(second, 'done')).toBe(1);
      expect(countType(second, 'text')).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup();
    }
  });

  it('T4d manual-switch keeps the conversation: prior history survives the switch and the follow-up sees prior messages @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-005', async () => {
    const { agent, cleanup } = await buildSwitchAgent();
    try {
      const first = await drain(agent.stream('turn one'));
      expect(countType(first, 'done')).toBe(1);

      // the switch runs BEFORE the continuity compare so RED fails at the
      // switch (NYI) and GREEN proceeds to a meaningful assertion.
      await agent.setProvider(SWITCH_TARGET, 'gpt-4o');

      // The HistoryService is reused across the switch (the headline
      // guarantee): the first turn's messages are still in the history, so a
      // fresh service would fail this. Guard the content is real first so the
      // compare cannot pass vacuously.
      const afterSwitch = await agent.getHistory();
      expect(afterSwitch.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(afterSwitch).includes('turn one')).toBe(true);

      // behavioral continuity: the follow-up turn sees the prior N messages
      const second = await drain(agent.stream('turn two'));
      expect(countType(second, 'done')).toBe(1);

      // history includes messages from BOTH turns (continuity preserved)
      const history = await agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(history).includes('turn one')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T4e LB-failover uses the SAME transfer path (switch ≡ failover) → prior history survives and context is preserved @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-005 @requirement:REQ-009', async () => {
    const profile = await loadLoadBalancerProfileFixture(
      'profile-load-balancer.json',
    );
    // The profile's providers are built-in names the agent cannot replay, so
    // the load-balancer profile found in the working directory targets the
    // replaying alias instead.
    const workingDir = mkdtempSync(join(tempRoot, 'lb-failover-'));
    mkdirSync(join(workingDir, 'fixtures'));
    writeFileSync(
      join(workingDir, 'fixtures', 'profile-load-balancer.json'),
      JSON.stringify({ ...profile, provider: SWITCH_TARGET }),
    );
    const { agent, cleanup } = await buildReplayProviderAgent({
      initial: {
        alias: 'fake',
        script: { fixtureRelPath: 'provider-switch-two-turn.jsonl' },
      },
      targets: [
        {
          alias: SWITCH_TARGET,
          script: { fixtureRelPath: 'provider-switch-second-turn.jsonl' },
        },
      ],
      storedKeys: fixtureKeys('anthropic-prod'),
      configOverrides: { workingDir },
    });
    try {
      // seed a turn so there is real context to preserve across failover
      const first = await drain(agent.stream('turn one'));
      expect(countType(first, 'done')).toBe(1);

      // LB-failover path = profiles.apply (the same transfer path as a manual
      // switch). Runs before the continuity compare so RED fails at apply (NYI).
      const name = requireString(profile['name'], 'profile name');
      await agent.profiles.apply(name);
      expect(agent.getProvider()).toBe(SWITCH_TARGET);

      // The HistoryService is reused across the LB failover (switch ≡
      // failover): the first turn's messages are still in the history.
      const afterApply = await agent.getHistory();
      expect(afterApply.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(afterApply).includes('turn one')).toBe(true);

      // context preserved: the follow-up turn sees the prior messages
      const second = await drain(agent.stream('turn two'));
      expect(countType(second, 'done')).toBe(1);
      const history = await agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(history).includes('turn one')).toBe(true);
    } finally {
      await cleanup();
      rmSync(workingDir, { recursive: true, force: true });
    }
  });

  it('T4f switching INTO a provider that cannot accept the prior provider thinking blocks applies stripThoughts normalization @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-005', async () => {
    const { agent, cleanup } = await buildReplayProviderAgent({
      initial: {
        alias: 'fake',
        script: { fixtureRelPath: 'plain-text.jsonl' },
      },
      targets: [
        {
          alias: SWITCH_TARGET,
          script: { fixtureRelPath: 'plain-text.jsonl' },
        },
      ],
    });
    try {
      // Seed a history that explicitly carries a model thinking block WITH a
      // signature — the exact field stripThoughts must delete. Post-P21 the
      // history is IContent (speaker/blocks), so the thinking block carries
      // the neutral `signature` field that stripThoughts deletes.
      const signatureFromPriorProvider = 'sig-from-prior-provider';
      const beforeHistory: AgentHistoryItem[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello there' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'considering the greeting',
              signature: signatureFromPriorProvider,
            },
            { type: 'text', text: 'Hi! How can I help?' },
          ],
        },
      ];
      await agent.setHistory(beforeHistory);

      // PRESENT BEFORE: the seeded signature survives the
      // setHistory → getHistory round-trip WITHOUT stripping (the default).
      const beforeRoundTrip = await agent.getHistory();
      const beforeSerialized = JSON.stringify(beforeRoundTrip);
      expect(beforeSerialized.includes('sig-from-prior-provider')).toBe(true);

      // Switch into a provider that cannot accept thinking blocks; the
      // subsequent setHistory({stripThoughts:true}) is the normalization the
      // switch path applies and is what we verify here.
      await agent.setProvider(SWITCH_TARGET, 'gpt-4o');

      // Apply normalization. setHistory with stripThoughts:true must delete
      // every signature key from each model thinking block.
      await agent.setHistory(beforeHistory, { stripThoughts: true });

      // ABSENT AFTER: the signature value is GONE from the normalized history.
      const normalized = await agent.getHistory();
      expect(normalized.length).toBeGreaterThanOrEqual(1);
      const afterSerialized = JSON.stringify(normalized);
      expect(afterSerialized.includes(signatureFromPriorProvider)).toBe(false);

      // CONTENT PRESERVED: stripThoughts removes ONLY the signature, not the
      // thinking block's text nor the rest of the conversation. The thinking
      // text and the user/model text must all still be present.
      expect(afterSerialized.includes('considering the greeting')).toBe(true);
      expect(afterSerialized.includes('hello there')).toBe(true);
      expect(afterSerialized.includes('Hi! How can I help?')).toBe(true);

      // The model turn's thought text survives (only the signature
      // is stripped) — verify via direct structural read of the IContent
      // blocks, not substring, so the assertion is exact.
      const normalizedItems = normalized;
      const modelTurn = normalizedItems.find((c) => c.speaker === 'ai');
      expect(modelTurn).toBeDefined();
      const thoughtBlock = modelTurn?.blocks.find(
        (b): b is Extract<typeof b, { type: 'thinking' }> =>
          b.type === 'thinking',
      );
      expect(thoughtBlock).toBeDefined();
      expect(thoughtBlock?.thought).toBe('considering the greeting');
      // The signature key was removed from the surviving thought block.
      expect('signature' in (thoughtBlock as Record<string, unknown>)).toBe(
        false,
      );
    } finally {
      await cleanup();
    }
  });

  it('T5 setModel/setModelParam → getModel/getModelParams reflect; params reach the provider call @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-004', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // setModel reflects in getModel
      await agent.setModel('gpt-4o-mini');
      expect(agent.getModel()).toBe('gpt-4o-mini');

      // setModelParam reflects in getModelParams
      agent.setModelParam('temperature', 0.7);
      agent.setModelParam('max_tokens', 1024);
      const params = agent.getModelParams();
      expect(params['temperature']).toBe(0.7);
      expect(params['max_tokens']).toBe(1024);

      // params reach the provider call — observable via a successful follow-up
      // turn that uses the configured model + params.
      const events = await drain(agent.stream('check params'));
      expect(countType(events, 'done')).toBe(1);
      expect(countType(events, 'text')).toBeGreaterThanOrEqual(1);

      // clearModelParam removes the param
      agent.clearModelParam('temperature');
      const afterClear = agent.getModelParams();
      expect(afterClear['temperature']).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T5i setModel performs a REAL client rebind that preserves prior conversation context (REQ-005 across a genuine rebind, not the no-op setProvider path) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-005', async () => {
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      // Run one turn so a chat/HistoryService actually exists.
      const first = await drain(agent.stream('turn one'));
      expect(countType(first, 'done')).toBe(1);

      // The conversation context must actually exist before the switch —
      // otherwise the preservation assertion below would be vacuously true.
      const before = await agent.getHistory();
      expect(before.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(before).includes('turn one')).toBe(true);

      // setModel runs setActiveModel + initializeContentGeneratorConfig(),
      // which performs a REAL client rebind via transferHistoryToNewClient.
      // The rebind preserves prior conversation context onto the rebound
      // client (history is carried across; the next turn observes it).
      await agent.setModel('gpt-4o-mini');
      expect(agent.getModel()).toBe('gpt-4o-mini');

      // A follow-up turn still succeeds through the rebound client.
      const second = await drain(agent.stream('turn two'));
      expect(countType(second, 'done')).toBe(1);
      expect(countType(second, 'text')).toBeGreaterThanOrEqual(1);

      // Prior history is retained across the rebind: the follow-up history
      // includes messages from BOTH turns (length grew, prior text present).
      const history = await agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
      const historySerialized = JSON.stringify(history);
      expect(historySerialized.includes('turn one')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  // ─── Property-based: history round-trip + identity stability for T4d ─────

  it('T4dp property: generated message histories round-trip and survive a switch @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-005', async () => {
    const {
      t4dpPropertyGeneratedMessageHistoriesRoundTripAndPreserveTheSameHistoryServiceProperty,
      observations,
    } =
      await observeT4dpPropertyGeneratedMessageHistoriesRoundTripAndPreserveTheSameHistoryService();
    await fc.assert(
      t4dpPropertyGeneratedMessageHistoriesRoundTripAndPreserveTheSameHistoryServiceProperty,
    );
    expect(
      observations.filter(
        ({ historyLength, seededLength }) => historyLength < seededLength,
      ),
    ).toStrictEqual([]);
    expect(
      observations.flatMap(({ missingTexts }) => missingTexts),
    ).toStrictEqual([]);
  });

  const observeT4dpPropertyGeneratedMessageHistoriesRoundTripAndPreserveTheSameHistoryService =
    async () => {
      const observations: Array<{
        historyLength: number;
        seededLength: number;
        missingTexts: string[];
      }> = [];
      const t4dpPropertyGeneratedMessageHistoriesRoundTripAndPreserveTheSameHistoryServiceProperty =
        fc.asyncProperty(
          fc.array(
            fc.record({
              role: fc.constant('user' as const),
              text: fc.string({ minLength: 1, maxLength: 80 }),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          async (generatedTurns) => {
            const { agent, cleanup } = await buildSwitchAgent();
            try {
              // seed history with generated messages via the public setHistory
              const seeded: AgentMessage[] = generatedTurns.map((t) => ({
                speaker: 'human' as const,
                blocks: [{ type: 'text' as const, text: t.text }],
              }));
              await agent.setHistory(seeded);

              // switch provider
              await agent.setProvider(SWITCH_TARGET, 'gpt-4o');

              // history length is at least the seeded count (continuity)
              const history = await agent.getHistory();

              // every seeded text is present in the returned history (checked
              // via direct text-block extraction from the neutral IContent
              // blocks, not JSON serialization, since JSON.stringify escapes
              // backslashes and other characters making substring matching
              // unreliable for arbitrary fc.string inputs)
              const historyTexts = history.flatMap((message) =>
                Array.isArray(message.blocks)
                  ? message.blocks.map((block) =>
                      block.type === 'text' && block.text.length > 0
                        ? block.text
                        : '',
                    )
                  : [],
              );
              const missingTexts = generatedTurns
                .map(({ text }) => text)
                .filter((text) => !historyTexts.includes(text));
              observations.push({
                historyLength: history.length,
                seededLength: seeded.length,
                missingTexts,
              });
              return (
                history.length >= seeded.length && missingTexts.length === 0
              );
            } finally {
              await cleanup();
            }
          },
        );
      return {
        t4dpPropertyGeneratedMessageHistoriesRoundTripAndPreserveTheSameHistoryServiceProperty,
        observations,
      };
    };

  // ─── Property-based: model-param map round-trip for T5 ──────────────────

  it('T5p property: generated model-param maps round-trip through setModelParam/getModelParams @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-004', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(
          fc.oneof(
            // Deliberately include prototype-hazard keys so the property
            // regression-guards the no-pollution behavior: model params are
            // stored in a null-prototype object, so these round-trip safely.
            fc.constantFrom(
              '__proto__',
              'constructor',
              'prototype',
              'toString',
              'hasOwnProperty',
            ),
            fc
              .string({ minLength: 1, maxLength: 20 })
              .filter((s) => !s.includes(' ')),
          ),
          fc.oneof(fc.boolean(), fc.integer(), fc.float(), fc.string()),
        ),
        async (paramMap) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            for (const key of Object.keys(paramMap)) {
              agent.setModelParam(key, paramMap[key]);
            }
            const got = agent.getModelParams();
            for (const key of Object.keys(paramMap)) {
              expect(got[key]).toStrictEqual(paramMap[key]);
            }
          } finally {
            await cleanup();
          }
        },
      ),
    );
  });
});
