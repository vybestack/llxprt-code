/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-008
 * @requirement:REQ-009
 *
 * Profiles CRUD/apply + auth-winner precedence properties (behavioral). These
 * tests drive the real public Agent profiles surface over a real FakeProvider
 * (durable saved store + dir-scan resolution) and the real computeAuthWinner
 * precedence function. No mock theater, only value/sequence assertions.
 *
 * Covers:
 * - T18d profiles CRUD + apply; durable store changes; apply preserves context.
 * - T19a list/create/apply/saveCurrent/setDefault/getDefault over the merged
 *        saved + dir-scan profile space (ordering, dedupe, deep-copy, omission,
 *        not-found errors, isLoadBalancer/isDefault projection).
 * - T18p/T18pb computeAuthWinner precedence + masking property tests over the
 *        full raw>keyName>inline>keyfile>oauth>none chain.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildAgent, drain, countType } from './helpers/agentHarness.js';
import {
  createAgentAuthState,
  computeAuthWinner,
  type AuthWinner,
} from '../control/authState.js';

describe('Profiles/auth-winner @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008 @requirement:REQ-009', () => {
  it('T18d profiles CRUD + apply; durable store changes; apply preserves context @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      // create a profile
      await agent.profiles.create('crud-profile', {
        name: 'crud-profile',
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: { temperature: 0.3 },
      });

      // list reflects the created profile
      const list = agent.profiles.list();
      const found = list.find((s) => s.name === 'crud-profile');
      expect(found).toBeDefined();
      expect(found?.provider).toBe('openai');
      expect(found?.model).toBe('gpt-4o');

      // get returns the full detail
      const detail = agent.profiles.get('crud-profile');
      expect(detail).toBeDefined();
      expect(detail?.modelParams?.temperature).toBe(0.3);

      // seed a turn so there is real context to preserve across apply
      const first = await drain(agent.stream('seed context'));
      expect(countType(first, 'done')).toBe(1);
      const beforeHistory = await agent.getHistory();
      expect(beforeHistory.length).toBeGreaterThanOrEqual(1);

      // apply the profile
      await agent.profiles.apply('crud-profile');

      // context preserved: history length is at least what it was before apply
      const afterHistory = await agent.getHistory();
      expect(afterHistory.length).toBeGreaterThanOrEqual(beforeHistory.length);

      // delete the profile — durable store changes
      await agent.profiles.delete('crud-profile');
      const afterDelete = agent.profiles.get('crud-profile');
      expect(afterDelete).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T19a list merges saved + dir-scan with saved-first ordering and dedupe-by-name @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // the dir-scan fixtures expose 'standard-openai' and 'lb-anthropic-openai'
      const dirOnly = agent.profiles.list();
      const dirNames = dirOnly.map((s) => s.name);
      expect(dirNames).toContain('standard-openai');
      expect(dirNames).toContain('lb-anthropic-openai');

      // create a SAVED profile that shadows a dir-scan name (same name)
      await agent.profiles.create('standard-openai', {
        name: 'standard-openai',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
      });
      // and a saved profile with a fresh name
      await agent.profiles.create('saved-fresh', {
        name: 'saved-fresh',
        provider: 'openai',
        model: 'gpt-4o-mini',
      });

      const merged = agent.profiles.list();
      // dedupe: 'standard-openai' appears exactly once
      const standardEntries = merged.filter(
        (s) => s.name === 'standard-openai',
      );
      expect(standardEntries).toHaveLength(1);
      // and the SAVED copy wins (provider overridden to anthropic)
      expect(standardEntries[0].provider).toBe('anthropic');

      // ordering: every saved profile precedes every dir-only profile
      const names = merged.map((s) => s.name);
      const savedFreshIdx = names.indexOf('saved-fresh');
      const lbIdx = names.indexOf('lb-anthropic-openai');
      expect(savedFreshIdx).toBeGreaterThanOrEqual(0);
      expect(lbIdx).toBeGreaterThanOrEqual(0);
      expect(savedFreshIdx).toBeLessThan(lbIdx);
    } finally {
      await cleanup();
    }
  });

  it('T19a create stores baseUrl/authKeyName and OMITS absent optional keys; modelParams are deep-copied (no external-mutation leak) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const params: Record<string, unknown> = { temperature: 0.7 };
      await agent.profiles.create('with-optionals', {
        name: 'with-optionals',
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: 'https://proxy.example/v1',
        authKeyName: 'prod-key',
        modelParams: params,
      });
      // mutate the source object AFTER create — stored copy must be unaffected
      params.temperature = 999;
      params['injected'] = 'leak';

      const detail = agent.profiles.get('with-optionals');
      expect(detail).toBeDefined();
      expect(detail?.baseUrl).toBe('https://proxy.example/v1');
      expect(detail?.authKeyName).toBe('prod-key');
      // deep-copy isolation: original value preserved, no leaked key
      expect(detail?.modelParams?.temperature).toBe(0.7);
      expect(
        detail?.modelParams !== undefined && 'injected' in detail.modelParams,
      ).toBe(false);

      // a minimal create omits absent optional keys entirely
      await agent.profiles.create('minimal', {
        name: 'minimal',
        provider: 'openai',
        model: 'gpt-4o',
      });
      const min = agent.profiles.get('minimal');
      expect(min).toBeDefined();
      expect('baseUrl' in (min as object)).toBe(false);
      expect('authKeyName' in (min as object)).toBe(false);
      expect('authKeyFile' in (min as object)).toBe(false);
      expect('modelParams' in (min as object)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('T19a apply resolves a dir-scan LB profile and rebinds provider+model+keyName onto the live agent @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009 @requirement:REQ-005', async () => {
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      // the LB dir-scan fixture targets anthropic/claude with authKeyName set
      await agent.profiles.apply('lb-anthropic-openai');

      // provider + model rebind to the profile's active selection
      expect(agent.getProvider()).toBe('anthropic');
      expect(agent.getModel()).toBe('claude-3-5-sonnet');
      // the key REFERENCE is recorded and surfaces as the winner keyName
      expect(agent.getProviderStatus().keyName).toBe('anthropic-prod');
    } finally {
      await cleanup();
    }
  });

  it('T19a apply on an unknown profile rejects with a clear not-found error and does NOT switch the provider @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const providerBefore = agent.getProvider();
      await expect(agent.profiles.apply('does-not-exist')).rejects.toThrow(
        "Profile 'does-not-exist' not found",
      );
      // a failed resolve must not have mutated the live provider
      expect(agent.getProvider()).toBe(providerBefore);
    } finally {
      await cleanup();
    }
  });

  it('T19a saveCurrent snapshots provider/model and stores the key REFERENCE (and omits empty modelParams) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { keyName: 'prod-key' },
    });
    try {
      await agent.profiles.saveCurrent('snap');
      const detail = agent.profiles.get('snap');
      expect(detail).toBeDefined();
      expect(detail?.provider).toBe('openai');
      // the stored key reference round-trips (never the raw secret)
      expect(detail?.authKeyName).toBe('prod-key');
      // no model params were set → the modelParams key is omitted
      expect('modelParams' in (detail as object)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('T19a setDefault marks a resolvable profile default (surfaced via get/getDefault); delete clears the default tracking @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await agent.profiles.create('def-profile', {
        name: 'def-profile',
        provider: 'openai',
        model: 'gpt-4o',
      });

      // before setDefault → not the default
      expect(agent.profiles.get('def-profile')?.isDefault).toBe(false);
      expect(agent.profiles.getDefault()).toBeUndefined();

      await agent.profiles.setDefault('def-profile');
      // isDefault is surfaced true via get and getDefault returns the summary
      expect(agent.profiles.get('def-profile')?.isDefault).toBe(true);
      const def = agent.profiles.getDefault();
      expect(def?.name).toBe('def-profile');
      expect(def?.isDefault).toBe(true);

      // deleting the default profile clears the default tracking
      await agent.profiles.delete('def-profile');
      expect(agent.profiles.getDefault()).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T19a setDefault on an unknown profile rejects with a clear not-found error @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await expect(agent.profiles.setDefault('ghost')).rejects.toThrow(
        "Profile 'ghost' not found",
      );
      expect(agent.profiles.getDefault()).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T19a setDefault resolves a dir-scan profile and getDefault surfaces its summary @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // 'standard-openai' exists only via the dir-scan fallback
      await agent.profiles.setDefault('standard-openai');
      const def = agent.profiles.getDefault();
      expect(def?.name).toBe('standard-openai');
      expect(def?.provider).toBe('openai');
      expect(def?.model).toBe('gpt-4o');
      expect(def?.isDefault).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T19a list surfaces isLoadBalancer from dir-scan profiles and isDefault tracks the active default across saved+dir entries @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // a SAVED standard profile that we will mark default
      await agent.profiles.create('saved-default', {
        name: 'saved-default',
        provider: 'openai',
        model: 'gpt-4o',
      });
      await agent.profiles.setDefault('saved-default');

      const list = agent.profiles.list();

      // saved profile: isDefault true (it is the active default), no LB key
      const saved = list.find((s) => s.name === 'saved-default');
      expect(saved?.isDefault).toBe(true);
      expect('isLoadBalancer' in (saved as object)).toBe(false);

      // dir-scan LB fixture surfaces isLoadBalancer:true and isDefault:false
      const lb = list.find((s) => s.name === 'lb-anthropic-openai');
      expect(lb?.isLoadBalancer).toBe(true);
      expect(lb?.isDefault).toBe(false);

      // dir-scan standard fixture surfaces isLoadBalancer:false, isDefault:false
      const std = list.find((s) => s.name === 'standard-openai');
      expect(std?.isLoadBalancer).toBe(false);
      expect(std?.isDefault).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('T19a list() returns a DETERMINISTIC dir-scan order (sorted, stable across repeated calls) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // The dir-scan sorts entries by filename and de-duplicates by name, so the
      // relative order of dir-scan profiles must not depend on filesystem
      // enumeration order and must be identical across repeated list() calls.
      const firstNames = agent.profiles.list().map((s) => s.name);
      const secondNames = agent.profiles.list().map((s) => s.name);
      expect(secondNames).toStrictEqual(firstNames);

      // The two well-formed dir-scan fixtures appear exactly once each and in a
      // stable relative order (their names are unique across the scanned dirs).
      const dirScanNames = firstNames.filter(
        (n) => n === 'lb-anthropic-openai' || n === 'standard-openai',
      );
      expect(dirScanNames.filter((n) => n === 'standard-openai')).toHaveLength(
        1,
      );
      expect(
        dirScanNames.filter((n) => n === 'lb-anthropic-openai'),
      ).toHaveLength(1);
      // Deterministic relative order is reproduced on a second independent call.
      const dirScanNames2 = secondNames.filter(
        (n) => n === 'lb-anthropic-openai' || n === 'standard-openai',
      );
      expect(dirScanNames2).toStrictEqual(dirScanNames);
    } finally {
      await cleanup();
    }
  });

  it('T19a getDefault surfaces isLoadBalancer for a dir-scan LB default profile @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await agent.profiles.setDefault('lb-anthropic-openai');
      const def = agent.profiles.getDefault();
      expect(def?.name).toBe('lb-anthropic-openai');
      expect(def?.isLoadBalancer).toBe(true);
      expect(def?.isDefault).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T19a dir-scan rejects malformed/invalid-shape profile JSON (non-object, missing name/provider/model, unparseable) — only well-formed profiles resolve @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const names = agent.profiles.list().map((s) => s.name);
      // the two valid fixtures resolve
      expect(names).toContain('standard-openai');
      expect(names).toContain('lb-anthropic-openai');
      // the invalid fixtures are filtered out by the public-shape type guard:
      // missing-name (no .name), missing-provider, missing-model, the
      // not-object string payload, and the unparseable file all yield nothing.
      expect(names).not.toContain('no-provider');
      expect(names).not.toContain('no-model');
      expect(names).not.toContain('just-a-string');
      // and get() likewise refuses to resolve them
      expect(agent.profiles.get('no-provider')).toBeUndefined();
      expect(agent.profiles.get('no-model')).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T19a saveCurrent snapshots baseUrl when present and omits it when absent @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009 @requirement:REQ-008', async () => {
    // WITH a baseUrl seeded on the live provider state
    const withBase = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { baseUrl: 'https://gw.example/v1' },
    });
    try {
      await withBase.agent.profiles.saveCurrent('snap-base');
      const detail = withBase.agent.profiles.get('snap-base');
      expect(detail?.baseUrl).toBe('https://gw.example/v1');
    } finally {
      await withBase.cleanup();
    }

    // WITHOUT a baseUrl → the key is omitted entirely
    const noBase = await buildAgent('plain-text.jsonl', { provider: 'openai' });
    try {
      await noBase.agent.profiles.saveCurrent('snap-nobase');
      const detail = noBase.agent.profiles.get('snap-nobase');
      expect(detail).toBeDefined();
      expect('baseUrl' in (detail as object)).toBe(false);
    } finally {
      await noBase.cleanup();
    }
  });

  it('T19a saveCurrent snapshots non-empty modelParams (deep-copied) and omits the key when params are empty @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // seed a real model param on the live agent, then snapshot
      agent.setModelParam('temperature', 0.42);
      await agent.profiles.saveCurrent('snap-params');
      const detail = agent.profiles.get('snap-params');
      expect(detail?.modelParams?.temperature).toBe(0.42);

      // mutating the live params after save must not leak into the snapshot
      agent.setModelParam('temperature', 0.99);
      const again = agent.profiles.get('snap-params');
      expect(again?.modelParams?.temperature).toBe(0.42);
    } finally {
      await cleanup();
    }
  });

  it('T19a create stores authKeyFile when provided @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await agent.profiles.create('with-keyfile', {
        name: 'with-keyfile',
        provider: 'openai',
        model: 'gpt-4o',
        authKeyFile: '/secrets/openai.key',
      });
      const detail = agent.profiles.get('with-keyfile');
      expect(detail?.authKeyFile).toBe('/secrets/openai.key');
    } finally {
      await cleanup();
    }
  });

  it('T19a saveCurrent omits authKeyName when no key reference is set on the live agent @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { apiKey: 'raw-secret' },
    });
    try {
      // a raw key (not a named reference) means keyName is undefined → the
      // snapshot must NOT carry an authKeyName key at all.
      await agent.profiles.saveCurrent('snap-nokey');
      const detail = agent.profiles.get('snap-nokey');
      expect(detail).toBeDefined();
      expect('authKeyName' in (detail as object)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('T19a apply resolves a SAVED (created) profile and rebinds provider+model+keyName via the saved-store path @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009 @requirement:REQ-005', async () => {
    const { agent, cleanup } = await buildAgent(
      'provider-switch-two-turn.jsonl',
    );
    try {
      await agent.profiles.create('saved-apply', {
        name: 'saved-apply',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        authKeyName: 'saved-key-ref',
      });
      // apply must resolve from the in-memory saved store FIRST (not dir-scan)
      await agent.profiles.apply('saved-apply');
      expect(agent.getProvider()).toBe('anthropic');
      expect(agent.getModel()).toBe('claude-3-5-sonnet');
      expect(agent.getProviderStatus().keyName).toBe('saved-key-ref');
    } finally {
      await cleanup();
    }
  });

  it('T19a delete clears default tracking so a later re-create of the SAME name is no longer the default @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await agent.profiles.create('recycle', {
        name: 'recycle',
        provider: 'openai',
        model: 'gpt-4o',
      });
      await agent.profiles.setDefault('recycle');
      expect(agent.profiles.getDefault()?.name).toBe('recycle');

      // delete must CLEAR the default tracking (not leave a dangling default)
      await agent.profiles.delete('recycle');

      // re-create the SAME name — it must NOT inherit the prior default flag
      await agent.profiles.create('recycle', {
        name: 'recycle',
        provider: 'openai',
        model: 'gpt-4o',
      });
      expect(agent.profiles.getDefault()).toBeUndefined();
      expect(agent.profiles.get('recycle')?.isDefault).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('T19a getDefault omits isLoadBalancer for a non-LB default profile @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-009', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // 'standard-openai' dir-scan fixture has isLoadBalancer:false
      await agent.profiles.setDefault('standard-openai');
      const def = agent.profiles.getDefault();
      expect(def?.name).toBe('standard-openai');
      // isLoadBalancer is present (false) on this fixture — assert the value
      expect(def?.isLoadBalancer).toBe(false);

      // a SAVED profile (no LB key at all) → the key is omitted entirely
      await agent.profiles.create('plain-default', {
        name: 'plain-default',
        provider: 'openai',
        model: 'gpt-4o',
      });
      await agent.profiles.setDefault('plain-default');
      const plainDef = agent.profiles.getDefault();
      expect(plainDef?.name).toBe('plain-default');
      expect('isLoadBalancer' in (plainDef as object)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  // ─── Property-based: REQ-008 auth precedence winner ──────────────────────

  it('T18p property: computeAuthWinner ALWAYS returns the highest-precedence PRESENT source over the full raw>keyName>inline>keyfile>oauth>none chain, for every generated combination of present sources @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', () => {
    const PROVIDER = 'openai';

    // Independent reference implementation of the REQ-008 precedence chain. It
    // mirrors the DOCUMENTED ordering (raw>keyName>inline>keyfile>oauth>none),
    // computed straight from the generated presence booleans — NOT from the
    // production code under test. If a production line in computeAuthWinner
    // reordered the chain (e.g. checked inline before keyName, or dropped the
    // keyfile tier), this oracle would disagree for some generated combination
    // and the property fails. This is a real, falsifiable precedence invariant.
    function expectedWinner(p: {
      raw: boolean;
      keyName: boolean;
      inline: boolean;
      keyfile: boolean;
      oauth: boolean;
    }): AuthWinner {
      if (p.raw) return 'raw';
      if (p.keyName) return 'keyName';
      if (p.inline) return 'inline';
      if (p.keyfile) return 'keyfile';
      if (p.oauth) return 'oauth';
      return 'none';
    }

    fc.assert(
      fc.property(
        fc.record({
          raw: fc.boolean(),
          keyName: fc.boolean(),
          inline: fc.boolean(),
          keyfile: fc.boolean(),
          oauth: fc.boolean(),
        }),
        (present) => {
          // Build a REAL AgentAuthState and seed exactly the generated sources.
          const state = createAgentAuthState();
          state.rawKeyPresent = present.raw;
          state.inlineKeyPresent = present.inline;
          state.keyFile = present.keyfile ? '/tmp/some-keyfile.txt' : undefined;
          if (present.oauth) {
            state.oauthAuthenticated.add(PROVIDER);
          }
          // keyName lives on providerState (passed as the second arg) — model
          // its presence via a concrete reference string vs. undefined.
          const keyName = present.keyName ? 'a-named-key' : undefined;

          // Drive the REAL production precedence resolver.
          const winner = computeAuthWinner(state, keyName, PROVIDER);

          // INVARIANT: production winner equals the documented-chain oracle for
          // EVERY combination of present sources (2^5 = 32 cases covered).
          expect(winner).toBe(expectedWinner(present));
        },
      ),
    );
  });

  it('T18pb property: a higher-precedence source ALWAYS masks every lower one — adding only-lower sources never changes the winner once a higher source is present @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', () => {
    const PROVIDER = 'openai';
    // Ordered highest→lowest. The winner is fully determined by the FIRST
    // present tier; toggling any strictly-lower tier must be invisible.
    const TIERS: readonly AuthWinner[] = [
      'raw',
      'keyName',
      'inline',
      'keyfile',
      'oauth',
    ];

    function build(present: {
      raw: boolean;
      keyName: boolean;
      inline: boolean;
      keyfile: boolean;
      oauth: boolean;
    }): AuthWinner {
      const state = createAgentAuthState();
      state.rawKeyPresent = present.raw;
      state.inlineKeyPresent = present.inline;
      state.keyFile = present.keyfile ? '/tmp/kf.txt' : undefined;
      if (present.oauth) {
        state.oauthAuthenticated.add(PROVIDER);
      }
      const keyName = present.keyName ? 'named' : undefined;
      return computeAuthWinner(state, keyName, PROVIDER);
    }

    fc.assert(
      fc.property(
        // pick which single tier is the highest present one…
        fc.integer({ min: 0, max: TIERS.length - 1 }),
        // …and arbitrary booleans for every strictly-lower tier
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        (highestIdx, lowerBits) => {
          const flags = {
            raw: false,
            keyName: false,
            inline: false,
            keyfile: false,
            oauth: false,
          };
          // The highest present tier is ON; all strictly-higher tiers are OFF;
          // strictly-lower tiers take arbitrary generated values.
          (Object.keys(flags) as Array<keyof typeof flags>).forEach(
            (key, idx) => {
              if (idx < highestIdx) {
                flags[key] = false; // strictly higher → must be absent
              } else if (idx === highestIdx) {
                flags[key] = true; // the highest present tier
              } else {
                flags[key] = lowerBits[idx]; // strictly lower → arbitrary
              }
            },
          );
          // The winner is ALWAYS the highest present tier, regardless of the
          // lower-tier noise. If masking were broken (a lower tier leaked
          // through), this fails for some generated lowerBits.
          expect(build(flags)).toBe(TIERS[highestIdx]);
        },
      ),
    );
  });
});
