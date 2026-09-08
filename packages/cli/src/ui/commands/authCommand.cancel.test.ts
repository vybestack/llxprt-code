/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { oauthUIBridge } from '@vybestack/llxprt-code-auth';
import {
  interactiveAuthCoordinator,
  type InteractiveAuthChallenge,
} from '@vybestack/llxprt-code-providers/auth.js';
import { authCommand } from './authCommand.js';
import type { CommandContext, MessageActionReturn } from './types.js';

const commandContext = {} as CommandContext;

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

async function executeCancel(): Promise<MessageActionReturn> {
  const action = authCommand.action;
  if (!action) {
    throw new Error('Expected /auth to define an action');
  }

  const result = await action(commandContext, 'cancel');
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

  it('cancels active authentication sessions and reports retry guidance', async () => {
    interactiveAuthCoordinator.bindHost(
      (_challenge, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const waiter = interactiveAuthCoordinator.requestAuth(createChallenge());

    const result = await executeCancel();

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
    expect(interactiveAuthCoordinator.getActiveSessions()).toStrictEqual([]);
  });

  it('lists each cancelled provider once in retry guidance', async () => {
    interactiveAuthCoordinator.bindHost(
      (_challenge, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const waiters = [
      interactiveAuthCoordinator.requestAuth(
        createChallenge('codex', 'cancel-codex-work'),
      ),
      interactiveAuthCoordinator.requestAuth(
        createChallenge('codex', 'cancel-codex-personal'),
      ),
      interactiveAuthCoordinator.requestAuth(
        createChallenge('claudecode', 'cancel-claudecode'),
      ),
    ];

    const result = await executeCancel();

    await Promise.all(waiters);
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Cancelled 2 active authentication session(s). Retry with /auth codex or /auth claudecode.',
    });
  });

  it('reports when there are no active authentication sessions', async () => {
    const result = await executeCancel();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No active authentication sessions.',
    });
  });
});
