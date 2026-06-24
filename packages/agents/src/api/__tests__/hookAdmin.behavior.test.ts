/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P09
 * @requirement:REQ-004
 *
 * BEHAVIORAL RED suite for the hooks-administration methods on
 * `agent.hooks` (AgentHookControl): listHooks / getDisabledHooks /
 * setDisabledHooks / enable / disable. Drives through the PUBLIC ROOT via
 * the buildAgent harness (helpers/agentHarness.ts:79) for the disabled-set
 * round-trip + undefined-safe listHooks cases, and through the BLESSED
 * direct-construction precedent (new HookControl(realDeps)) for the populated
 * listHooks case (the buildAgent harness provably cannot enable hooks —
 * see plan/09 for the proof).
 *
 * At RED (before P10): the five admin methods do not exist on AgentHookControl,
 * so every positive assertion FAILS with a behavioral TypeError
 * (missing-method). At GREEN (P10) the HookControl delegates to the REAL
 * Config hook system / disabled-set per call (no caching) and the SAME
 * assertions pass with no rewrite.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildAgent } from './helpers/agentHarness.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { HookEventName } from '@vybestack/llxprt-code-core/hooks/types.js';
import { HookControl } from '../control/hooks.js';

describe('agent.hooks hooks-administration control @plan:PLAN-20260622-COREAPIGAP.P09 @requirement:REQ-004', () => {
  it('T11 disabled-set round-trip + fresh-copy: setDisabledHooks(["a","b"]) then getDisabledHooks() deep-equals ["a","b"]; mutating the returned array does NOT change a subsequent read @requirement:REQ-004 @scenario:round-trip-fresh-copy @given:a real agent via buildAgent with hooks disabled @when:agent.hooks.setDisabledHooks(["a","b"]) then getDisabledHooks() @then:the result deep-equals ["a","b"] AND mutating the returned array then re-reading yields the original ["a","b"]', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      agent.hooks.setDisabledHooks(['a', 'b']);
      const first = agent.hooks.getDisabledHooks();
      expect(first).toStrictEqual(['a', 'b']);
      // Mutate the returned array — must NOT leak into engine state.
      (first as string[]).push('MUTATED');
      (first as string[]).sort();
      const second = agent.hooks.getDisabledHooks();
      expect(second).toStrictEqual(['a', 'b']);
    } finally {
      await cleanup();
    }
  });

  it('T11b enable/disable idempotency: from ["a"], disable("a") stays ["a"]; disable("b") -> ["a","b"]; enable("a") -> ["b"]; enable("zzz") unchanged @requirement:REQ-004 @scenario:idempotent-enable-disable @given:a real agent with disabled set to ["a"] @when:disable/enable are called idempotently @then:disable("a") stays ["a"]; disable("b") -> ["a","b"]; enable("a") -> ["b"]; enable("zzz") leaves ["b"]', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      agent.hooks.setDisabledHooks(['a']);
      // disable("a") is idempotent — already present, stays ["a"].
      agent.hooks.disable('a');
      expect(agent.hooks.getDisabledHooks()).toStrictEqual(['a']);
      // disable("b") adds -> ["a","b"].
      agent.hooks.disable('b');
      expect(agent.hooks.getDisabledHooks()).toStrictEqual(['a', 'b']);
      // enable("a") removes -> ["b"].
      agent.hooks.enable('a');
      expect(agent.hooks.getDisabledHooks()).toStrictEqual(['b']);
      // enable("zzz") (absent) is idempotent — unchanged ["b"].
      agent.hooks.enable('zzz');
      expect(agent.hooks.getDisabledHooks()).toStrictEqual(['b']);
    } finally {
      await cleanup();
    }
  });

  it('T12a undefined-safe listHooks: a plain agent (hooks disabled) -> agent.hooks.listHooks() === [] and does not throw @requirement:REQ-004 @scenario:undefined-safe-listHooks @given:a real agent via buildAgent with hooks disabled (getHookSystem() returns undefined) @when:agent.hooks.listHooks() is called @then:the result is an empty array []', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // The harness agent has enableHooks=false -> getHookSystem() is undefined.
      expect(agent.getConfig().getHookSystem()).toBeUndefined();
      const list = agent.hooks.listHooks();
      expect(list).toStrictEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('T12b populated listHooks mirrors a real seeded registry entry: name/eventName/enabled reflect the seeded hook @requirement:REQ-004 @scenario:populated-listHooks @given:a REAL Config with enableHooks:true + one seeded SessionStart command hook, registry initialized via system.initialize() @when:HookControl.listHooks() is called @then:list length >= 1 and the entry name === "fake-session-start", eventName === HookEventName.SessionStart, enabled === true', async () => {
    const config = new Config({
      cwd: '/tmp',
      targetDir: '/tmp',
      debugMode: false,
      sessionId: 'hooks-admin-test',
      model: 'gemini-2.0-flash',
      usageStatisticsEnabled: false,
      enableHooks: true,
      hooks: {
        [HookEventName.SessionStart]: [
          {
            hooks: [
              {
                type: 'command' as never,
                command: 'true',
                name: 'fake-session-start',
              },
            ],
          },
        ],
      },
    });
    // Defensive guard (NOT a non-null `!` assertion on the value): the seeded
    // config has enableHooks:true so the system is present, but assert anyway
    // so a future regression fails clearly rather than passing silently.
    const system = config.getHookSystem();
    expect(system).toBeDefined();
    await system!.initialize();
    const control = new HookControl({
      config,
      messageBus: new MessageBus(),
      sessionId: () => 'hooks-admin-test',
      cwd: () => '/tmp',
    });
    const list = control.listHooks();
    expect(list.length).toBeGreaterThanOrEqual(1);
    const entry = list.find((h) => h.name === 'fake-session-start');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('fake-session-start');
    expect(entry!.eventName).toBe(HookEventName.SessionStart);
    expect(entry!.enabled).toBe(true);
  });

  it('PROP disabled-set round-trip: for a generated unique string[] (len 0..5), setDisabledHooks(arr) then getDisabledHooks() deep-equals arr @requirement:REQ-004 @scenario:property-round-trip @given:a real agent and a generated unique string[] of length 0..5 @when:setDisabledHooks(arr) then getDisabledHooks() @then:the result deep-equals arr (R-HOOKS-ROUNDTRIP); MIN-2 distinct cases exercised by the generator', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.string({ minLength: 1 }).filter((s) => !s.includes(' ')), {
          minLength: 0,
          maxLength: 5,
        }),
        async (arr) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            agent.hooks.setDisabledHooks(arr);
            const got = agent.hooks.getDisabledHooks();
            expect([...got]).toStrictEqual([...arr]);
          } finally {
            await cleanup();
          }
        },
      ),
    );
  });

  it('PROP enable∘disable inverse: for a generated name + base set, disable(name) then enable(name) yields a set WITHOUT name; returned arrays are always fresh copies @requirement:REQ-004 @scenario:property-enable-disable-inverse @given:a real agent, a generated name, and a base unique string[] not containing the name @when:disable(name) then enable(name) @then:getDisabledHooks() does not contain name AND mutating a returned array does not affect a subsequent read; MIN-2 distinct cases exercised by the generator', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1 })
          .filter((s) => !s.includes(' ') && s !== 'name-prop'),
        fc.uniqueArray(
          fc.string({ minLength: 1 }).filter((s) => !s.includes(' ')),
          { minLength: 0, maxLength: 5 },
        ),
        async (name, base) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            agent.hooks.setDisabledHooks(base);
            agent.hooks.disable(name);
            // After disable, name is present (unless it duplicated a base entry,
            // in which case disable was idempotent — still present once).
            agent.hooks.enable(name);
            const after = agent.hooks.getDisabledHooks();
            // enable removed the name entirely.
            expect([...after]).not.toContain(name);
            // Fresh-copy contract: mutating the returned array is safe.
            (after as string[]).push('FRESH-COPY-PROBE');
            const reread = agent.hooks.getDisabledHooks();
            expect([...reread]).not.toContain('FRESH-COPY-PROBE');
          } finally {
            await cleanup();
          }
        },
      ),
    );
  });
});
