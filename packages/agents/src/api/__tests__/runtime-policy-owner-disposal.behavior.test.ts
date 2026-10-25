/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

function subscriptionCount(bus: MessageBus): number {
  return Object.values(MessageBusType).reduce<number>(
    (count, type) => count + bus.listenerCount(type),
    0,
  );
}

describe('RuntimePolicyOwner disposal', () => {
  it('RuntimePolicyOwner disposal leaves zero subscriptions on its message bus', async () => {
    const config = new Config({
      sessionId: 'policy-owner-disposal',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test',
      trustedFolder: true,
    });
    const policy = new RuntimePolicyOwner(config);
    const bus = policy.session.messageBus;
    try {
      expect(subscriptionCount(bus)).toBeGreaterThan(0);

      await policy.dispose();

      expect(subscriptionCount(bus)).toBe(0);
    } finally {
      await policy.dispose();
      await config.dispose();
    }
  });
});
