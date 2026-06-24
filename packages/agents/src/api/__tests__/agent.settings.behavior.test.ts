/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P11
 * @requirement:REQ-002,REQ-INT-003
 *
 * Behavioral RED suite for the Agent settings/config surface. The ephemeral
 * settings methods on AgentImpl are stubs until P12, so the ephemeral tests
 * fail at RED because the stub raises NotYetImplemented before any Config
 * value is read or written. These are genuine forward behavioral assertions
 * (real Config values, identities, error propagation), not assertions about
 * the stub error itself, and contain no mock theater.
 *
 * The system under test is a REAL Config (via the canonical buildCliStyleConfig
 * helper) wrapped by a REAL Agent (via fromConfig). The suite asserts that the
 * Agent delegates to the SAME Config instance — no parallel store, no
 * re-normalization, no error swallowing — by comparing every observable value
 * against the bound Config directly.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

describe('agent settings surface @plan:PLAN-20260621-COREAPIREMED.P11 @requirement:REQ-002 @requirement:REQ-INT-003', () => {
  it('T3 getConfig() returns the SAME caller-supplied Config instance (identity) @requirement:REQ-002 @scenario:identity @given:a real CLI-style Config wrapped by fromConfig @when:agent.getConfig() @then:the returned Config is the SAME instance supplied to fromConfig', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      expect(agent.getConfig()).toBe(built.config);
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T3b get/set round-trip for context-limit returns the Config-normalized value @requirement:REQ-002 @scenario:round-trip-context-limit @given:a fromConfig agent over a real Config @when:setEphemeralSetting("context-limit", 100000) then getEphemeralSetting("context-limit") @then:the returned value equals built.config.getEphemeralSetting("context-limit") after the same set on the Config', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      agent.setEphemeralSetting('context-limit', 100000);
      const viaAgent = agent.getEphemeralSetting('context-limit');
      built.config.setEphemeralSetting('context-limit', 100000);
      const viaConfig = built.config.getEphemeralSetting('context-limit');
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T3b-numeric-string get/set round-trip applies Config normalization (numeric string persists as a number) @requirement:REQ-002 @scenario:round-trip-normalization @given:a fromConfig agent over a real Config @when:setEphemeralSetting("context-limit", "8000") then getEphemeralSetting("context-limit") @then:the returned value is the Config-normalized value (identical to built.config.getEphemeralSetting on the same input)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      agent.setEphemeralSetting('context-limit', '8000');
      const viaAgent = agent.getEphemeralSetting('context-limit');
      built.config.setEphemeralSetting('context-limit', '8000');
      const viaConfig = built.config.getEphemeralSetting('context-limit');
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T3b-streaming get/set round-trip for streaming="disabled" returns the Config-normalized value @requirement:REQ-002 @scenario:round-trip-streaming @given:a fromConfig agent over a real Config @when:setEphemeralSetting("streaming", "disabled") then getEphemeralSetting("streaming") @then:the returned value equals built.config.getEphemeralSetting("streaming") after the same set on the Config', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      agent.setEphemeralSetting('streaming', 'disabled');
      const viaAgent = agent.getEphemeralSetting('streaming');
      built.config.setEphemeralSetting('streaming', 'disabled');
      const viaConfig = built.config.getEphemeralSetting('streaming');
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T3b-custom get/set round-trip for a plain custom key returns the stored value (parity with Config) @requirement:REQ-002 @scenario:round-trip-custom @given:a fromConfig agent over a real Config @when:setEphemeralSetting("my-custom-key", "v") then getEphemeralSetting("my-custom-key") @then:the returned value equals built.config.getEphemeralSetting("my-custom-key") after the same set on the Config', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      agent.setEphemeralSetting('my-custom-key', 'v');
      const viaAgent = agent.getEphemeralSetting('my-custom-key');
      built.config.setEphemeralSetting('my-custom-key', 'v');
      const viaConfig = built.config.getEphemeralSetting('my-custom-key');
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T3c getEphemeralSettings() deep-equals built.config.getEphemeralSettings() (same normalized global map) @requirement:REQ-002 @scenario:settings-map @given:a fromConfig agent over a real Config @when:agent.getEphemeralSettings() @then:the returned map deep-equals built.config.getEphemeralSettings()', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      agent.setEphemeralSetting('context-limit', 50000);
      agent.setEphemeralSetting('my-custom-key', 'abc');
      const viaAgent = agent.getEphemeralSettings();
      built.config.setEphemeralSetting('context-limit', 50000);
      built.config.setEphemeralSetting('my-custom-key', 'abc');
      const viaConfig = built.config.getEphemeralSettings();
      expect(viaAgent).toStrictEqual(viaConfig);
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T3d setEphemeralSetting("streaming", 123) propagates the Config error (message names "must resolve"), never swallowed @requirement:REQ-002 @scenario:error-propagation @given:a fromConfig agent over a real Config @when:setEphemeralSetting("streaming", 123) @then:the call throws an Error whose message contains "must resolve" (the propagated Config normalization error)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      expect(() => agent.setEphemeralSetting('streaming', 123)).toThrow(
        /must resolve/,
      );
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T3d-object setEphemeralSetting("streaming", <object>) propagates the Config error (message names "must resolve") @requirement:REQ-002 @scenario:error-propagation-object @given:a fromConfig agent over a real Config @when:setEphemeralSetting("streaming", { x: 1 }) @then:the call throws an Error whose message contains "must resolve"', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      expect(() => agent.setEphemeralSetting('streaming', { x: 1 })).toThrow(
        /must resolve/,
      );
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T3e-forward a value set directly on the Config is visible via agent.getEphemeralSetting (delegation, not a local cache) @requirement:REQ-002 @scenario:delegation-config-to-agent @given:a fromConfig agent over a real Config @when:built.config.setEphemeralSetting("delegated-key", 42) @then:agent.getEphemeralSetting("delegated-key") equals built.config.getEphemeralSetting("delegated-key")', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      built.config.setEphemeralSetting('delegated-key', 42);
      expect(agent.getEphemeralSetting('delegated-key')).toStrictEqual(
        built.config.getEphemeralSetting('delegated-key'),
      );
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T3e-reverse a value set via the agent is visible on built.config.getEphemeralSetting (delegation both directions) @requirement:REQ-002 @scenario:delegation-agent-to-config @given:a fromConfig agent over a real Config @when:agent.setEphemeralSetting("reverse-key", "hello") @then:built.config.getEphemeralSetting("reverse-key") equals the value the agent wrote', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      agent.setEphemeralSetting('reverse-key', 'hello');
      expect(built.config.getEphemeralSetting('reverse-key')).toStrictEqual(
        'hello',
      );
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  it('T8 normalization parity: agent.getEphemeralSetting("context-limit") equals built.config.getEphemeralSetting("context-limit") for representative inputs @requirement:REQ-002 @scenario:normalization-parity @given:a fromConfig agent over a real Config @when:both have context-limit set to 250000 @then:agent.getEphemeralSetting("context-limit") strictly equals built.config.getEphemeralSetting("context-limit")', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      agent.setEphemeralSetting('context-limit', 250000);
      built.config.setEphemeralSetting('context-limit', 250000);
      expect(agent.getEphemeralSetting('context-limit')).toBe(
        built.config.getEphemeralSetting('context-limit'),
      );
      await agent.dispose();
    } finally {
      await built.cleanup();
    }
  });

  // ─── Property-based tests (>=30% of total) ──────────────────────────────

  it('PROP-1 for any inert string key + JSON-serializable value (excluding the throwing streaming path), agent get-then-get strictly equals the Config get-then-get after setting the SAME value through the agent @requirement:REQ-002 @scenario:property-round-trip @given:any inert string key and any JSON-serializable value @when:set via the agent then read via the agent AND read the same key directly off the Config @then:agent.getEphemeralSetting(k) strictly equals built.config.getEphemeralSetting(k) for every generated (key, value)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((k) => k !== 'streaming'),
        fc.json(),
        async (key, jsonValue) => {
          const built = await buildCliStyleConfig('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig({ config: built.config });
            const value = JSON.parse(jsonValue);
            agent.setEphemeralSetting(key, value);
            const viaAgent = agent.getEphemeralSetting(key);
            const viaConfig = built.config.getEphemeralSetting(key);
            await agent.dispose();
            return viaAgent === viaConfig;
          } finally {
            await built.cleanup();
          }
        },
      ),
    );
  });

  it('PROP-2 for any inert string key, after a set through the agent, agent.getEphemeralSettings()[key] strictly equals built.config.getEphemeralSettings()[key] @requirement:REQ-002 @scenario:property-settings-map @given:any inert string key and any JSON-serializable value @when:set via the agent then read both full maps @then:agent.getEphemeralSettings()[key] strictly equals built.config.getEphemeralSettings()[key] for every generated (key, value)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((k) => k !== 'streaming'),
        fc.json(),
        async (key, jsonValue) => {
          const built = await buildCliStyleConfig('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig({ config: built.config });
            const value = JSON.parse(jsonValue);
            agent.setEphemeralSetting(key, value);
            const agentMap = agent.getEphemeralSettings();
            const configMap = built.config.getEphemeralSettings();
            await agent.dispose();
            return agentMap[key] === configMap[key];
          } finally {
            await built.cleanup();
          }
        },
      ),
    );
  });

  it('PROP-3 for any numeric context-limit value, agent.getEphemeralSetting("context-limit") equals built.config.getEphemeralSetting("context-limit") (normalization parity) @requirement:REQ-002 @scenario:property-context-limit @given:any finite numeric context-limit value @when:set via the agent then read from both surfaces @then:agent.getEphemeralSetting("context-limit") equals built.config.getEphemeralSetting("context-limit") for every generated value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat(), async (limit) => {
        const built = await buildCliStyleConfig('plain-text.jsonl');
        try {
          const agent: Agent = await fromConfig({ config: built.config });
          agent.setEphemeralSetting('context-limit', limit);
          built.config.setEphemeralSetting('context-limit', limit);
          const viaAgent = agent.getEphemeralSetting('context-limit');
          const viaConfig = built.config.getEphemeralSetting('context-limit');
          await agent.dispose();
          return viaAgent === viaConfig;
        } finally {
          await built.cleanup();
        }
      }),
    );
  });

  it('PROP-4 for streaming="enabled", agent.getEphemeralSetting("streaming") equals built.config.getEphemeralSetting("streaming") (both normalize to the same string) @requirement:REQ-002 @scenario:property-streaming-enabled @given:a fromConfig agent over a real Config @when:both set streaming="enabled" @then:agent.getEphemeralSetting("streaming") strictly equals built.config.getEphemeralSetting("streaming") for every generated scenario', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('enabled', 'disabled'), async (mode) => {
        const built = await buildCliStyleConfig('plain-text.jsonl');
        try {
          const agent: Agent = await fromConfig({ config: built.config });
          agent.setEphemeralSetting('streaming', mode);
          built.config.setEphemeralSetting('streaming', mode);
          const viaAgent = agent.getEphemeralSetting('streaming');
          const viaConfig = built.config.getEphemeralSetting('streaming');
          await agent.dispose();
          return viaAgent === viaConfig;
        } finally {
          await built.cleanup();
        }
      }),
    );
  });

  it('PROP-5 for any inert string key, a value set directly on the Config is visible via agent.getEphemeralSetting (no parallel store — the agent reads through to the SAME Config) @requirement:REQ-002 @scenario:property-no-parallel-store @given:any inert string key and any JSON-serializable value written directly on the Config @when:agent.getEphemeralSetting(k) is read @then:it strictly equals built.config.getEphemeralSetting(k) for every generated (key, value)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((k) => k !== 'streaming'),
        fc.json(),
        async (key, jsonValue) => {
          const built = await buildCliStyleConfig('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig({ config: built.config });
            const value = JSON.parse(jsonValue);
            built.config.setEphemeralSetting(key, value);
            const viaAgent = agent.getEphemeralSetting(key);
            const viaConfig = built.config.getEphemeralSetting(key);
            await agent.dispose();
            return viaAgent === viaConfig;
          } finally {
            await built.cleanup();
          }
        },
      ),
    );
  });
});
