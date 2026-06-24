/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-002
 * @requirement:REQ-021
 *
 * Sandbox createAgent-time config + app-service recreate boundary (RED).
 * Behavioral integration tests against a real public Agent. Tests FAIL
 * NATURALLY — stub methods throw NYI; no mock theater, only value assertions.
 *
 * Covers:
 * - T18e sandbox is a createAgent-time config; the sandboxed agent runs a turn;
 *       changing the sandbox is the recreate path (build a NEW agent and it
 *       independently runs). Live mutation is NOT a runtime method on Agent
 *       (enforced by the type system at compile time — no runtime test needed).
 */

import { describe, it, expect } from 'vitest';
import {
  buildAgent,
  drain,
  countType,
  isTextEvent,
} from './helpers/agentHarness.js';

describe('Sandbox boundary @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-002 @requirement:REQ-021', () => {
  it('T18e sandbox is accepted at createAgent time and the sandboxed agent runs a turn @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-002', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      sandbox: { profile: 'restricted', network: 'disabled' },
    });
    try {
      // The sandbox config was accepted at construction; the agent operates by
      // running a real turn. At RED agent.stream throws NYI → natural fail; at
      // GREEN the sandboxed agent runs to completion.
      const events = await drain(agent.stream('hello in sandbox'));
      expect(countType(events, 'done')).toBe(1);
      expect(events.filter(isTextEvent).length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup();
    }
  });

  it('T18e changing the sandbox is the recreate path: a NEW agent with a different sandbox independently runs a turn @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-021', async () => {
    // Agent #1 — restricted sandbox, runs a turn to completion.
    const first = await buildAgent('plain-text.jsonl', {
      sandbox: { profile: 'restricted', network: 'disabled' },
    });
    try {
      const firstEvents = await drain(first.agent.stream('first turn'));
      expect(countType(firstEvents, 'done')).toBe(1);
    } finally {
      await first.cleanup();
    }

    // The recreate path: construct a NEW agent with a different sandbox. It
    // independently runs a turn to completion. At RED the first turn throws
    // NYI → natural fail; at GREEN both agents operate under their respective
    // sandbox configs.
    const second = await buildAgent('plain-text.jsonl', {
      sandbox: { profile: 'permissive', network: 'enabled' },
    });
    try {
      const secondEvents = await drain(second.agent.stream('second turn'));
      expect(countType(secondEvents, 'done')).toBe(1);
    } finally {
      await second.cleanup();
    }
  });
});
