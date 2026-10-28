/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { BucketAuthConsentRequest } from '../agent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

describe('adopted agent bucket consent', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it.each([true, false])(
    'delivers OAuth requests to the host and returns its correlated decision %s',
    async (confirmed) => {
      const owners = new Set<OAuthManager>();
      const getTokenStore = OAuthManager.prototype.getTokenStore;
      const capture = spyOn(
        OAuthManager.prototype,
        'getTokenStore',
      ).mockImplementation(function (this: OAuthManager) {
        owners.add(this);
        return getTokenStore.call(this);
      });
      try {
        const route = await openRouteAAgent({
          config: {
            mcpEnabled: false,
            skillsSupport: false,
            recording: { enabled: false },
            telemetry: { enabled: false },
          },
        });
        const observed: BucketAuthConsentRequest[] = [];
        const stop = route.agent.auth.subscribeBucketConsent((request) => {
          observed.push(request);
          route.agent.auth.respondToBucketConsent(
            request.correlationId,
            confirmed,
          );
        });
        const controller = new AbortController();
        try {
          const [oauth] = owners;
          const bus = oauth.runtimeMessageBus;
          if (bus === undefined) throw new Error('OAuth bus was not acquired');
          const pending = bus.requestBucketAuthConfirmation(
            'anthropic',
            'work',
            2,
            3,
            controller.signal,
          );
          expect(observed).toHaveLength(1);
          expect(observed[0]).toMatchObject({
            provider: 'anthropic',
            bucket: 'work',
            bucketIndex: 2,
            totalBuckets: 3,
          });
          expect(await pending).toBe(confirmed);
        } finally {
          controller.abort();
          stop();
          await route.close();
        }
      } finally {
        capture.mockRestore();
      }
    },
  );
});
