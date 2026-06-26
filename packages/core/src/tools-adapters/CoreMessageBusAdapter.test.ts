/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { CoreMessageBusAdapter } from './CoreMessageBusAdapter.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision } from '../policy/types.js';
import { MessageBusType } from '../confirmation-bus/types.js';
import type { ToolMessageEvent } from '@vybestack/llxprt-code-tools';

function createRealMessageBus(): MessageBus {
  return new MessageBus(
    new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.ALLOW,
      nonInteractive: false,
    }),
    false,
  );
}

describe('CoreMessageBusAdapter', () => {
  describe('subscribe round-trip', () => {
    it('delivers published messages to subscribers as ToolMessageEvents', () => {
      const bus = createRealMessageBus();
      const adapter = new CoreMessageBusAdapter(bus);

      const received: ToolMessageEvent[] = [];
      adapter.subscribe((event) => {
        received.push(event);
      });

      // Publish a real message through the real MessageBus
      bus.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        confirmed: true,
        correlationId: 'corr-1',
      });

      expect(received).toHaveLength(1);
      expect(received[0]!.type).toBe(MessageBusType.TOOL_CONFIRMATION_RESPONSE);
      // The payload should carry the original message object
      expect(received[0]!.payload).toMatchObject({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        confirmed: true,
        correlationId: 'corr-1',
      });
    });

    it('unsubscribe stops delivering messages', () => {
      const bus = createRealMessageBus();
      const adapter = new CoreMessageBusAdapter(bus);

      const received: ToolMessageEvent[] = [];
      const unsubscribe = adapter.subscribe((event) => {
        received.push(event);
      });

      bus.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        confirmed: true,
        correlationId: 'corr-1',
      });
      expect(received).toHaveLength(1);

      unsubscribe();

      bus.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        confirmed: false,
        correlationId: 'corr-2',
      });
      expect(received).toHaveLength(1);
    });
  });
});
