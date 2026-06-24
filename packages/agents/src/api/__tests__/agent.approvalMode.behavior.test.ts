/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P03
 * @requirement:REQ-001
 *
 * BEHAVIORAL RED suite for Agent.getApprovalMode() / Agent.setApprovalMode().
 *
 * REQ-001 requires the Agent interface to expose
 *   getApprovalMode(): ApprovalMode
 *   setApprovalMode(mode: ApprovalMode): void
 * as top-level methods that delegate DIRECTLY to the bound Config
 * (Config.getApprovalMode at configBaseCore.ts:463; Config.setApprovalMode at
 * config.ts:401, whose untrusted-folder guard throws at config.ts:404).
 *
 * This suite drives the behavior ENTIRELY through the PUBLIC ROOT
 * @vybestack/llxprt-code-agents via the buildAgent harness — NO deep imports,
 * NO mocking. The two blessed real seams make every case drivable with no
 * mock theater:
 *   - configOverrides.approvalMode → adapter.ts:204-205 → params.approvalMode
 *     → Config.getApprovalMode() returns it (T1 setup).
 *   - configOverrides.folderTrust:false → adapter.ts:210-212 →
 *     params.trustedFolder=false → Config.isTrustedFolder() returns false →
 *     the REAL untrusted-folder throw fires from Config.setApprovalMode
 *     (config.ts:402-405) (T2 / untrusted PROP). This is the production throw
 *     path driven through the public API — NOT a spy.
 *
 * ApprovalMode is imported as a VALUE from the bare core barrel
 * @vybestack/llxprt-code-core (no trailing slash). It is NOT yet importable as
 * a value from the agents root (type-only there until Phase 17 REQ-008
 * barrel-promotion). This .behavior.test.ts is T17-EXEMPT (the boundary scan
 * only governs *.spec.ts), so this temporary sourcing is permitted.
 *
 * At RED (this phase): the positive cases (T1, T3, PROP round-trip) FAIL
 * because the methods do not exist yet — agent.getApprovalMode /
 * agent.setApprovalMode are undefined, yielding a missing-method TypeError.
 * T2 / the untrusted PROP fail for the same missing-method reason (the throw
 * is the TypeError, not the untrusted-folder message). Both are acceptable
 * behavioral RED (CRIT-3).
 *
 * At GREEN (P04): the pure one-liner delegations
 *   return this.deps.config.getApprovalMode();
 *   this.deps.config.setApprovalMode(mode);
 * make every case pass with no rewrite.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { buildAgent, type BuiltAgent } from './helpers/agentHarness.js';

const UNTRUSTED_MESSAGE =
  'Cannot enable privileged approval modes in an untrusted folder.';
const FIXTURE = 'plain-text.jsonl';

describe('Agent approval mode delegation @plan:PLAN-20260622-COREAPIGAP.P03 @requirement:REQ-001', () => {
  let built: BuiltAgent | undefined;

  afterEach(async () => {
    if (built) {
      await built.cleanup();
      built = undefined;
    }
  });

  it('T1 agent built with approvalMode:AUTO_EDIT (trusted) → agent.getApprovalMode() === ApprovalMode.AUTO_EDIT @requirement:REQ-001 @scenario:positive-live-read @given:a trusted agent built with approvalMode set to AUTO_EDIT @when:agent.getApprovalMode() @then:returns ApprovalMode.AUTO_EDIT (live read of the bound Config value)', async () => {
    built = await buildAgent(FIXTURE, {
      approvalMode: ApprovalMode.AUTO_EDIT,
    });
    expect(built.agent.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
  });

  it('T2 agent built with folderTrust:false → agent.setApprovalMode(YOLO) throws the real untrusted-folder error (faithful propagation, no catch) @requirement:REQ-001 @scenario:untrusted-throw @given:an agent built with folderTrust:false @when:agent.setApprovalMode(ApprovalMode.YOLO) @then:throws an Error whose message is exactly the untrusted-folder message', async () => {
    built = await buildAgent(FIXTURE, { folderTrust: false });
    expect(() => built!.agent.setApprovalMode(ApprovalMode.YOLO)).toThrow(
      UNTRUSTED_MESSAGE,
    );
  });

  it('T3 trusted agent → setApprovalMode(YOLO) then getApprovalMode() === YOLO (write-then-read parity, no cache) @requirement:REQ-001 @scenario:write-then-read @given:a trusted agent @when:setApprovalMode(YOLO) then getApprovalMode() @then:returns YOLO (live write reflected on next read via the public root)', async () => {
    built = await buildAgent(FIXTURE);
    built.agent.setApprovalMode(ApprovalMode.YOLO);
    expect(built.agent.getApprovalMode()).toBe(ApprovalMode.YOLO);
  });

  it('PROP round-trip: for any mode m in {DEFAULT,AUTO_EDIT,YOLO}, setApprovalMode(m) then getApprovalMode() === m @requirement:REQ-001 @scenario:property-round-trip @given:a trusted agent @when:setApprovalMode(m) then getApprovalMode() @then:returns m (round-trip equality over the full enum)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          ApprovalMode.DEFAULT,
          ApprovalMode.AUTO_EDIT,
          ApprovalMode.YOLO,
        ),
        async (mode) => {
          const local = await buildAgent(FIXTURE);
          try {
            local.agent.setApprovalMode(mode);
            expect(local.agent.getApprovalMode()).toBe(mode);
          } finally {
            await local.cleanup();
          }
        },
      ),
    );
  });

  it('PROP untrusted matrix: for any non-DEFAULT mode m with folderTrust:false, setApprovalMode(m) throws the untrusted-folder error; and setApprovalMode(DEFAULT) is always allowed with a DEFAULT post-condition @requirement:REQ-001 @scenario:property-untrusted-matrix @given:an agent built with folderTrust:false @when:setApprovalMode(m) for a non-DEFAULT m @then:throws the untrusted-folder message; and when setApprovalMode(DEFAULT) then getApprovalMode() === DEFAULT (DEFAULT is always allowed)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(ApprovalMode.AUTO_EDIT, ApprovalMode.YOLO),
        async (mode) => {
          const local = await buildAgent(FIXTURE, { folderTrust: false });
          try {
            expect(() => local.agent.setApprovalMode(mode)).toThrow(
              UNTRUSTED_MESSAGE,
            );
            // DEFAULT is always allowed in an untrusted folder (config.ts:402
            // guards only non-DEFAULT). Positive post-condition — NOT a bare
            // not.toThrow.
            local.agent.setApprovalMode(ApprovalMode.DEFAULT);
            expect(local.agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
          } finally {
            await local.cleanup();
          }
        },
      ),
    );
  });
});
