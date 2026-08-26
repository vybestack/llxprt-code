/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for token accounting reset on provider switch.
 * Tests the three bugs from issue #1567:
 * 1. resetTokenAccounting() zeroes out accumulated drift
 * 2. syncTotalTokens() calls queued before reset are ignored (race fix)
 * 3. recalculateTotalTokens(modelName) uses the provided model's tokenizer
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { createUserMessage } from './IContent.js';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer } from '../../runtime/contracts/RuntimeTokenizer.js';

function createScalingTokenizerFactory(
  _tokenizer: RuntimeTokenizer,
): RuntimeTokenizerFactory & { setFactor: (f: number) => void } {
  let factor = 1;
  return {
    getTokenizer: () => ({
      countTokens: (content: unknown) => {
        const text = typeof content === 'string' ? content : String(content);
        return Math.ceil((text.length / 4) * factor);
      },
    }),
    async estimatePrompt(request) {
      return {
        count: await request.legacyEstimate(),
        method: 'calibrated',
        family: 'legacy-unregistered',
        estimatorVersion: 'core-estimate-tokens-v1',
        assetRevision: 'none',
        projectionRevision: request.projectionRevision,
      };
    },
    setFactor: (f: number) => {
      factor = f;
    },
  };
}

describe('HistoryService - Token Accounting Reset (provider switch)', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  describe('resetTokenAccounting', () => {
    it('zeroes out baseTokenOffset after drift was applied', async () => {
      service.add(
        createUserMessage('Hello world this is a test message', {
          timestamp: Date.now(),
        }),
        'gpt-4.1',
      );
      await service.waitForTokenUpdates();

      service.syncTotalTokens(99999);
      await service.waitForTokenUpdates();

      expect(service.getBaseTokenOffset()).toBeGreaterThan(0);
      expect(service.getTotalTokens()).toBe(99999);

      service.resetTokenAccounting();

      expect(service.getBaseTokenOffset()).toBe(0);
    });

    it('preserves history tokens but clears offset so getTotalTokens reflects raw estimate', async () => {
      service.add(
        createUserMessage('Some conversation text here', {
          timestamp: Date.now(),
        }),
        'gpt-4.1',
      );
      await service.waitForTokenUpdates();

      const estimatedBeforeDrift = service.getTotalTokens();

      service.syncTotalTokens(5000);
      await service.waitForTokenUpdates();

      service.resetTokenAccounting();
      await service.waitForTokenUpdates();

      expect(service.getTotalTokens()).toBe(estimatedBeforeDrift);
    });

    it('emits a tokensUpdated event with current total after reset', async () => {
      let lastEmitted: { totalTokens: number; addedTokens: number } | null =
        null;
      service.on(
        'tokensUpdated',
        (evt: { totalTokens: number; addedTokens: number }) => {
          lastEmitted = evt;
        },
      );

      service.resetTokenAccounting();

      expect(lastEmitted).not.toBeNull();
      expect(lastEmitted?.totalTokens).toBe(service.getTotalTokens());
      expect(lastEmitted?.addedTokens).toBe(0);
    });
  });

  describe('syncTotalTokens race condition (stale sync skipped)', () => {
    it('ignores syncTotalTokens queued before resetTokenAccounting', async () => {
      service.add(
        createUserMessage('Conversation history', { timestamp: Date.now() }),
        'gpt-4.1',
      );
      await service.waitForTokenUpdates();

      const estimated = service.getTotalTokens();
      expect(estimated).toBeGreaterThan(0);

      service.syncTotalTokens(80000);
      service.resetTokenAccounting();

      await service.waitForTokenUpdates();

      expect(service.getBaseTokenOffset()).toBe(0);
      expect(service.getTotalTokens()).toBe(estimated);
    });

    it('applies syncTotalTokens queued after resetTokenAccounting', async () => {
      service.add(
        createUserMessage('Conversation history', { timestamp: Date.now() }),
        'gpt-4.1',
      );
      await service.waitForTokenUpdates();

      service.resetTokenAccounting();
      await service.waitForTokenUpdates();

      service.syncTotalTokens(40000);
      await service.waitForTokenUpdates();

      expect(service.getTotalTokens()).toBe(40000);
      expect(service.getBaseTokenOffset()).toBeGreaterThan(0);
    });
  });

  describe('syncTotalTokens race condition (clear and dispose paths)', () => {
    it('ignores syncTotalTokens queued before clear', async () => {
      service.add(
        createUserMessage('Conversation history', { timestamp: Date.now() }),
        'gpt-4.1',
      );
      await service.waitForTokenUpdates();

      service.syncTotalTokens(80000);

      service.clear();
      await service.waitForTokenUpdates();

      expect(service.getBaseTokenOffset()).toBe(0);
      expect(service.getTotalTokens()).toBe(0);
    });

    it('ignores syncTotalTokens queued before dispose', async () => {
      service.add(
        createUserMessage('Conversation history', { timestamp: Date.now() }),
        'gpt-4.1',
      );
      await service.waitForTokenUpdates();

      service.syncTotalTokens(80000);

      service.dispose();

      expect(service.getBaseTokenOffset()).toBe(0);
      expect(service.getTotalTokens()).toBe(0);
    });
  });

  describe('recalculateTotalTokens with explicit model', () => {
    it('re-estimates history tokens using the provided model tokenizer', async () => {
      const factory = createScalingTokenizerFactory({
        countTokens: () => 0,
      });

      service.add(
        createUserMessage('AAAABBBBCCCCDDDD', { timestamp: Date.now() }),
        'old-model',
      );
      await service.waitForTokenUpdates();

      const oldEstimate = service.getTotalTokens();
      expect(oldEstimate).toBeGreaterThan(0);

      factory.setFactor(10);
      service.setTokenizerFactory(factory);

      await service.recalculateTotalTokens('claude-3-5-sonnet-20241022');

      const newEstimate = service.getTotalTokens();
      expect(newEstimate).toBeGreaterThan(oldEstimate * 5);
    });

    it('falls back to default model when no model name is provided', async () => {
      service.add(
        createUserMessage('Test message content', { timestamp: Date.now() }),
        'some-model',
      );
      await service.waitForTokenUpdates();

      const before = service.getTotalTokens();

      await service.recalculateTotalTokens();

      expect(service.getTotalTokens()).toBe(before);
    });

    it('uses active provider and model instead of historical origin identity', async () => {
      const calls: Array<[string, string | undefined]> = [];
      const factory: RuntimeTokenizerFactory = {
        getTokenizer: (provider, model) => {
          calls.push([provider, model]);
          return { countTokens: () => 7 };
        },
        async estimatePrompt(request) {
          return {
            count: await request.legacyEstimate(),
            method: 'calibrated',
            family: 'legacy-unregistered',
            estimatorVersion: 'core-estimate-tokens-v1',
            assetRevision: 'none',
            projectionRevision: request.projectionRevision,
          };
        },
      };
      service.add(
        createUserMessage('historical content', {
          timestamp: Date.now(),
          model: 'old-origin-model',
        }),
        'old-origin-model',
      );
      await service.waitForTokenUpdates();
      service.setTokenizerFactory(factory);

      await service.recalculateTotalTokens('gpt-5.6-sol', 'codex-alias');

      expect(calls).toStrictEqual([['codex-alias', 'gpt-5.6-sol']]);
      expect(service.getTotalTokens()).toBe(7);
    });

    it('rejects recalculation errors when the active tokenizer denies fallback', async () => {
      const failure = new Error('exact tokenizer unavailable');
      const factory: RuntimeTokenizerFactory = {
        getTokenizer: () => ({
          fallbackPolicy: 'deny',
          countTokens: () => Promise.reject(failure),
        }),
        async estimatePrompt(request) {
          return {
            count: await request.legacyEstimate(),
            method: 'calibrated',
            family: 'legacy-unregistered',
            estimatorVersion: 'core-estimate-tokens-v1',
            assetRevision: 'none',
            projectionRevision: request.projectionRevision,
          };
        },
      };
      service.add(
        createUserMessage('history that must not use a heuristic', {
          timestamp: Date.now(),
        }),
        'old-model',
      );
      await service.waitForTokenUpdates();
      service.setTokenizerFactory(factory);

      await expect(
        service.recalculateTotalTokens('gpt-5.6-sol', 'codex-alias'),
      ).rejects.toBe(failure);

      service.setTokenizerFactory({
        ...factory,
        getTokenizer: () => ({
          fallbackPolicy: 'deny',
          countTokens: () => Promise.resolve(7),
        }),
      });
      await service.recalculateTotalTokens('gpt-5.6-sol', 'codex-alias');
      expect(service.getTotalTokens()).toBe(7);
    });

    it('surfaces asynchronous add failures without poisoning later updates', async () => {
      const failure = new Error('exact tokenizer unavailable');
      let shouldFail = true;
      service.setTokenizerFactory(countingTokenizer(() => shouldFail, failure));

      service.add(createUserMessage('history entry'), 'gpt-5.6-sol');
      await expect(service.waitForTokenUpdates()).rejects.toBe(failure);

      shouldFail = false;
      await service.recalculateTotalTokens('gpt-5.6-sol', 'codex-alias');
      expect(service.getTotalTokens()).toBe(7);
      await expect(service.waitForTokenUpdates()).resolves.toBeUndefined();
    });

    function countingTokenizer(shouldFail: () => boolean, failure: Error) {
      return {
        getTokenizer: () => ({
          fallbackPolicy: 'deny',
          countTokens: () =>
            shouldFail() ? Promise.reject(failure) : Promise.resolve(7),
        }),
        async estimatePrompt(request: { legacyEstimate(): Promise<number> }) {
          return {
            count: await request.legacyEstimate(),
            method: 'calibrated',
            family: 'legacy-unregistered',
            estimatorVersion: 'core-estimate-tokens-v1',
            assetRevision: 'none',
            projectionRevision: request.projectionRevision,
          };
        },
      };
    }

    it('rejects raw-text errors when the active tokenizer denies fallback', async () => {
      const failure = new Error('exact tokenizer unavailable');
      service.setTokenizerFactory({
        getTokenizer: () => ({
          fallbackPolicy: 'deny',
          countTokens: () => Promise.reject(failure),
        }),
        async estimatePrompt(request) {
          return {
            count: await request.legacyEstimate(),
            method: 'calibrated',
            family: 'legacy-unregistered',
            estimatorVersion: 'core-estimate-tokens-v1',
            assetRevision: 'none',
            projectionRevision: request.projectionRevision,
          };
        },
      });

      await expect(
        service.estimateTokensForText('system prompt', 'gpt-5.6-sol'),
      ).rejects.toBe(failure);
    });
  });
});
