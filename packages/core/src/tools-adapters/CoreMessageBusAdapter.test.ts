/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { CoreMessageBusAdapter } from './CoreMessageBusAdapter.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision } from '../policy/types.js';
import { MessageBusType } from '../confirmation-bus/types.js';
import {
  ToolConfirmationOutcome,
  type ToolMessageEvent,
} from '@vybestack/llxprt-code-tools';

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
      expect(received[0].type).toBe(MessageBusType.TOOL_CONFIRMATION_RESPONSE);
      // The payload should carry the original message object
      expect(received[0].payload).toMatchObject({
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

  describe('requestConfirmation argument normalization', () => {
    it.each([
      { label: 'empty array', rawDetails: [], expectedArgs: {} },
      { label: 'null', rawDetails: null, expectedArgs: {} },
      { label: 'raw string', rawDetails: 'raw string', expectedArgs: {} },
      {
        label: 'named tool with plain args',
        rawDetails: { name: 'tool-a', args: { value: 1 } },
        expectedArgs: { value: 1 },
      },
      {
        label: 'non-plain args falls back to details',
        rawDetails: { name: 'tool-b', args: new Date(0), fallback: true },
        expectedArgs: { name: 'tool-b', args: new Date(0), fallback: true },
      },
    ])(
      'normalizes $label before forwarding to the core message bus',
      async ({ rawDetails, expectedArgs }) => {
        const bus = createRealMessageBus();
        const requestConfirmationSpy = vi.spyOn(bus, 'requestConfirmation');
        const adapter = new CoreMessageBusAdapter(bus);

        await expect(adapter.requestConfirmation(rawDetails)).resolves.toBe(
          ToolConfirmationOutcome.ProceedOnce,
        );

        expect(requestConfirmationSpy).toHaveBeenCalledWith(
          expect.objectContaining({ name: expect.any(String) }),
          expectedArgs,
          undefined,
        );
      },
    );
  });

  it('returns Cancel without prompting when the abort signal is already aborted', async () => {
    const bus = createRealMessageBus();
    const requestConfirmationSpy = vi.spyOn(bus, 'requestConfirmation');
    const adapter = new CoreMessageBusAdapter(bus);
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.requestConfirmation({ name: 'tool-a' }, controller.signal),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);
    expect(requestConfirmationSpy).not.toHaveBeenCalled();
  });

  it('returns Cancel when policy denies confirmation', async () => {
    const bus = new MessageBus(
      new PolicyEngine({
        rules: [],
        defaultDecision: PolicyDecision.DENY,
        nonInteractive: false,
      }),
      false,
    );
    const adapter = new CoreMessageBusAdapter(bus);

    await expect(adapter.requestConfirmation({ name: 'tool-a' })).resolves.toBe(
      ToolConfirmationOutcome.Cancel,
    );
  });

  it('forwards serverName when present in confirmation details', async () => {
    const bus = createRealMessageBus();
    const requestConfirmationSpy = vi.spyOn(bus, 'requestConfirmation');
    const adapter = new CoreMessageBusAdapter(bus);

    await adapter.requestConfirmation({
      name: 'tool-a',
      args: { value: 1 },
      serverName: 'mcp-1',
    });

    expect(requestConfirmationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'tool-a' }),
      { value: 1 },
      'mcp-1',
    );
  });
});
