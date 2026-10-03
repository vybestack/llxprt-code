/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  disposeCliRuntime,
  getCliRuntimeServices,
  runWithRuntimeScope,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

function failingReadinessFactory(
  failure: Error,
  observeTarget: (provider: string, model: string) => void,
): RuntimeTokenizerFactory {
  return {
    prepareTokenizer: async (providerName, model) => {
      observeTarget(providerName, model ?? '');
      throw failure;
    },
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: () => {
        throw new Error('unreachable tokenizer use');
      },
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'test-readiness',
      estimatorVersion: 'test-readiness-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    }),
  };
}

describe('fromConfig failed-bootstrap lifecycle', () => {
  it('preserves the causal failure, removes the isolated runtime, and leaves adopted Config and bus usable', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const failure = new Error('mandatory tokenizer readiness failed causally');
    const runtimeId = 'from-config-rejected-tokenizer-readiness';
    let readinessTarget:
      | { readonly provider: string; readonly model: string }
      | undefined;

    built.config.setProvider('stale-config-provider');
    built.config.setTokenizerFactory(
      failingReadinessFactory(failure, (provider, model) => {
        readinessTarget = { provider, model };
      }),
    );

    try {
      await expect(
        fromConfig({
          config: built.config,
          sessionId: runtimeId,
          messageBus: built.messageBus,
        }),
      ).rejects.toBe(failure);

      built.config.setEphemeralSetting('s9-bootstrap-probe', true);
      expect(built.config.getEphemeralSetting('s9-bootstrap-probe')).toBe(true);

      const responseType = MessageBusType.TOOL_CONFIRMATION_RESPONSE;
      expect(built.messageBus.listenerCount(responseType)).toBe(0);
      const unsubscribe = built.messageBus.subscribe(
        responseType,
        () => undefined,
      );
      expect(built.messageBus.listenerCount(responseType)).toBe(1);
      unsubscribe();
      expect(built.messageBus.listenerCount(responseType)).toBe(0);

      expect(readinessTarget).toStrictEqual({
        provider: 'fake',
        model: 'fake-model',
      });
      expect(readinessTarget?.provider).not.toBe('stale-config-provider');
      expect(() =>
        runWithRuntimeScope({ runtimeId, metadata: {} }, () =>
          getCliRuntimeServices(),
        ),
      ).toThrow(/runtime registration|runtime.*not/i);
    } finally {
      await disposeCliRuntime(runtimeId);
      await built.cleanup();
    }
  });
});
