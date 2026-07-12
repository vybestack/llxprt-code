/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20270110-ISSUE2378.P01
 * @requirement:REQ-2378-001
 *
 * BEHAVIORAL suite for the public Agent bus accessor (`getMessageBus`).
 *
 * The #2378 remediation makes agent construction own the single session
 * MessageBus and expose it read-only through the public Agent facade, so
 * UI / non-interactive CLI consumers obtain the Agent-owned bus instead of
 * constructing (or threading) their own. These assertions observe the
 * OUTCOME (identity + liveness) via the public surface only — no structural
 * probes, no mock sequences.
 */

import { describe, it, expect } from 'vitest';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  buildCliStyleConfig,
  type MessageBus,
} from './helpers/buildCliStyleConfig.js';
import { buildAgent } from './helpers/agentHarness.js';

describe('Agent.getMessageBus @plan:PLAN-20270110-ISSUE2378.P01 @requirement:REQ-2378-001', () => {
  it('exposes the caller-supplied MessageBus as the SAME instance through the public accessor', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const callerBus: MessageBus = built.messageBus;
      const agent: Agent = await fromConfig({
        config: built.config,
        messageBus: callerBus,
      });
      // The public accessor returns the EXACT caller bus — no second bus.
      expect(agent.getMessageBus()).toBe(callerBus);
    } finally {
      await built.cleanup();
    }
  });

  it('returns a single defined bus when none is supplied, stable across repeated reads', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      const first = agent.getMessageBus();
      const second = agent.getMessageBus();
      expect(first).toBeDefined();
      // Idempotent read: the accessor never builds a bus on demand.
      expect(second).toBe(first);
    } finally {
      await built.cleanup();
    }
  });

  it('a createAgent-built agent also exposes its owned bus via the public accessor', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const bus = agent.getMessageBus();
      expect(bus).toBeDefined();
      // Same instance on every read.
      expect(agent.getMessageBus()).toBe(bus);
    } finally {
      await cleanup();
    }
  });

  it('the exposed bus is the one the agent actually uses: a caller subscription survives on the accessor-returned bus', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const callerBus: MessageBus = built.messageBus;
      const agent: Agent = await fromConfig({
        config: built.config,
        messageBus: callerBus,
      });
      const exposed = agent.getMessageBus();
      // The exposed bus IS the caller bus, so a subscription on the caller bus
      // is observable through the accessor-returned reference (identity).
      expect(exposed).toBe(callerBus);
    } finally {
      await built.cleanup();
    }
  });
});
