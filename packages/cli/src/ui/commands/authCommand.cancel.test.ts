/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { oauthUIBridge } from '@vybestack/llxprt-code-auth';
import {
  InteractiveAuthCoordinator,
  type InteractiveAuthChallenge,
} from '@vybestack/llxprt-code-providers/auth.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { authCommand } from './authCommand.js';
import type { MessageActionReturn } from './types.js';

function createChallenge(
  provider = 'codex',
  correlationId = 'cancel-command-correlation',
): InteractiveAuthChallenge {
  return {
    provider,
    bucket: 'work',
    requester: { runtimeKind: 'subagent' },
    reason: 'reauthentication-required',
    correlationId,
  };
}

async function executeCancel(
  coordinator: InteractiveAuthCoordinator,
): Promise<MessageActionReturn> {
  const action = authCommand.action;
  if (!action) {
    throw new Error('Expected /auth to define an action');
  }

  const context = createMockCommandContext({
    oauthControl: {
      getInteractiveAuthSessions: () => coordinator.getActiveSessions(),
      cancelInteractiveAuth: () => coordinator.cancelActiveSessions(),
    },
  });
  const result = await action(context, 'cancel');
  if (!result || result.type !== 'message') {
    throw new Error('Expected /auth cancel to return a message');
  }
  return result;
}

/**
 * @plan PLAN-20260827-ISSUE2562.P05
 * @requirement REQ-2562-4
 */
describe('/auth cancel', () => {
  let coordinator: InteractiveAuthCoordinator;
  beforeEach(async () => {
    coordinator = new InteractiveAuthCoordinator();
    await coordinator.dispose();
    coordinator.unbindHost();
    oauthUIBridge.clearCallback();
    oauthUIBridge.clearPending();
  });

  afterEach(async () => {
    await coordinator.dispose();
    coordinator.unbindHost();
    oauthUIBridge.clearCallback();
    oauthUIBridge.clearPending();
  });

  it('cancels active authentication sessions and reports retry guidance', async () => {
    coordinator.bindHost(
      (_challenge, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const waiter = coordinator.requestAuth(createChallenge());

    const result = await executeCancel(coordinator);

    await expect(waiter).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'cancel-command-correlation',
    });
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Cancelled 1 active authentication session(s). Retry with /auth codex.',
    });
    expect(coordinator.getActiveSessions()).toStrictEqual([]);
  });

  it('lists each cancelled provider once in retry guidance', async () => {
    coordinator.bindHost(
      (_challenge, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const waiters = [
      coordinator.requestAuth(createChallenge('codex', 'cancel-codex-work')),
      coordinator.requestAuth(
        createChallenge('codex', 'cancel-codex-personal'),
      ),
      coordinator.requestAuth(
        createChallenge('claudecode', 'cancel-claudecode'),
      ),
    ];

    const result = await executeCancel(coordinator);

    await Promise.all(waiters);
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Cancelled 2 active authentication session(s). Retry with /auth codex or /auth claudecode.',
    });
  });

  it('reports when there are no active authentication sessions', async () => {
    const result = await executeCancel(coordinator);

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No active authentication sessions.',
    });
  });
});
