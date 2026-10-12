/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue:2607 Finding 2
 *
 * BEHAVIORAL tests proving typed AgentConfig stream-timeout fields
 * (streamFirstResponseTimeoutMs, streamIdleTimeoutMs) are wired into runtime
 * Config ephemerals through the public createAgent path.
 *
 * These integration tests build a real public Agent over a FakeProvider, then
 * inspect its internal Config to verify the typed-to-runtime wiring without
 * asserting on adapter implementation calls. The typed API fields map to registry keys at the runtime boundary.
 */

import { describe, it, expect } from 'bun:test';
import { buildAgent } from './helpers/agentHarness.js';
import {
  STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY,
  STREAM_IDLE_TIMEOUT_SETTING_KEY,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';

describe('createAgent typed stream timeouts @issue:2607', () => {
  it('applies a positive streamFirstResponseTimeoutMs to the runtime Config under its registry key', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      streamFirstResponseTimeoutMs: 180_000,
    });
    try {
      expect(agent.getEphemeralSetting('streamIdleTimeoutMs')).toBeUndefined();
      expect(
        agent.getEphemeralSetting('streamFirstResponseTimeoutMs'),
      ).toBeUndefined();
      expect(
        agent.getEphemeralSetting(STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY),
      ).toBe(180_000);
    } finally {
      await cleanup();
    }
  });

  it('resolves streamFirstResponseTimeoutMs 0 (disables the watchdog) verbatim to the Config', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      streamFirstResponseTimeoutMs: 0,
    });
    try {
      expect(agent.getEphemeralSetting('streamIdleTimeoutMs')).toBeUndefined();
      expect(
        agent.getEphemeralSetting('streamFirstResponseTimeoutMs'),
      ).toBeUndefined();
      expect(
        agent.getEphemeralSetting(STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY),
      ).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('an explicit 300000 is distinguishable from absent/default (written verbatim, not defaulted)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      streamFirstResponseTimeoutMs: 300_000,
    });
    try {
      expect(agent.getEphemeralSetting('streamIdleTimeoutMs')).toBeUndefined();
      expect(
        agent.getEphemeralSetting('streamFirstResponseTimeoutMs'),
      ).toBeUndefined();
      // Absent would have been undefined (no ephemeral materialized); an
      // explicit 300000 is written through as a concrete value.
      expect(
        agent.getEphemeralSetting(STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY),
      ).toBe(300_000);
    } finally {
      await cleanup();
    }
  });

  it('does NOT materialize a streamFirstResponseTimeoutMs ephemeral when the field is absent', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(agent.getEphemeralSetting('streamIdleTimeoutMs')).toBeUndefined();
      expect(
        agent.getEphemeralSetting('streamFirstResponseTimeoutMs'),
      ).toBeUndefined();
      expect(
        agent.getEphemeralSetting(STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY),
      ).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('applies an existing streamIdleTimeoutMs to the runtime Config under its registry key', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      streamIdleTimeoutMs: 7_500,
    });
    try {
      expect(agent.getEphemeralSetting('streamIdleTimeoutMs')).toBeUndefined();
      expect(
        agent.getEphemeralSetting('streamFirstResponseTimeoutMs'),
      ).toBeUndefined();
      expect(agent.getEphemeralSetting(STREAM_IDLE_TIMEOUT_SETTING_KEY)).toBe(
        7_500,
      );
    } finally {
      await cleanup();
    }
  });

  it('applies both timeout fields together when both are provided', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      streamIdleTimeoutMs: 5_000,
      streamFirstResponseTimeoutMs: 240_000,
    });
    try {
      expect(agent.getEphemeralSetting('streamIdleTimeoutMs')).toBeUndefined();
      expect(
        agent.getEphemeralSetting('streamFirstResponseTimeoutMs'),
      ).toBeUndefined();
      expect(agent.getEphemeralSetting(STREAM_IDLE_TIMEOUT_SETTING_KEY)).toBe(
        5_000,
      );
      expect(
        agent.getEphemeralSetting(STREAM_FIRST_RESPONSE_TIMEOUT_SETTING_KEY),
      ).toBe(240_000);
    } finally {
      await cleanup();
    }
  });
});
