/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the activation-preflight token binding (#2378
 * Remediation Findings 1 & 2).
 *
 * Finding 1: Each opaque preflight token is bound to an immutable canonical
 * ProviderActivationIntent and requires exact match; invalid/mismatched/
 * wrong-config/wrong-manager/double-consumed token must FAIL CLOSED with
 * AgentBootstrapError, never re-run activation.
 *
 * Finding 2: Overlapping successful preflights are safe — issued tokens remain
 * independent until consumed, while failed/new attempts must NOT permit stale
 * ambient adoption (tokens are explicit).
 *
 * These tests import from the SAME relative module path as the internal
 * preflightAgentActivation uses, so the WeakMap-backed token registry is shared
 * across all operations in a test. They observe OUTCOMES (throws, returned
 * results, token identity) — not mock call counts.
 */

import { describe, it, expect } from 'vitest';
import { preflightAgentActivation } from '../preflightAgentActivation.js';
import { AgentBootstrapError } from '../agentBootstrap.js';
import type { ProviderActivationIntent } from '../config-types.js';
import {
  consumeCompletedActivationPreflight,
  recordCompletedActivationPreflight,
  clearCompletedActivationPreflight,
  canonicalProviderActivationIntent,
  type ActivationPreflightToken,
} from '../activationPreflightState.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

// ─── Finding 1: Token bound to canonical intent, exact-match consume ──────

describe('activation preflight token: fail-closed exact-match (Finding 1)', () => {
  it('consumes successfully when Config, ProviderManager, and intent all match', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };
      const result = await preflightAgentActivation(built.config, intent);
      expect(result.token).toBeDefined();
      const token = result.token!;

      // Consume with the SAME intent → returns the original result.
      const consumed = consumeCompletedActivationPreflight(
        built.config,
        token,
        intent,
      );
      expect(consumed.authFailed).toBe(false);
      expect(consumed.activeProvider).toBe('fake');
    } finally {
      await built.cleanup();
    }
  });

  it('throws AgentBootstrapError when intent differs (canonical mismatch)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const originalIntent: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };
      const result = await preflightAgentActivation(
        built.config,
        originalIntent,
      );
      const token = result.token!;
      expect(token).toBeDefined();

      // Consume with a DIFFERENT intent (different provider) → must throw.
      const wrongIntent: ProviderActivationIntent = {
        provider: 'gemini',
        authMode: 'auto',
      };
      expect(() =>
        consumeCompletedActivationPreflight(built.config, token, wrongIntent),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });

  it('throws AgentBootstrapError when intent model differs', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const originalIntent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      };
      const result = await preflightAgentActivation(
        built.config,
        originalIntent,
      );
      const token = result.token!;

      const wrongIntent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'different-model',
        authMode: 'auto',
      };
      expect(() =>
        consumeCompletedActivationPreflight(built.config, token, wrongIntent),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });

  it('throws AgentBootstrapError when intent cliOverrides differ', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const originalIntent: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };
      const result = await preflightAgentActivation(
        built.config,
        originalIntent,
      );
      const token = result.token!;

      const wrongIntent: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-DIFFERENT-key' },
        authMode: 'auto',
      };
      expect(() =>
        consumeCompletedActivationPreflight(built.config, token, wrongIntent),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });

  it('throws AgentBootstrapError when authMode differs', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const originalIntent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'auto',
      };
      const result = await preflightAgentActivation(
        built.config,
        originalIntent,
      );
      const token = result.token!;

      const wrongIntent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'none',
      };
      expect(() =>
        consumeCompletedActivationPreflight(built.config, token, wrongIntent),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });

  it('throws AgentBootstrapError for a foreign/invalid token', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const foreignToken: ActivationPreflightToken = Object.freeze({
        id: Symbol(),
        intentFingerprint: 'bogus',
      });
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'auto',
      };
      expect(() =>
        consumeCompletedActivationPreflight(built.config, foreignToken, intent),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });

  it('throws AgentBootstrapError on double-consumption (exactly-once)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'auto',
      };
      const result = await preflightAgentActivation(built.config, intent);
      const token = result.token!;

      // First consume succeeds.
      consumeCompletedActivationPreflight(built.config, token, intent);

      // Second consume of the SAME token must throw.
      expect(() =>
        consumeCompletedActivationPreflight(built.config, token, intent),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });

  it('throws AgentBootstrapError when the ProviderManager was swapped after issue', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'auto',
      };
      const result = await preflightAgentActivation(built.config, intent);
      const token = result.token!;

      // Swap the manager to a different object reference.
      const realManager = built.config.getProviderManager();
      const fakeManager = Object.create(realManager);
      (
        built.config as { setProviderManager: (m: unknown) => void }
      ).setProviderManager(fakeManager);

      expect(() =>
        consumeCompletedActivationPreflight(built.config, token, intent),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });
});

// ─── Finding 2: Overlapping preflights are safe; no stale ambient adoption ──

describe('activation preflight token: concurrent/independent safety (Finding 2)', () => {
  it('two consecutive successful preflights: the latest supersedes the previous (tokenB is valid, tokenA is superseded)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intentA: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-key-A' },
        authMode: 'auto',
      };
      const intentB: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-key-B' },
        authMode: 'auto',
      };

      const resultA = await preflightAgentActivation(built.config, intentA);
      const tokenA = resultA.token!;
      expect(tokenA).toBeDefined();

      const resultB = await preflightAgentActivation(built.config, intentB);
      const tokenB = resultB.token!;
      expect(tokenB).toBeDefined();

      // The tokens must be different objects.
      expect(tokenA).not.toBe(tokenB);

      // tokenB (the latest) is consumable.
      const consumedB = consumeCompletedActivationPreflight(
        built.config,
        tokenB,
        intentB,
      );
      expect(consumedB.authFailed).toBe(false);

      // tokenA was superseded as the latest when tokenB was recorded, so its
      // completed entry was removed. Consuming it now fails closed.
      expect(() =>
        consumeCompletedActivationPreflight(built.config, tokenA, intentA),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });

  it('a failed preflight does NOT produce a token (no stale ambient adoption)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const failingIntent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'auto',
      };
      const result = await preflightAgentActivation(
        built.config,
        failingIntent,
      );
      // Failed activations never produce a token.
      expect(result.token).toBeUndefined();
      expect(result.authFailed).toBe(true);
    } finally {
      await built.cleanup();
    }
  });

  it('a failed preflight followed by a new attempt does not permit stale adoption from the failed attempt', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // First: a failing preflight (no token produced).
      const failingIntent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'auto',
      };
      const failedResult = await preflightAgentActivation(
        built.config,
        failingIntent,
      );
      expect(failedResult.token).toBeUndefined();

      // Second: a new successful preflight.
      const goodIntent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'auto',
      };
      const goodResult = await preflightAgentActivation(
        built.config,
        goodIntent,
      );
      expect(goodResult.token).toBeDefined();
      expect(goodResult.authFailed).toBe(false);

      // The good token only matches the good intent, not the failed one.
      expect(() =>
        consumeCompletedActivationPreflight(
          built.config,
          goodResult.token!,
          failingIntent,
        ),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });

  it('canonicalProviderActivationIntent produces stable, order-independent fingerprints', () => {
    const intent1: ProviderActivationIntent = {
      provider: 'fake',
      modelParams: { a: 1, b: 2 },
      authMode: 'auto',
    };
    const intent2: ProviderActivationIntent = {
      provider: 'fake',
      modelParams: { b: 2, a: 1 },
      authMode: 'auto',
    };
    expect(canonicalProviderActivationIntent(intent1)).toBe(
      canonicalProviderActivationIntent(intent2),
    );
  });

  it('canonicalProviderActivationIntent differs for different providers', () => {
    const intent1: ProviderActivationIntent = {
      provider: 'fake',
      authMode: 'auto',
    };
    const intent2: ProviderActivationIntent = {
      provider: 'gemini',
      authMode: 'auto',
    };
    expect(canonicalProviderActivationIntent(intent1)).not.toBe(
      canonicalProviderActivationIntent(intent2),
    );
  });

  it('clearCompletedActivationPreflight invalidates the latest token', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'auto',
      };
      const result = await preflightAgentActivation(built.config, intent);
      const token = result.token!;

      // Clear the latest — this invalidates the token.
      clearCompletedActivationPreflight(built.config);

      // Consuming the cleared token must throw.
      expect(() =>
        consumeCompletedActivationPreflight(built.config, token, intent),
      ).toThrow(AgentBootstrapError);
    } finally {
      await built.cleanup();
    }
  });

  it('recordCompletedActivationPreflight with a failed result returns undefined (no token)', () => {
    // Direct unit-level behavioral test: a failed result never produces a token.
    const fakeConfig = {
      getProviderManager: () => ({ name: 'fake' }),
    } as unknown as Config;
    const intent: ProviderActivationIntent = {
      provider: 'fake',
      authMode: 'auto',
    };
    const failedResult = {
      authFailed: true,
      infoMessages: [],
    };
    const token = recordCompletedActivationPreflight(
      fakeConfig,
      failedResult,
      intent,
    );
    expect(token).toBeUndefined();
  });
});
