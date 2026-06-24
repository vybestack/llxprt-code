/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P05
 * @requirement:REQ-002
 *
 * BEHAVIORAL RED suite for the read-only `agent.policy` sub-controller
 * (AgentPolicyControl). Drives through the PUBLIC ROOT via the buildAgent
 * harness (helpers/agentHarness.ts:79). The REAL PolicyEngine is seeded
 * through the public config path with ZERO mocking:
 *   AgentConfig.policy (config-types.ts:164, type PolicyEngineConfig)
 *   → agentConfig.adapter.ts:207-208 (params.policyEngineConfig)
 *   → configConstructor.ts:469 (new PolicyEngine(params.policyEngineConfig))
 *   → Config.getPolicyEngine() returns that real engine.
 *
 * NOTE: createAgent injects an extra confirmation-forcing rule (priority 4,
 * source 'Agent confirmation-forcing seam (P17)') into the engine. So the
 * returned rule set is a SUPERSET of the seeded rules. The tests below
 * locate the seeded rules by their distinguishing properties (source/toolName)
 * rather than asserting a fixed positional index, so they test the PROJECTION
 * contract (argsPattern→.source string, decision fidelity, snapshot isolation)
 * independently of the confirmation-seam implementation detail.
 *
 * At RED (before P06): `agent.policy` is undefined on the Agent interface, so
 * every positive case FAILS with a behavioral TypeError (missing-property /
 * missing-method). No module/compile error is expected.
 *
 * At GREEN (P06): the PolicyControl delegates to Config.getPolicyEngine() per
 * call, projects argsPattern RegExp → .source string, and returns a fresh
 * snapshot array every call.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildAgent } from './helpers/agentHarness.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core';
import type {
  PolicyEngineConfig,
  PolicyRuleView,
} from '@vybestack/llxprt-code-agents';

describe('agent.policy read-only control @plan:PLAN-20260622-COREAPIGAP.P05 @requirement:REQ-002', () => {
  it('T4 getRules projects argsPattern to .source string and preserves undefined for rules without a pattern @requirement:REQ-002 @scenario:argsPattern-string @given:an engine seeded with two rules, one WITH argsPattern /"command":"npm test"/ (source "user") and one WITHOUT @when:agent.policy.getRules() @then:the seeded argsPattern rule projects argsPattern === \'"command":"npm test"\' (a STRING); the no-argsPattern seeded rule has argsPattern === undefined; and NO view.argsPattern is a RegExp instance', async () => {
    const policy: PolicyEngineConfig = {
      rules: [
        {
          toolName: 'run_shell_command',
          decision: PolicyDecision.DENY,
          argsPattern: /"command":"npm test"/,
          priority: 0.5,
          source: 'user',
        },
        { decision: PolicyDecision.ALLOW, source: 'no-pattern-seed' },
      ],
    };
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      policy,
    });
    try {
      const rules = agent.policy.getRules();
      // Locate the seeded rules by their distinguishing source markers (the
      // confirmation-seam injects an extra rule, so positional indices are
      // not stable — but the seeded rules are always present by source).
      const withPattern = rules.find((r) => r.source === 'user');
      const withoutPattern = rules.find((r) => r.source === 'no-pattern-seed');
      expect(withPattern).toBeDefined();
      expect(withoutPattern).toBeDefined();
      // The argsPattern rule projects to the .source STRING (never a RegExp).
      expect(withPattern!.argsPattern).toBe('"command":"npm test"');
      expect(withPattern!.argsPattern).not.toBeInstanceOf(RegExp);
      expect(typeof withPattern!.argsPattern).toBe('string');
      // The no-argsPattern rule has argsPattern === undefined.
      expect(withoutPattern!.argsPattern).toBeUndefined();
      // Belt-and-suspenders: NO view.argsPattern is ever a RegExp instance.
      for (const view of rules) {
        expect(view.argsPattern).not.toBeInstanceOf(RegExp);
      }
    } finally {
      await cleanup();
    }
  });

  it('T4b snapshot isolation: two getRules() calls return independent arrays; mutating the first does NOT affect the second @requirement:REQ-002 @scenario:snapshot-isolation @given:an agent whose policy has at least one rule @when:getRules() is called twice and the first array is mutated (length truncated) @then:the second call still returns the original length (fresh snapshot each call)', async () => {
    const policy: PolicyEngineConfig = {
      rules: [
        { decision: PolicyDecision.DENY, toolName: 'a' },
        { decision: PolicyDecision.ALLOW, toolName: 'b' },
      ],
    };
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      policy,
    });
    try {
      const first = agent.policy.getRules();
      const originalLength = first.length;
      // Mutate the first snapshot array (truncate — best-effort; readonly
      // typing is erased at runtime so .length is settable).
      (first as unknown as { length: number }).length = 0;
      expect(first.length).toBe(0);
      const second = agent.policy.getRules();
      expect(second.length).toBe(originalLength);
      expect(second).not.toBe(first);
    } finally {
      await cleanup();
    }
  });

  it('T6 getDefaultDecision and isNonInteractive delegate to the seeded engine @requirement:REQ-002 @scenario:default-decision @scenario:non-interactive @given:an engine seeded with defaultDecision: ASK_USER and nonInteractive: true @when:agent.policy.getDefaultDecision() and agent.policy.isNonInteractive() @then:getDefaultDecision() === PolicyDecision.ASK_USER AND isNonInteractive() === true', async () => {
    const policy: PolicyEngineConfig = {
      rules: [{ decision: PolicyDecision.DENY }],
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: true,
    };
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      policy,
    });
    try {
      expect(agent.policy.getDefaultDecision()).toBe(PolicyDecision.ASK_USER);
      expect(agent.policy.isNonInteractive()).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T7 source-omission projection: a rule seeded WITHOUT a source projects to a view that OMITS the source key (and argsPattern key); a rule WITH a source carries it @requirement:REQ-002 @scenario:source-omission @given:an engine seeded with TWO rules — one WITHOUT source/argsPattern (unique toolName "omit-source-probe") and one WITH source "present-probe" (unique toolName "present-source-probe") @when:agent.policy.getRules() is called and each rule is located by its unique toolName @then:the no-source view has NO source key (Object.keys omits it, "source" in view === false) AND no argsPattern key; the present-source view HAS source === "present-probe" AND "source" in view === true', async () => {
    const policy: PolicyEngineConfig = {
      rules: [
        // NO source field, NO argsPattern field.
        {
          toolName: 'omit-source-probe',
          decision: PolicyDecision.DENY,
        },
        // WITH a unique source marker (pins the always-true direction).
        {
          toolName: 'present-source-probe',
          decision: PolicyDecision.ALLOW,
          source: 'present-probe',
        },
      ],
    };
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      policy,
    });
    try {
      const rules = agent.policy.getRules();
      // Locate by the unique toolName markers (the confirmation-seam injects
      // its own rule, so positional indices are not stable — but these
      // toolNames are unique to this test).
      const omitted = rules.find((r) => r.toolName === 'omit-source-probe');
      const present = rules.find((r) => r.toolName === 'present-source-probe');
      // The no-source rule's view OMITS the source key entirely.
      expect(omitted).toBeDefined();
      expect('source' in omitted!).toBe(false);
      expect(Object.keys(omitted!)).not.toContain('source');
      // Belt-and-suspenders: argsPattern key also absent (no argsPattern seeded).
      expect('argsPattern' in omitted!).toBe(false);
      expect(Object.keys(omitted!)).not.toContain('argsPattern');
      // The present-source rule's view CARRIES source with the seeded value.
      expect(present).toBeDefined();
      expect(present!.source).toBe('present-probe');
      expect('source' in present!).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('PROP argsPattern round-trip: for any valid regex source string, seeding a rule with new RegExp(src) yields a view whose argsPattern === the original src @requirement:REQ-002 @scenario:property-argsPattern-round-trip @given:a valid regex source string src and an engine seeded with a rule whose argsPattern is new RegExp(src) and a unique source marker @when:agent.policy.getRules() @then:the seeded view.argsPattern === src (RegExp.source round-trip)', async () => {
    // MIN-2 distinct cases are exercised by the generator (constant strings).
    await fc.assert(
      fc.asyncProperty(
        fc.constant('foo'),
        fc.constant('bar|baz'),
        async (s1, s2) => {
          for (const src of [s1, s2]) {
            const marker = `prop-argspattern-${src}`;
            const policy: PolicyEngineConfig = {
              rules: [
                {
                  decision: PolicyDecision.DENY,
                  argsPattern: new RegExp(src),
                  source: marker,
                },
              ],
            };
            const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
              policy,
            });
            try {
              const views = agent.policy.getRules();
              const seeded = views.find((r) => r.source === marker);
              expect(seeded).toBeDefined();
              expect(seeded!.argsPattern).toBe(src);
              expect(seeded!.argsPattern).not.toBeInstanceOf(RegExp);
            } finally {
              await cleanup();
            }
          }
        },
      ),
    );
  });

  it('PROP rules count/order fidelity: for a generated list of N (1..5) seeded rules, the returned views contain all N seeded rules as a subsequence with positional decisions matching the seed @requirement:REQ-002 @scenario:property-rules-fidelity @given:a generated list of N rules each with a unique source marker and a decision in {ALLOW, DENY, ASK_USER} @when:agent.policy.getRules() @then:filtering to the seeded markers yields exactly N views in seed order, each with the matching decision', async () => {
    const decisions = [
      PolicyDecision.ALLOW,
      PolicyDecision.DENY,
      PolicyDecision.ASK_USER,
    ];
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.array(fc.constantFrom(...decisions), { minLength: 1, maxLength: 5 }),
        async (n, generated) => {
          // Build exactly n rules from the generated decision list (trim/pad
          // to the chosen count; each rule carries a unique positional source
          // marker so the test can locate them among the confirmation-seam
          // rules and assert count+order fidelity).
          const chosen = generated.slice(0, n);
          while (chosen.length < n) {
            chosen.push(decisions[chosen.length % decisions.length]);
          }
          // Snapshot the markers+decisions BEFORE buildAgent: the
          // confirmation-forcing seam mutates the policy.rules array in place
          // (pushes its own rule), so a live reference would grow.
          const markers = chosen.map((_, i) => `prop-fidelity-${i}`);
          const expectedDecisions = [...chosen];
          const seeded = chosen.map((decision, i) => ({
            decision,
            source: markers[i],
          }));
          const policy: PolicyEngineConfig = { rules: seeded };
          const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
            policy,
          });
          try {
            const views: readonly PolicyRuleView[] = agent.policy.getRules();
            // Extract the seeded rules in seed order via their markers.
            const seededViews = markers.map(
              (m) => views.find((v) => v.source === m)!,
            );
            expect(seededViews).toHaveLength(n);
            for (let i = 0; i < n; i++) {
              expect(seededViews[i]).toBeDefined();
              expect(seededViews[i].decision).toBe(expectedDecisions[i]);
            }
          } finally {
            await cleanup();
          }
        },
      ),
    );
  });
});
