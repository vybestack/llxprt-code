/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { BaseToolInvocation, type ToolResult } from './tools.js';
import type {
  IToolMessageBus,
  PublishCapable,
  PublishSubscribeCapable,
} from '../interfaces/IToolMessageBus.js';
import { ToolConfirmationOutcome } from '../types/tool-confirmation-types.js';
import {
  hasPublish,
  hasPublishSubscribe,
} from '../interfaces/IToolMessageBus.js';

interface TestParams extends object {
  path: string;
}

class TestToolInvocation extends BaseToolInvocation<TestParams, ToolResult> {
  constructor(
    params: TestParams,
    messageBus: IToolMessageBus | undefined,
    toolName: string,
  ) {
    super(params, messageBus, toolName);
  }

  override getDescription(): string {
    return 'test';
  }

  async execute(): Promise<ToolResult> {
    return {
      error: undefined,
      result: 'ok',
    } as unknown as ToolResult;
  }

  // expose protected method for testing
  async callPublishPolicyUpdate(
    outcome: ToolConfirmationOutcome,
  ): Promise<void> {
    return this.publishPolicyUpdate(outcome);
  }

  // expose protected method for testing
  async callGetMessageBusDecision(
    abortSignal: AbortSignal,
  ): Promise<'ALLOW' | 'DENY' | 'ASK_USER'> {
    return this.getMessageBusDecision(abortSignal);
  }
}

/** A minimal real bus that exposes publish/subscribe capability. */
class RealPublishSubscribeBus
  implements IToolMessageBus, PublishSubscribeCapable
{
  private subscribers: Map<string, Set<(response: unknown) => void>> =
    new Map();
  private published: Record<string, unknown>[] = [];

  async requestConfirmation(): Promise<{
    confirmed: boolean;
    outcome?: ToolConfirmationOutcome;
  }> {
    return { confirmed: true };
  }

  publish(message: Record<string, unknown>): void {
    this.published.push(message);
    const event = message['type'] as string | undefined;
    if (event) {
      const handlers = this.subscribers.get(event);
      if (handlers) {
        // Simulate async delivery
        for (const handler of handlers) {
          handler(message);
        }
      }
    }
  }

  subscribe(event: string, handler: (response: unknown) => void): void {
    let handlers = this.subscribers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(event, handlers);
    }
    handlers.add(handler);
  }

  unsubscribe(event: string, handler: (response: unknown) => void): void {
    this.subscribers.get(event)?.delete(handler);
  }

  getPublishedMessages(): Record<string, unknown>[] {
    return this.published;
  }
}

/** A minimal bus that only exposes publish capability (no subscribe). */
class RealPublishOnlyBus implements IToolMessageBus, PublishCapable {
  private published: Record<string, unknown>[] = [];

  async requestConfirmation(): Promise<{
    confirmed: boolean;
  }> {
    return { confirmed: true };
  }

  publish(message: Record<string, unknown>): void {
    this.published.push(message);
  }

  getPublishedMessages(): Record<string, unknown>[] {
    return this.published;
  }
}

/** A plain bus with neither publish nor subscribe. */
class PlainBus implements IToolMessageBus {
  async requestConfirmation(): Promise<{
    confirmed: boolean;
  }> {
    return { confirmed: true };
  }
}

describe('BaseToolInvocation message bus capabilities', () => {
  describe('hasPublish type guard', () => {
    it('identifies a bus with publish capability', () => {
      const bus = new RealPublishOnlyBus();
      expect(hasPublish(bus)).toBe(true);
    });

    it('returns false for a plain bus', () => {
      const bus = new PlainBus();
      expect(hasPublish(bus)).toBe(false);
    });
  });

  describe('hasPublishSubscribe type guard', () => {
    it('identifies a bus with both publish and subscribe', () => {
      const bus = new RealPublishSubscribeBus();
      expect(hasPublishSubscribe(bus)).toBe(true);
    });

    it('returns false for publish-only bus', () => {
      const bus = new RealPublishOnlyBus();
      expect(hasPublishSubscribe(bus)).toBe(false);
    });

    it('returns false for plain bus', () => {
      const bus = new PlainBus();
      expect(hasPublishSubscribe(bus)).toBe(false);
    });
  });

  describe('publishPolicyUpdate fallback', () => {
    it('publishes via raw publish when publishPolicyUpdate is absent', async () => {
      const bus = new RealPublishOnlyBus();
      const invocation = new TestToolInvocation(
        { path: '/tmp/test.txt' },
        bus,
        'test-tool',
      );

      await invocation.callPublishPolicyUpdate(
        ToolConfirmationOutcome.ProceedAlways,
      );

      const messages = bus.getPublishedMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]!['type']).toBe('update-policy');
      expect(messages[0]!['toolName']).toBe('test-tool');
    });

    it('publishes with persist when outcome is ProceedAlwaysAndSave', async () => {
      const bus = new RealPublishOnlyBus();
      const invocation = new TestToolInvocation(
        { path: '/tmp/test.txt' },
        bus,
        'test-tool',
      );

      await invocation.callPublishPolicyUpdate(
        ToolConfirmationOutcome.ProceedAlwaysAndSave,
      );

      const messages = bus.getPublishedMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]!['persist']).toBe(true);
    });

    it('does nothing when bus lacks publish capability', async () => {
      const bus = new PlainBus();
      const invocation = new TestToolInvocation(
        { path: '/tmp/test.txt' },
        bus,
        'test-tool',
      );

      // Should not throw, just no-op
      await invocation.callPublishPolicyUpdate(
        ToolConfirmationOutcome.ProceedAlways,
      );
    });

    it('uses typed publishPolicyUpdate when available', async () => {
      let called: {
        outcome: ToolConfirmationOutcome;
        options: unknown;
      } | null = null;
      const bus: IToolMessageBus = {
        async requestConfirmation() {
          return { confirmed: true };
        },
        async publishPolicyUpdate(
          outcome: ToolConfirmationOutcome,
          options?: unknown,
        ) {
          called = { outcome, options };
        },
      };
      const invocation = new TestToolInvocation(
        { path: '/tmp/test.txt' },
        bus,
        'test-tool',
      );

      await invocation.callPublishPolicyUpdate(
        ToolConfirmationOutcome.ProceedAlways,
      );

      expect(called).not.toBeNull();
      expect(called!.outcome).toBe(ToolConfirmationOutcome.ProceedAlways);
    });
  });

  describe('getMessageBusDecision via publish/subscribe capability', () => {
    it('uses publish/subscribe path when capability is present', async () => {
      const bus = new RealPublishSubscribeBus();
      const invocation = new TestToolInvocation(
        { path: '/tmp/test.txt' },
        bus,
        'test-tool',
      );

      const controller = new AbortController();
      // Schedule a confirmation response to be delivered
      setTimeout(() => {
        bus.subscribe('tool-confirmation-response', (response) => {
          // already subscribed, now deliver the response by publishing
        });
        // Simulate the bus delivering a response by calling the registered handler
        const handlers = (
          bus as unknown as {
            subscribers: Map<string, Set<(response: unknown) => void>>;
          }
        ).subscribers.get('tool-confirmation-response');
        if (handlers) {
          for (const handler of handlers) {
            handler({
              correlationId: (
                bus.getPublishedMessages()[0] as { correlationId?: string }
              )?.correlationId,
              confirmed: true,
            });
          }
        }
      }, 10);

      const decision = await invocation.callGetMessageBusDecision(
        controller.signal,
      );

      // Should have published a confirmation request
      expect(bus.getPublishedMessages()).toHaveLength(1);
      expect(bus.getPublishedMessages()[0]!['type']).toBe(
        'tool-confirmation-request',
      );
      expect(decision).toBe('ALLOW');
    });

    it('falls back to requestConfirmation when publish/subscribe is absent', async () => {
      let requestConfirmationCalled = false;
      const bus: IToolMessageBus = {
        async requestConfirmation() {
          requestConfirmationCalled = true;
          return { confirmed: true };
        },
      };
      const invocation = new TestToolInvocation(
        { path: '/tmp/test.txt' },
        bus,
        'test-tool',
      );

      const controller = new AbortController();
      const decision = await invocation.callGetMessageBusDecision(
        controller.signal,
      );

      expect(requestConfirmationCalled).toBe(true);
      expect(decision).toBe('ALLOW');
    });

    it('returns ALLOW when no bus is wired', async () => {
      const invocation = new TestToolInvocation(
        { path: '/tmp/test.txt' },
        undefined,
        'test-tool',
      );

      const controller = new AbortController();
      const decision = await invocation.callGetMessageBusDecision(
        controller.signal,
      );

      expect(decision).toBe('ALLOW');
    });
  });
});
