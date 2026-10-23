/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { MessageBusType } from '@vybestack/llxprt-code-core';
import type { BucketAuthConfirmationRequest } from '@vybestack/llxprt-code-core';
import type { BucketAuthConsentRequest } from '../agent.js';
import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import { buildAgent } from './helpers/agentHarness.js';

describe('Agent auth bucket consent', () => {
  it.each([true, false])(
    'settles the actual acquired requester with the correlated decision %s',
    async (confirmed) => {
      const { agent, cleanup } = await buildAgent('plain-text.jsonl');
      const bus = fixtureAgentResources(agent).messageBus;
      const captured: BucketAuthConfirmationRequest[] = [];
      const stopCapture = bus.subscribe<BucketAuthConfirmationRequest>(
        MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
        (request) => captured.push(request),
      );
      const observed: BucketAuthConsentRequest[] = [];
      const stop = agent.auth.subscribeBucketConsent((request) =>
        observed.push(request),
      );
      try {
        const result = bus.requestBucketAuthConfirmation(
          'anthropic',
          'work',
          2,
          3,
        );
        expect(observed).toHaveLength(1);
        expect(observed[0]).toStrictEqual({
          correlationId: captured[0].correlationId,
          provider: 'anthropic',
          bucket: 'work',
          bucketIndex: 2,
          totalBuckets: 3,
        });
        expect(observed[0]).not.toHaveProperty('type');
        expect(Reflect.set(observed[0], 'bucket', 'mutated')).toBe(false);
        expect(captured[0].bucket).toBe('work');
        agent.auth.respondToBucketConsent(observed[0].correlationId, confirmed);
        expect(await result).toBe(confirmed);
      } finally {
        stop();
        stopCapture();
        await cleanup();
      }
    },
  );

  it('unsubscribes one observer without closing a requester or its peer', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const bus = fixtureAgentResources(agent).messageBus;
    const first: BucketAuthConsentRequest[] = [];
    const peer: BucketAuthConsentRequest[] = [];
    const stop = agent.auth.subscribeBucketConsent((request) =>
      first.push(request),
    );
    const stopPeer = agent.auth.subscribeBucketConsent((request) =>
      peer.push(request),
    );
    try {
      const pending = bus.requestBucketAuthConfirmation(
        'anthropic',
        'first',
        1,
        2,
      );
      stop();
      stop();
      agent.auth.respondToBucketConsent(peer[0].correlationId, true);
      expect(await pending).toBe(true);
      const next = bus.requestBucketAuthConfirmation(
        'anthropic',
        'second',
        2,
        2,
      );
      expect(first).toHaveLength(1);
      expect(peer).toHaveLength(2);
      agent.auth.respondToBucketConsent(peer[1].correlationId, false);
      expect(await next).toBe(false);
    } finally {
      stopPeer();
      await cleanup();
    }
  });

  it('does not revive a closed requester when its UI replies late', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    const bus = fixtureAgentResources(agent).messageBus;
    const requests: BucketAuthConsentRequest[] = [];
    const stop = agent.auth.subscribeBucketConsent((request) =>
      requests.push(request),
    );
    try {
      const closed = bus.requestBucketAuthConfirmation(
        'anthropic',
        'expired',
        1,
        2,
      );
      bus.cancelPendingConfirmations();
      expect(await closed).toBe(false);
      const current = bus.requestBucketAuthConfirmation(
        'anthropic',
        'current',
        2,
        2,
      );
      let settled = false;
      void current.then(() => {
        settled = true;
      });
      agent.auth.respondToBucketConsent(requests[0].correlationId, true);
      await Promise.resolve();
      expect(settled).toBe(false);
      agent.auth.respondToBucketConsent(requests[1].correlationId, false);
      expect(await current).toBe(false);
      expect(await closed).toBe(false);
    } finally {
      stop();
      await cleanup();
    }
  });
});
