/**
 * @requirement:REQ-006
 *
 * RUNTIME non-breaking export guard for the AgentClientContract promotion.
 *
 * This `.test.ts` file IS run by vitest and MUST stay GREEN both now (pre-P16,
 * contract not yet promoted) and after P16 (contract promoted as `export type`).
 * It carries ALL runtime assertions for P15; the companion
 * `contractPromotion.types.ts` holds compile-only type assertions.
 */

import { describe, expect, it } from 'vitest';

import * as root from '@vybestack/llxprt-code-agents';
import * as internals from '@vybestack/llxprt-code-agents/internals.js';

describe('REQ-006: agents public export surface is non-breaking', () => {
  it('Test A: curated root barrel exposes the expected public value exports', () => {
    // The pre-existing curated public root exports. Each MUST remain a runtime
    // key of the root barrel (a subset assertion — the barrel may grow, never
    // shrink). Live build confirms 125 root keys including all of these.
    const expectedRootKeys = [
      'createAgent',
      'fromConfig',
      'listProviders',
      'listTools',
      'mapLoopStream',
      'mapStreamEvent',
      'toConfigParameters',
      'AdapterError',
    ];
    const rootKeys = new Set(Object.keys(root));
    for (const key of expectedRootKeys) {
      expect(rootKeys.has(key), `root barrel must export "${key}"`).toBe(true);
    }
  });

  it('Test B: internals.js value exports (AgentClient, PostTurnAction) remain intact', () => {
    // REQ-004.1: the concrete AgentClient class stays on the internals subpath.
    expect(typeof internals.AgentClient).toBe('function');
    // IDENTITY check: the root's AgentClient must be the SAME binding that lives
    // on ./internals.js (the package root reaches it via `export * from
    // './internals.js'`), NOT a separate value newly added to the curated api
    // barrel. This proves the class stays sourced from internals (REQ-004.1).
    expect(root.AgentClient).toBe(internals.AgentClient);
    // PostTurnAction is a value (enum/const) re-exported from internals.
    expect(
      Object.prototype.hasOwnProperty.call(internals, 'PostTurnAction'),
      'internals must export PostTurnAction',
    ).toBe(true);
  });

  it('Test C (REQ-004.2): curated barrel adds NO runtime value named AgentClientContract', () => {
    // The contract is promoted TYPE-ONLY. A runtime value of the same name must
    // NOT appear on the curated barrel, both now and after P16's `export type`.
    expect(
      Object.prototype.hasOwnProperty.call(root, 'AgentClientContract'),
    ).toBe(false);
  });

  it('Test D (REQ-004): curated barrel adds NO runtime value named McpOAuthStatus', () => {
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P07
    // McpOAuthStatus is a type-only union re-export; it must NOT surface as a
    // runtime key on the root barrel (mirrors the AgentClientContract precedent).
    expect(Object.prototype.hasOwnProperty.call(root, 'McpOAuthStatus')).toBe(
      false,
    );
  });
});
