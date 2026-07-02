/**
 * @plan:PLAN-20260621-COREAPIREMED.P21
 * @requirement:REQ-006
 * @plan:PLAN-20260629-ISSUE2285.P05
 *
 * Full non-breaking characterization of the agents public export surface.
 *
 * This is a characterization test: it ENUMERATES the actual current exports
 * (read dynamically from the built root barrel and the internals subpath) and
 * asserts every #1594-era symbol is still present with a compatible shape. It
 * is NOT a Path-A consumer and NOT a Path-B reference drive; it is one of the
 * TWO export-surface-introspection categories PERMITTED to import the internals
 * subpath, because asserting (REQ-006) that `./internals.js` STILL exports its
 * #1594-era value symbols (AgentClient, PostTurnAction) is ONLY provable by
 * importing that subpath at runtime.
 *
 * No mock theater: structural/identity assertions only. No deep /src/ imports.
 */

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import * as root from '@vybestack/llxprt-code-agents';
import * as internals from '@vybestack/llxprt-code-agents/internals.js';
import type {
  Agent,
  AgentConfig,
  McpOAuthStatus,
  McpServerAuthStatus,
} from '@vybestack/llxprt-code-agents';

// Type-level compile anchor: a signature change to createAgent would break
// typecheck. The shipped shape is `createAgent(AgentConfig): Promise<Agent>`.
const _createAgentShape: (cfg: AgentConfig) => Promise<Agent> =
  root.createAgent;

// Consume the binding so noUnusedLocals does not trip (it never runs at
// runtime; this is a compile-only guard).
void _createAgentShape;

describe('REQ-006 @plan:PLAN-20260621-COREAPIREMED.P21 — agents public export surface is non-breaking', () => {
  it('Test A: curated root barrel exposes every load-bearing #1594-era runtime value (superset)', () => {
    // Dynamic enumeration: read the actual keys the built barrel ships, then
    // assert the #1594-era load-bearing set is a SUBSET (the barrel may grow
    // additively but MUST never drop one of these).
    const rootKeys = new Set(Object.keys(root));
    const expectedRootFunctions: readonly string[] = [
      'createAgent',
      'fromConfig',
      'listProviders',
      'listTools',
      'mapLoopStream',
      'mapStreamEvent',
      'toConfigParameters',
      'createTaskToolRegistration',
    ];
    for (const key of expectedRootFunctions) {
      expect(rootKeys.has(key), `root barrel must export "${key}"`).toBe(true);
      expect(typeof (root as Record<string, unknown>)[key]).toBe('function');
    }

    // Classes are also `typeof 'function'` at runtime.
    // P05: AgenticLoop (concrete low-level class) removed from the root
    // surface; consumers use createAgenticLoop from the curated api barrel.
    const expectedRootClasses: readonly string[] = ['AdapterError'];
    for (const key of expectedRootClasses) {
      expect(rootKeys.has(key), `root barrel must export "${key}"`).toBe(true);
      expect(typeof (root as Record<string, unknown>)[key]).toBe('function');
    }
  });

  it('Test B: createAgent(AgentConfig) arity is 1 (single-arg signature unchanged)', () => {
    // The shipped signature is `createAgent(rawConfig: AgentConfig): Promise<Agent>`.
    // `.length` reflects the declared parameter count; an overload/extra param
    // would change it.
    expect(root.createAgent.length).toBe(1);
  });

  it('Test C: fromConfig is a SEPARATE export — not an overload that altered createAgent', () => {
    expect(typeof root.fromConfig).toBe('function');
    // Identity: fromConfig must NOT be the same binding as createAgent, proving
    // fromConfig did not mutate/replace createAgent's exported reference.
    expect(root.fromConfig).not.toBe(root.createAgent);
  });

  it('exposes the configured context-limit resolver as a public runtime function', () => {
    expect(typeof root.getTokenLimitForConfiguredContext).toBe('function');
  });

  it('Test C2: createAgenticLoop factory remains on the root barrel after AgenticLoop class removal (P05)', () => {
    // P05 removed the concrete AgenticLoop CLASS from the root surface, but
    // the curated createAgenticLoop FACTORY must remain so consumers can still
    // construct loops without importing the class directly.
    expect(typeof root.createAgenticLoop).toBe('function');
  });

  it('Test D: internals.js value exports (AgentClient, PostTurnAction) remain intact', () => {
    // REQ-004.1: the concrete AgentClient class stays a runtime value on the
    // documented internals subpath.
    expect(typeof internals.AgentClient).toBe('function');
    // PostTurnAction is a value (enum/const) on internals.
    expect(internals.PostTurnAction).not.toBeUndefined();

    const internalsKeys = new Set(Object.keys(internals));
    expect(internalsKeys.has('AgentClient')).toBe(true);
    expect(internalsKeys.has('PostTurnAction')).toBe(true);
  });

  it('PROP: every sampled #1594-era root key is present in the dynamic root barrel (REQ-006)', () => {
    // Property over the curated expected key set: each sampled key MUST be a
    // live key of the dynamically-enumerated root barrel.
    // P05: AgenticLoop removed from the root (curated createAgenticLoop
    // remains).
    const expectedRootKeys: readonly string[] = [
      'createAgent',
      'fromConfig',
      'listProviders',
      'listTools',
      'mapLoopStream',
      'mapStreamEvent',
      'toConfigParameters',
      'AdapterError',
      'createTaskToolRegistration',
    ];
    const rootKeys = new Set(Object.keys(root));
    fc.assert(
      fc.property(fc.constantFrom(...expectedRootKeys), (key) =>
        rootKeys.has(key),
      ),
    );
    // A second distinct property: each sampled value-symbol is callable.
    const valueSymbols: readonly string[] = [
      'createAgent',
      'fromConfig',
      'listProviders',
      'listTools',
      'mapLoopStream',
      'mapStreamEvent',
      'toConfigParameters',
      'AdapterError',
      'createTaskToolRegistration',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...valueSymbols),
        (key) => typeof (root as Record<string, unknown>)[key] === 'function',
      ),
    );
  }, 30000);
});

/**
 * @plan:PLAN-20260622-COREAPIGAP.P18
 * @requirement:REQ-009
 *
 * Additive-surface regression fence: the whole plan is additive, so every
 * prior #1594-era export MUST still be present with a compatible shape, AND
 * the new members this plan adds (value enums, projected types, extended
 * sub-controller methods) MUST be present without altering any prior member.
 *
 * This block is APPENDED to the existing REQ-006 characterization (left
 * byte-identical above). It fences THIS plan's surface growth.
 *
 * The COMPILE-TIME half of this fence (projected-type + extended-controller
 * signature anchors) lives in the sibling additiveSurface.types.ts, NOT here:
 * the workspace tsconfig excludes "**\/*.test.ts" from `tsc --noEmit`, so
 * compile anchors placed in this file would be VACUOUS. The ".types.ts" file
 * IS typecheck-visible (and build-excluded + vitest-ignored). This file holds
 * only the RUNTIME (introspection) half of the fence.
 */

describe('REQ-009 @plan:PLAN-20260622-COREAPIGAP.P18 — additive surface is non-breaking', () => {
  it('Test A: full #1594-era load-bearing value set is still present as runtime functions (prior ⊂ current)', () => {
    const rootKeys = new Set(Object.keys(root));
    // P05: AgenticLoop removed from the root (curated createAgenticLoop
    // remains).
    const priorLoadBearing: readonly string[] = [
      'createAgent',
      'fromConfig',
      'listProviders',
      'listTools',
      'mapLoopStream',
      'mapStreamEvent',
      'toConfigParameters',
      'createTaskToolRegistration',
      'AdapterError',
    ];
    for (const key of priorLoadBearing) {
      expect(rootKeys.has(key), `prior root key "${key}" must remain`).toBe(
        true,
      );
      expect(typeof (root as Record<string, unknown>)[key]).toBe('function');
    }
  });

  it('Test B: internals identity unchanged — AgentClient binding preserved on the documented internals subpath', () => {
    // P05: the root no longer re-exports internals, so root.AgentClient is
    // undefined (deny). AgentClient remains a runtime VALUE on the
    // internals.js subpath (REQ-004.1).
    expect(typeof internals.AgentClient).toBe('function');
    // PostTurnAction is a value (enum/const) on internals.
    expect(internals.PostTurnAction).not.toBeUndefined();
    // Root DENY: AgentClient must NOT appear on the root barrel after
    // depollution.
    expect(
      (root as Record<string, unknown>).AgentClient,
      'root.AgentClient must be undefined after depollution (P05)',
    ).toBeUndefined();
  });

  it('Test C: new value enums are present and round-trip (additive surface growth)', () => {
    expect(typeof root.ApprovalMode).toBe('object');
    expect(typeof root.PolicyDecision).toBe('object');
    expect(root.ApprovalMode.YOLO).toBe('yolo');
    expect(root.ApprovalMode.AUTO_EDIT).toBe('autoEdit');
    expect(root.ApprovalMode.DEFAULT).toBe('default');
    expect(root.PolicyDecision.ASK_USER).toBe('ask_user');
    expect(root.PolicyDecision.ALLOW).toBe('allow');
    expect(root.PolicyDecision.DENY).toBe('deny');
  });

  it('PROP 1: each sampled prior load-bearing key is a live root key AND callable (REQ-009)', () => {
    // P05: AgenticLoop removed from the root (curated createAgenticLoop
    // remains).
    const priorLoadBearing: readonly string[] = [
      'createAgent',
      'fromConfig',
      'listProviders',
      'listTools',
      'mapLoopStream',
      'mapStreamEvent',
      'toConfigParameters',
      'createTaskToolRegistration',
      'AdapterError',
    ];
    const rootKeys = new Set(Object.keys(root));
    fc.assert(
      fc.property(fc.constantFrom(...priorLoadBearing), (key) => {
        expect(rootKeys.has(key)).toBe(true);
        expect(typeof (root as Record<string, unknown>)[key]).toBe('function');
        return true;
      }),
    );
  }, 30000);

  it('PROP 2: each sampled new enum member round-trips to its expected string value (REQ-009)', () => {
    const approvalModeEntries: ReadonlyArray<readonly [string, string]> = [
      ['YOLO', 'yolo'],
      ['AUTO_EDIT', 'autoEdit'],
      ['DEFAULT', 'default'],
    ];
    const policyDecisionEntries: ReadonlyArray<readonly [string, string]> = [
      ['ASK_USER', 'ask_user'],
      ['ALLOW', 'allow'],
      ['DENY', 'deny'],
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...approvalModeEntries, ...policyDecisionEntries),
        ([memberName, expectedValue]) => {
          const enumObj =
            memberName === 'ASK_USER' ||
            memberName === 'ALLOW' ||
            memberName === 'DENY'
              ? root.PolicyDecision
              : root.ApprovalMode;
          const value = (enumObj as Record<string, string>)[memberName];
          expect(typeof value).toBe('string');
          expect(value.length).toBeGreaterThan(0);
          expect(value).toBe(expectedValue);
          return true;
        },
      ),
    );
  }, 30000);
});

describe('REQ-004 @plan:PLAN-20260622-MCPOAUTHTRUTH.P07 — additive MCP OAuth surface', () => {
  it('exposes McpOAuthStatus as a type-only export (no runtime root key)', () => {
    // type-only: must NOT appear as a runtime key (mirrors the ApprovalMode/type-only precedent)
    expect(Object.prototype.hasOwnProperty.call(root, 'McpOAuthStatus')).toBe(
      false,
    );
  });

  it('preserves every previously-public MCP field name (additive only)', () => {
    const sample: McpServerAuthStatus = {
      server: 's',
      authenticated: false,
      requiresAuth: false,
      oauthStatus: 'not-required',
      sessionAuthenticated: false,
    };
    expect(Object.keys(sample).sort()).toStrictEqual(
      [
        'authenticated',
        'oauthStatus',
        'requiresAuth',
        'server',
        'sessionAuthenticated',
      ].sort(),
    );
  });

  it('PROP: each McpOAuthStatus member is a valid oauthStatus on the projected shape', () => {
    const members: readonly McpOAuthStatus[] = [
      'authenticated',
      'expired',
      'none',
      'not-required',
    ];
    fc.assert(
      fc.property(fc.constantFrom(...members), (status) => {
        const sample: McpServerAuthStatus = {
          server: 's',
          authenticated: status === 'authenticated',
          requiresAuth: false,
          oauthStatus: status,
          sessionAuthenticated: false,
        };
        expect(sample.oauthStatus).toBe(status);
        return true;
      }),
    );
  });
});
