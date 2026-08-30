/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { oauthUIBridge, type OAuthUIEvent } from '@vybestack/llxprt-code-auth';
import { interactiveAuthCoordinator } from '../interactive-auth-coordinator.js';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolvePromise = (): void => {
    throw new Error('Deferred promise was not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

/**
 * @plan PLAN-20260827-ISSUE2562.P05
 * @requirement REQ-2562-4
 */
describe('InteractiveAuthCoordinator OAuth UI events', () => {
  beforeEach(async () => {
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    oauthUIBridge.clearCallback();
    oauthUIBridge.clearPending();
  });

  afterEach(async () => {
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    oauthUIBridge.clearCallback();
    oauthUIBridge.clearPending();
  });

  it('emits credential-free waiting and settled events for the host UI', async () => {
    const hostCompletion = createDeferred();
    const events: OAuthUIEvent[] = [];
    oauthUIBridge.setCallback((event) => {
      events.push(event);
      return events.length;
    });
    interactiveAuthCoordinator.bindHost(() => hostCompletion.promise);

    const outcome = interactiveAuthCoordinator.requestAuth({
      provider: 'codex',
      bucket: 'work',
      requester: { runtimeKind: 'subagent' },
      reason: 'reauthentication-required',
      correlationId: 'ui-event-correlation',
    });
    hostCompletion.resolve();

    await expect(outcome).resolves.toEqual({
      kind: 'succeeded',
      correlationId: 'ui-event-correlation',
    });
    expect(events).toEqual([
      {
        type: 'oauth_waiting',
        provider: 'codex',
        bucket: 'work',
        requesterRuntimeKind: 'subagent',
        correlationId: 'ui-event-correlation',
        waiterCount: 1,
      },
      {
        type: 'oauth_settled',
        provider: 'codex',
        bucket: 'work',
        requesterRuntimeKind: 'subagent',
        correlationId: 'ui-event-correlation',
        waiterCount: 1,
        kind: 'succeeded',
      },
    ]);
    expect(events.some((event) => 'credentials' in event)).toBe(false);
  });

  it('emits one succeeded settlement for each coalesced waiter correlation', async () => {
    const hostCompletion = createDeferred();
    const events: OAuthUIEvent[] = [];
    oauthUIBridge.setCallback((event) => {
      events.push(event);
      return events.length;
    });
    interactiveAuthCoordinator.bindHost(() => hostCompletion.promise);

    const first = interactiveAuthCoordinator.requestAuth({
      provider: 'codex',
      bucket: 'work',
      requester: { runtimeKind: 'subagent' },
      reason: 'authentication-required',
      correlationId: 'coalesced-first',
    });
    const second = interactiveAuthCoordinator.requestAuth({
      provider: 'codex',
      bucket: 'work',
      requester: { runtimeKind: 'agent' },
      reason: 'authentication-required',
      correlationId: 'coalesced-second',
    });
    hostCompletion.resolve();
    await Promise.all([first, second]);

    expect(
      events
        .filter((event) => event.type === 'oauth_settled')
        .map((event) => ({
          correlationId: event.correlationId,
          requesterRuntimeKind: event.requesterRuntimeKind,
          kind: event.kind,
        })),
    ).toEqual([
      {
        correlationId: 'coalesced-first',
        requesterRuntimeKind: 'subagent',
        kind: 'succeeded',
      },
      {
        correlationId: 'coalesced-second',
        requesterRuntimeKind: 'agent',
        kind: 'succeeded',
      },
    ]);
  });

  it('emits cancelled for a detached waiter and succeeded for its coalesced joiner', async () => {
    const hostCompletion = createDeferred();
    const requesterController = new AbortController();
    const events: OAuthUIEvent[] = [];
    oauthUIBridge.setCallback((event) => {
      events.push(event);
      return events.length;
    });
    interactiveAuthCoordinator.bindHost(() => hostCompletion.promise);

    const detached = interactiveAuthCoordinator.requestAuth(
      {
        provider: 'codex',
        bucket: 'work',
        requester: { runtimeKind: 'subagent' },
        reason: 'authentication-required',
        correlationId: 'detached-original',
      },
      { signal: requesterController.signal },
    );
    const remaining = interactiveAuthCoordinator.requestAuth({
      provider: 'codex',
      bucket: 'work',
      requester: { runtimeKind: 'agent' },
      reason: 'authentication-required',
      correlationId: 'remaining-joiner',
    });
    requesterController.abort(new DOMException('Task stopped', 'AbortError'));
    hostCompletion.resolve();
    await Promise.all([detached, remaining]);

    expect(
      events
        .filter((event) => event.type === 'oauth_settled')
        .map((event) => ({
          correlationId: event.correlationId,
          kind: event.kind,
        })),
    ).toEqual([
      { correlationId: 'detached-original', kind: 'cancelled' },
      { correlationId: 'remaining-joiner', kind: 'succeeded' },
    ]);
  });

  it('settles authentication even when the UI callback throws', async () => {
    oauthUIBridge.setCallback(() => {
      throw new Error('UI unavailable');
    });
    interactiveAuthCoordinator.bindHost(async () => undefined);

    const outcome = interactiveAuthCoordinator.requestAuth({
      provider: 'codex',
      bucket: 'default',
      requester: { runtimeKind: 'cli-interactive' },
      reason: 'reauthentication-required',
      correlationId: 'throwing-ui-correlation',
    });

    await expect(outcome).resolves.toEqual({
      kind: 'succeeded',
      correlationId: 'throwing-ui-correlation',
    });
  });
});
