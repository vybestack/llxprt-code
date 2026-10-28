/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, expect, it } from 'bun:test';
import { MessageBus, MessageBusType } from '@vybestack/llxprt-code-core';
import type { BucketAuthConfirmationRequest } from '@vybestack/llxprt-code-core';
import { renderWithProviders, waitFor } from '../../__tests__/render.js';
import { createConsentOwner } from '../../__tests__/ui-consent-hook-owners.js';
import { BucketAuthConfirmation } from './BucketAuthConfirmation.js';

describe('bucket authentication consent UI', () => {
  it.each([true, false])(
    'renders the real request and returns decision %s to its requester',
    async (confirmed) => {
      const bus = new MessageBus();
      const auth = createConsentOwner(bus);
      const captured: BucketAuthConfirmationRequest[] = [];
      const stop = bus.subscribe<BucketAuthConfirmationRequest>(
        MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
        (request) => captured.push(request),
      );
      const view = renderWithProviders(
        <BucketAuthConfirmation
          subscribeBucketConsent={auth.subscribeBucketConsent.bind(auth)}
          respondToBucketConsent={auth.respondToBucketConsent.bind(auth)}
        />,
      );
      try {
        let result = Promise.resolve(false);
        await act(async () => {
          result = bus.requestBucketAuthConfirmation('anthropic', 'work', 2, 3);
        });
        expect(view.lastFrame()).toContain('Bucket 2 of 3: work');
        expect(view.lastFrame()).toContain('Provider: anthropic');
        expect(captured).toHaveLength(1);
        view.stdin.write(confirmed ? '\r' : '\u001b');
        await waitFor(() =>
          expect(view.lastFrame()).not.toContain('OAuth Bucket Authentication'),
        );
        expect(await result).toBe(confirmed);
      } finally {
        view.unmount();
        stop();
        bus.cancelPendingConfirmations();
      }
    },
  );

  it('releases only its subscription on unmount and leaves another observer and requester alive', async () => {
    const bus = new MessageBus();
    const auth = createConsentOwner(bus);
    const requests: BucketAuthConfirmationRequest[] = [];
    const stop = bus.subscribe<BucketAuthConfirmationRequest>(
      MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
      (request) => requests.push(request),
    );
    const peerRequests: string[] = [];
    const stopPeer = auth.subscribeBucketConsent((request) =>
      peerRequests.push(request.correlationId),
    );
    const view = renderWithProviders(
      <BucketAuthConfirmation
        subscribeBucketConsent={auth.subscribeBucketConsent.bind(auth)}
        respondToBucketConsent={auth.respondToBucketConsent.bind(auth)}
      />,
    );
    try {
      let pending = Promise.resolve(false);
      await act(async () => {
        pending = bus.requestBucketAuthConfirmation('anthropic', 'first', 1, 2);
      });
      view.unmount();
      auth.respondToBucketConsent(requests[0].correlationId, true);
      expect(await pending).toBe(true);
      const next = bus.requestBucketAuthConfirmation(
        'anthropic',
        'second',
        2,
        2,
      );
      expect(peerRequests).toHaveLength(2);
      auth.respondToBucketConsent(requests[1].correlationId, false);
      expect(await next).toBe(false);
      expect(
        bus.listenerCount(MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST),
      ).toBe(2);
    } finally {
      stopPeer();
      stop();
      bus.cancelPendingConfirmations();
    }
  });
});
