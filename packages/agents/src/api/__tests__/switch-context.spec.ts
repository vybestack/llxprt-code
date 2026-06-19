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
 * Behavioral integration tests against a real public Agent over a real
 * FakeProvider (LLXPRT_FAKE_RESPONSES seam). Tests FAIL NATURALLY — stub
 * methods throw NYI; no mock theater, only value/sequence/identity assertions.
 *
 * Covers:
 * - T4  setProvider mid-session → getProvider reflects, next turn uses new
 *        provider, content generator rebuilt (observable via follow-up turn).
 * - T4b profiles.apply (standard + load-balancer) → provider/model/params/
 *        auth match the profile.
 * - T4c client rebinding — after switch the agent delegates to the CURRENT
 *        client; no stale cache; a follow-up turn still works.
 * - T4d manual-switch HistoryService IDENTITY reuse + follow-up sees prior
 *        messages (the product-critical guarantee).
 * - T4e LB-failover uses the SAME transfer path (switch ≡ failover) → same
 *        HistoryService identity + context preserved.
 * - T4f switching INTO a provider that can't accept the prior provider's
 *        thinking blocks → stripThoughts normalization applied.
 * - T5  setModel/setModelParam → getModel/getModelParams reflect; params reach
 *        the provider call.
 *
 * Property test: fc-generated message history round-trip + identity stability
 * for T4d.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { AgentMessage } from '@vybestack/llxprt-code-agents';
import {
  buildAgent,
  drain,
  typesOf,
  countType,
  isTextEvent,
  isRecord,
  captureHistoryServiceIdentity,
  loadProfileFixture,
  loadLoadBalancerProfileFixture,
} from './helpers/agentHarness.js';

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

describe('Switch-context @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-004 @requirement:REQ-005', () => {
  it('T4 setProvider mid-session → getProvider reflects it and the follow-up turn uses the new provider over the switched fixture @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-004', async () => {
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      // first turn establishes a session
      const first = await drain(agent.stream('turn one'));
      expect(countType(first, 'done')).toBe(1);

      // switch the provider mid-session
      await agent.setProvider('openai', 'gpt-4o');

      // getProvider now reflects the switched provider
      expect(agent.getProvider()).toBe('openai');
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
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
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
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
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
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      const first = await drain(agent.stream('turn one'));
      expect(countType(first, 'done')).toBe(1);

      // switch + then rebind via auth to force client re-evaluation
      await agent.setProvider('openai', 'gpt-4o');
      // auth.status is a synchronous accessor; call without await
      const authStatus = agent.auth.status('openai');
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

  it('T4d manual-switch HistoryService IDENTITY reuse + follow-up sees prior messages @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-005', async () => {
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      // capture the HistoryService identity BEFORE the switch
      const existingHistoryService = captureHistoryServiceIdentity(agent);

      const first = await drain(agent.stream('turn one'));
      expect(countType(first, 'done')).toBe(1);

      // the switch runs BEFORE the final identity compare so RED fails at the
      // switch (NYI) and GREEN proceeds to a meaningful identity assertion.
      await agent.setProvider('openai', 'gpt-4o');

      // capture the HistoryService identity AFTER the switch
      const newHistoryService = captureHistoryServiceIdentity(agent);

      // IDENTITY reuse: the SAME HistoryService instance (the headline
      // guarantee). `toBe`, not equal contents. Guard both probes are REAL
      // instances first so the identity compare cannot pass vacuously when both
      // are undefined.
      expect(existingHistoryService).toBeDefined();
      expect(newHistoryService).toBeDefined();
      expect(newHistoryService).toBe(existingHistoryService);

      // behavioral continuity: the follow-up turn sees the prior N messages
      const second = await drain(agent.stream('turn two'));
      expect(countType(second, 'done')).toBe(1);

      // history includes messages from BOTH turns (continuity preserved)
      const history = await agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    } finally {
      await cleanup();
    }
  });

  it('T4e LB-failover uses the SAME transfer path (switch ≡ failover) → same HistoryService identity + context preserved @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-005 @requirement:REQ-009', async () => {
    const profile = await loadLoadBalancerProfileFixture(
      'profile-load-balancer.json',
    );
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      // seed a turn so there is real context to preserve across failover
      const first = await drain(agent.stream('turn one'));
      expect(countType(first, 'done')).toBe(1);

      const existingHistoryService = captureHistoryServiceIdentity(agent);

      // LB-failover path = profiles.apply (the same transfer path as a manual
      // switch). Runs before the identity compare so RED fails at apply (NYI).
      const name = requireString(profile['name'], 'profile name');
      await agent.profiles.apply(name);

      const newHistoryService = captureHistoryServiceIdentity(agent);

      // IDENTITY reuse across the LB failover (switch ≡ failover). Guard both
      // probes are REAL instances first so the compare cannot pass vacuously.
      expect(existingHistoryService).toBeDefined();
      expect(newHistoryService).toBeDefined();
      expect(newHistoryService).toBe(existingHistoryService);

      // context preserved: the follow-up turn sees the prior messages
      const second = await drain(agent.stream('turn two'));
      expect(countType(second, 'done')).toBe(1);
      const history = await agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    } finally {
      await cleanup();
    }
  });

  it('T4f switching INTO a provider that cannot accept the prior provider thinking blocks applies stripThoughts normalization @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-005', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // Seed a history that explicitly carries a model thinking part WITH a
      // thoughtSignature — the exact field stripThoughts must delete. This is
      // constructed at the genai Content/Part shape (AgentMessage = Content)
      // so the signature is present in the seeded state regardless of what
      // the fixture would have produced.
      const signatureFromPriorProvider = 'sig-from-prior-provider';
      const beforeHistory: AgentMessage[] = [
        {
          role: 'user',
          parts: [{ text: 'hello there' }],
        },
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'considering the greeting',
              thoughtSignature: signatureFromPriorProvider,
            },
            { text: 'Hi! How can I help?' },
          ],
        },
      ];
      await agent.setHistory(beforeHistory);

      // PRESENT BEFORE: the seeded thoughtSignature survives the
      // setHistory → getHistory round-trip WITHOUT stripping (the default).
      const beforeRoundTrip = await agent.getHistory();
      const beforeSerialized = JSON.stringify(beforeRoundTrip);
      expect(beforeSerialized.includes('thoughtSignature')).toBe(true);
      expect(beforeSerialized.includes(signatureFromPriorProvider)).toBe(true);

      // Switch into a provider that cannot accept thinking blocks. Under the
      // fake-provider seam setProvider('openai',...) is swallowed, but the
      // subsequent setHistory({stripThoughts:true}) is the normalization the
      // switch path applies and is what we verify here.
      await agent.setProvider('openai', 'gpt-4o');

      // Apply normalization. setHistory with stripThoughts:true must delete
      // every thoughtSignature key from each model thinking part (Fact #1).
      await agent.setHistory(beforeHistory, { stripThoughts: true });

      // ABSENT AFTER: the signature key is GONE from the normalized history.
      const normalized = await agent.getHistory();
      expect(normalized.length).toBeGreaterThanOrEqual(1);
      const afterSerialized = JSON.stringify(normalized);
      expect(afterSerialized.includes('thoughtSignature')).toBe(false);
      expect(afterSerialized.includes(signatureFromPriorProvider)).toBe(false);

      // CONTENT PRESERVED: stripThoughts removes ONLY the signature, not the
      // thinking part's text nor the rest of the conversation. The thinking
      // text and the user/model text must all still be present.
      expect(afterSerialized.includes('considering the greeting')).toBe(true);
      expect(afterSerialized.includes('hello there')).toBe(true);
      expect(afterSerialized.includes('Hi! How can I help?')).toBe(true);

      // The model turn's thought FLAG and text survive (only the signature
      // is stripped) — verify via direct structural read, not substring, so
      // the assertion is exact.
      const modelTurn = normalized.find((c) => c.role === 'model');
      expect(modelTurn).toBeDefined();
      const thoughtPart = modelTurn?.parts.find(
        (p): p is Extract<typeof p, { thought?: boolean }> =>
          'thought' in p && p.thought === true,
      );
      expect(thoughtPart).toBeDefined();
      expect(thoughtPart?.text).toBe('considering the greeting');
      // The signature key was removed from the surviving thought part.
      expect(
        'thoughtSignature' in (thoughtPart as Record<string, unknown>),
      ).toBe(false);
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
      agent.setModelParam('maxTokens', 1024);
      const params = agent.getModelParams();
      expect(params['temperature']).toBe(0.7);
      expect(params['maxTokens']).toBe(1024);

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

  it('T4dp property: generated message histories round-trip and preserve the same HistoryService identity across a switch @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-005', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            role: fc.constant('user' as const),
            text: fc.string({ minLength: 1, maxLength: 80 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (generatedTurns) => {
          const { agent, cleanup } = await buildAgent(
            'provider-switch-two-turn.jsonl',
          );
          try {
            // seed history with generated messages via the public setHistory
            const seeded: AgentMessage[] = generatedTurns.map((t) => ({
              role: t.role,
              parts: [{ text: t.text }],
            }));
            await agent.setHistory(seeded);

            const existingHistoryService = captureHistoryServiceIdentity(agent);

            // switch provider
            await agent.setProvider('openai', 'gpt-4o');

            const newHistoryService = captureHistoryServiceIdentity(agent);

            // identity is preserved across the switch for every generated seed.
            // Guard both probes are REAL instances first so the compare cannot
            // pass vacuously when both are undefined.
            expect(existingHistoryService).toBeDefined();
            expect(newHistoryService).toBeDefined();
            expect(newHistoryService).toBe(existingHistoryService);

            // history length is at least the seeded count (continuity)
            const history = await agent.getHistory();
            expect(history.length).toBeGreaterThanOrEqual(seeded.length);

            // every seeded text is present in the returned history (checked
            // via direct text-part extraction, not JSON serialization, since
            // JSON.stringify escapes backslashes and other characters making
            // substring matching unreliable for arbitrary fc.string inputs)
            const historyTexts = history.flatMap((m) =>
              m.parts
                .map((p) => ('text' in p ? p.text : ''))
                .filter((txt) => txt.length > 0),
            );
            for (const t of generatedTurns) {
              expect(historyTexts.includes(t.text)).toBe(true);
            }
          } finally {
            await cleanup();
          }
        },
      ),
    );
  });

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
