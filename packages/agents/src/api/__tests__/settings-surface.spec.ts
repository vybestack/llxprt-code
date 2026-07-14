/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P19
 * @requirement:REQ-INT-003
 *
 * Broad parity harness — settings surface. Exercises the SAME public entry
 * points the eventual #1595 CLI will use (`agent.getEphemeralSetting` /
 * `setEphemeralSetting` / `getEphemeralSettings`) against a REAL CLI-style
 * Config + a REAL FakeProvider JSONL fixture. This is a PARITY-EXPANSION /
 * VERIFICATION gate (NOT a RED TDD phase): the settings seam is already
 * implemented (P12), so a PASSING suite is the success condition.
 *
 * Scenario T8 (mirroring pseudocode cli-integration-adapter.md lines 60-68):
 *   - numeric normalization: setEphemeralSetting('context-limit','1000') →
 *     getEphemeralSetting returns the number 1000 (Config rule), AND parity
 *     with the Config after the same set.
 *   - streaming enum: setEphemeralSetting('streaming','enabled') →
 *     getEphemeralSetting returns 'enabled', parity with Config.
 *   - invalid throws: setEphemeralSetting('streaming',123) throws with a
 *     message naming 'must resolve' (the Config rule propagates; never
 *     swallowed).
 *   - deep-equal: agent.getEphemeralSettings() deep-equals
 *     built.config.getEphemeralSettings() after the same mutations.
 *
 * Property (lines 70-73): for any inert key + JSON scalar value, set through
 * the agent and read through both the agent and the Config are strictly equal.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

describe('settings-surface parity @plan:PLAN-20260621-COREAPIREMED.P19 @requirement:REQ-INT-003', () => {
  it('T8a numeric normalize: agent.setEphemeralSetting("context-limit","1000") yields the Config-normalized number 1000 and parity with the Config (REQ-INT-003)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });

      agent.setEphemeralSetting('context-limit', '1000');
      const viaAgent = agent.getEphemeralSetting('context-limit');

      // Config normalization: numeric string → number.
      expect(viaAgent).toBe(1000);
      expect(typeof viaAgent).toBe('number');

      // Parity: the SAME set on the Config yields the same value.
      built.config.setEphemeralSetting('context-limit', '1000');
      expect(viaAgent).toBe(built.config.getEphemeralSetting('context-limit'));
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('T8b streaming enum: agent.setEphemeralSetting("streaming","enabled") yields "enabled" and parity with the Config (REQ-INT-003)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });

      agent.setEphemeralSetting('streaming', 'enabled');
      const viaAgent = agent.getEphemeralSetting('streaming');

      expect(viaAgent).toBe('enabled');

      built.config.setEphemeralSetting('streaming', 'enabled');
      expect(viaAgent).toBe(built.config.getEphemeralSetting('streaming'));
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('T8c invalid streaming throws with "must resolve" — the Config rule propagates, never swallowed (REQ-INT-003)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });

      // The Config rule (configBase.ts:207) throws
      // 'Streaming setting must resolve to "enabled" or "disabled"'; the
      // agent MUST propagate it, never swallow.
      expect(() => agent.setEphemeralSetting('streaming', 123)).toThrow(
        /must resolve/,
      );
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('T8d deep-equal: agent.getEphemeralSettings() deep-equals built.config.getEphemeralSettings() after the same mutations (REQ-INT-003)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });

      agent.setEphemeralSetting('context-limit', 50000);
      agent.setEphemeralSetting('streaming', 'disabled');
      agent.setEphemeralSetting('parity-key', 'v');

      built.config.setEphemeralSetting('context-limit', 50000);
      built.config.setEphemeralSetting('streaming', 'disabled');
      built.config.setEphemeralSetting('parity-key', 'v');

      expect(agent.getEphemeralSettings()).toStrictEqual(
        built.config.getEphemeralSettings(),
      );
    } finally {
      await built.cleanup();
    }
  }, 30000);

  // ─── Property-based (>=30% of total) ─────────────────────────────────────

  it('PROP round-trip: for any inert key + JSON scalar value, set-through-agent then read-through-agent strictly equals read-through-Config (REQ-INT-003)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('alpha', 'beta', 'gamma', 'my-key', 'x1'),
        fc.oneof(fc.string({ maxLength: 40 }), fc.integer(), fc.boolean()),
        async (key, value) => {
          const built = await buildCliStyleConfig('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig({ config: built.config });
            agent.setEphemeralSetting(key, value);
            built.config.setEphemeralSetting(key, value);
            return (
              agent.getEphemeralSetting(key) ===
              built.config.getEphemeralSetting(key)
            );
          } finally {
            await built.cleanup();
          }
        },
      ),
    );
  }, 30000);

  it('PROP streaming enum parity: for streaming in {enabled, disabled}, agent and Config normalize identically (REQ-INT-003)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('enabled', 'disabled'), async (mode) => {
        const built = await buildCliStyleConfig('plain-text.jsonl');
        try {
          const agent: Agent = await fromConfig({ config: built.config });
          agent.setEphemeralSetting('streaming', mode);
          built.config.setEphemeralSetting('streaming', mode);
          return (
            agent.getEphemeralSetting('streaming') ===
            built.config.getEphemeralSetting('streaming')
          );
        } finally {
          await built.cleanup();
        }
      }),
    );
  }, 30000);
});
