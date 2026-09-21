/**
 * @requirement:REQ-006
 * @plan:PLAN-20260629-ISSUE2285.P05
 *
 * RUNTIME non-breaking export guard for the AgentClientContract promotion.
 *
 * This `.test.ts` file IS run by the test runner and MUST stay GREEN both now (pre-P16,
 * contract not yet promoted) and after P16 (contract promoted as `export type`).
 * It carries ALL runtime assertions for P15; the companion
 * `contractPromotion.types.ts` holds compile-only type assertions.
 */

import { describe, expect, it } from 'bun:test';

import * as root from '@vybestack/llxprt-code-agents';

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
      expect(rootKeys.has(key)).toBe(true);
    }
  });

  it('Test B (REQ-004.1, issue #3222): root denies the concrete AgentClient class — the retired internals subpath is gone', () => {
    // The concrete AgentClient class must NOT surface on the root barrel:
    // consumers construct clients through the public createAgentClient
    // factory. The low-level subpath that used to carry the class is retired
    // (issue #3222), so the root deny is now the whole contract.
    expect(root.AgentClient).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(root, 'AgentClient')).toBe(
      false,
    );
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
