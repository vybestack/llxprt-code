/** @plan:PLAN-20260622-COREAPIGAP.P17 @requirement:REQ-008 */
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BEHAVIORAL RED-then-GREEN suite for the public barrel re-exports
 * (`packages/agents/src/api/index.ts`) and the six new COMMAND_API_MAP rows
 * (`app-services/command-api-map.ts`). Asserts that the two VALUE enums
 * (`ApprovalMode`, `PolicyDecision`) import as RUNTIME VALUES from the public
 * root `@vybestack/llxprt-code-agents` and that the six target slash-commands
 * are registered as `kind: 'runtime'` rows with the correct dotted Agent-method
 * targets. No deep core import is required by a #1595 consumer.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ApprovalMode, PolicyDecision } from '@vybestack/llxprt-code-agents';
import * as root from '@vybestack/llxprt-code-agents';
import { COMMAND_API_MAP } from '../../app-services/command-api-map.js';

describe('P17 public barrel + command-api-map @plan:PLAN-20260622-COREAPIGAP.P17 @requirement:REQ-008', () => {
  it('T1 VALUE enums round-trip their real members from the public root @requirement:REQ-008 @scenario:enum-value-roundtrip @given:the public agents barrel @when:importing ApprovalMode + PolicyDecision as values @then:ApprovalMode.YOLO==="yolo", AUTO_EDIT==="autoEdit", DEFAULT==="default"; PolicyDecision.ASK_USER==="ask_user", ALLOW==="allow", DENY==="deny"', () => {
    expect(ApprovalMode.YOLO).toBe('yolo');
    expect(ApprovalMode.AUTO_EDIT).toBe('autoEdit');
    expect(ApprovalMode.DEFAULT).toBe('default');
    expect(PolicyDecision.ASK_USER).toBe('ask_user');
    expect(PolicyDecision.ALLOW).toBe('allow');
    expect(PolicyDecision.DENY).toBe('deny');
  });

  it('T2 the two enums are runtime keys of the public root namespace @requirement:REQ-008 @scenario:namespace-runtime-keys @given:import * as root from the public barrel @when:Object.prototype.hasOwnProperty.call(root, NAME) @then:ApprovalMode and PolicyDecision are OWN runtime properties (not type-only projections)', () => {
    expect(Object.prototype.hasOwnProperty.call(root, 'ApprovalMode')).toBe(
      true,
    );
    expect(Object.prototype.hasOwnProperty.call(root, 'PolicyDecision')).toBe(
      true,
    );
  });

  it('T3 the six target command rows exist with kind runtime and correct targets @requirement:REQ-008 @scenario:command-map-rows @given:COMMAND_API_MAP indexed by command @when:looking up each of the six target commands @then:each row exists, kind==="runtime", and target equals the expected dotted Agent-method path', () => {
    const byCmd = new Map(COMMAND_API_MAP.map((e) => [e.command, e] as const));
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['/approval-mode', 'agent.setApprovalMode'],
      ['/policies', 'agent.policy.getRules'],
      ['/task', 'agent.tasks.list'],
      ['/hooks', 'agent.hooks.listHooks'],
      ['/toolkey', 'agent.tools.keys.save'],
      ['/toolkeyfile', 'agent.tools.keys.setKeyFile'],
    ] as const;
    for (const [cmd, target] of expected) {
      const row = byCmd.get(cmd);
      expect(row).toBeDefined();
      expect(row?.kind).toBe('runtime');
      expect(row?.target).toBe(target);
    }
  });

  it('T4 map invariants hold after the append: valid kinds + unique command names @requirement:REQ-008 @requirement:REQ-009 @scenario:map-invariants @given:the full COMMAND_API_MAP after the six new rows @when:inspecting every row @then:every kind is in {runtime,subpath,cli-local} and command names are unique', () => {
    const validKinds = new Set(['runtime', 'subpath', 'cli-local']);
    for (const e of COMMAND_API_MAP) {
      expect(validKinds.has(e.kind)).toBe(true);
    }
    const names = COMMAND_API_MAP.map((e) => e.command);
    expect(new Set(names).size).toBe(names.length);
  });

  it('T5 PROPERTY: every ApprovalMode member is a non-empty string and round-trips to a live enum member @requirement:REQ-008 @scenario:property-approvalmode-members', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(ApprovalMode)),
        (value: string) => {
          expect(value.length).toBeGreaterThan(0);
          expect(typeof value).toBe('string');
          // The value must be a live member of the enum (round-trip).
          const members = Object.values(ApprovalMode) as readonly string[];
          expect(members).toContain(value);
        },
      ),
    );
  });

  it('T6 PROPERTY: every target command is present in the map with kind runtime and an agent.* target @requirement:REQ-008 @scenario:property-command-targets', () => {
    const byCmd = new Map(COMMAND_API_MAP.map((e) => [e.command, e] as const));
    fc.assert(
      fc.property(
        fc.constantFrom(
          '/approval-mode',
          '/policies',
          '/task',
          '/hooks',
          '/toolkey',
          '/toolkeyfile',
        ),
        (cmd: string) => {
          const row = byCmd.get(cmd);
          expect(row).toBeDefined();
          expect(row?.kind).toBe('runtime');
          expect(row?.target.length).toBeGreaterThan(0);
          expect(row?.target.startsWith('agent.')).toBe(true);
        },
      ),
    );
  });
});
