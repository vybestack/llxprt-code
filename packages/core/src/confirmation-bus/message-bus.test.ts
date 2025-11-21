import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageBus } from './message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision, type PolicyEngineConfig } from '../policy/types.js';
import { MessageBusType, type ToolConfirmationRequest } from './types.js';
import type { FunctionCall } from '@google/genai';
import { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';

describe('MessageBus', () => {
  let messageBus: MessageBus;
  let policyEngine: PolicyEngine;

  beforeEach(() => {
    policyEngine = new PolicyEngine();
    messageBus = new MessageBus(policyEngine, false);
  });

  afterEach(() => {
    messageBus.removeAllListeners();
  });

  describe('constructor', () => {
    it('initializes with policy engine', () => {
      expect(messageBus).toBeDefined();
    });

    it('sets max listeners to prevent warnings', () => {
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(0);
    });
  });

  describe('publish and subscribe', () => {
    it('publishes messages to subscribers', () => {
      const handler = vi.fn();

      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler);

      const message: ToolConfirmationRequest = {
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall: { name: 'edit', args: {} },
        correlationId: 'test-id',
      };

      messageBus.publish(message);

      expect(handler).toHaveBeenCalledWith(message);
    });

    it('supports multiple subscribers for same message type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler1);
      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler2);

      const message: ToolConfirmationRequest = {
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall: { name: 'edit', args: {} },
        correlationId: 'test-id',
      };

      messageBus.publish(message);

      expect(handler1).toHaveBeenCalledWith(message);
      expect(handler2).toHaveBeenCalledWith(message);
    });

    it('does not call subscribers of different message types', () => {
      const handler = vi.fn();

      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_RESPONSE, handler);

      const message: ToolConfirmationRequest = {
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall: { name: 'edit', args: {} },
        correlationId: 'test-id',
      };

      messageBus.publish(message);

      expect(handler).not.toHaveBeenCalled();
    });

    it('returns unsubscribe function', () => {
      const handler = vi.fn();

      const unsubscribe = messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        handler,
      );

      const message: ToolConfirmationRequest = {
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall: { name: 'edit', args: {} },
        correlationId: 'test-id',
      };

      messageBus.publish(message);
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      messageBus.publish(message);
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
    });
  });

  describe('requestConfirmation', () => {
    describe('ALLOW policy', () => {
      it('returns true immediately for ALLOW decision', async () => {
        const config: PolicyEngineConfig = {
          rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const toolCall: FunctionCall = { name: 'edit', args: {} };
        const result = await messageBus.requestConfirmation(toolCall, {});

        expect(result).toBe(true);
      });

      it('does not publish confirmation request for ALLOW', async () => {
        const config: PolicyEngineConfig = {
          rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const handler = vi.fn();
        messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler);

        const toolCall: FunctionCall = { name: 'edit', args: {} };
        await messageBus.requestConfirmation(toolCall, {});

        expect(handler).not.toHaveBeenCalled();
      });
    });

    describe('DENY policy', () => {
      it('returns false immediately for DENY decision', async () => {
        const config: PolicyEngineConfig = {
          rules: [{ toolName: 'shell', decision: PolicyDecision.DENY }],
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const toolCall: FunctionCall = { name: 'shell', args: {} };
        const result = await messageBus.requestConfirmation(toolCall, {});

        expect(result).toBe(false);
      });

      it('publishes policy rejection message for DENY', async () => {
        const config: PolicyEngineConfig = {
          rules: [{ toolName: 'shell', decision: PolicyDecision.DENY }],
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const handler = vi.fn();
        messageBus.subscribe(MessageBusType.TOOL_POLICY_REJECTION, handler);

        const toolCall: FunctionCall = { name: 'shell', args: {} };
        await messageBus.requestConfirmation(toolCall, {});

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: MessageBusType.TOOL_POLICY_REJECTION,
            toolCall,
            reason: 'Policy denied execution',
          }),
        );
      });
    });

    describe('ASK_USER policy', () => {
      it('publishes confirmation request for ASK_USER', async () => {
        const config: PolicyEngineConfig = {
          defaultDecision: PolicyDecision.ASK_USER,
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const handler = vi.fn();
        messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler);

        const toolCall: FunctionCall = { name: 'edit', args: {} };
        const confirmationPromise = messageBus.requestConfirmation(
          toolCall,
          {},
        );

        // Need to wait a tick for the message to be published
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
            toolCall,
          }),
        );

        // Respond to unblock the promise
        const request = handler.mock.calls[0][0] as ToolConfirmationRequest;
        messageBus.respondToConfirmation(
          request.correlationId,
          ToolConfirmationOutcome.ProceedOnce,
        );

        const result = await confirmationPromise;
        expect(result).toBe(true);
      });

      it('resolves when user confirms', async () => {
        const config: PolicyEngineConfig = {
          defaultDecision: PolicyDecision.ASK_USER,
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const handler = vi.fn();
        messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler);

        const toolCall: FunctionCall = { name: 'edit', args: {} };
        const confirmationPromise = messageBus.requestConfirmation(
          toolCall,
          {},
        );

        await new Promise((resolve) => setTimeout(resolve, 0));

        const request = handler.mock.calls[0][0] as ToolConfirmationRequest;
        messageBus.respondToConfirmation(
          request.correlationId,
          ToolConfirmationOutcome.ProceedOnce,
        );

        const result = await confirmationPromise;
        expect(result).toBe(true);
      });

      it('resolves false when user denies', async () => {
        const config: PolicyEngineConfig = {
          defaultDecision: PolicyDecision.ASK_USER,
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const handler = vi.fn();
        messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler);

        const toolCall: FunctionCall = { name: 'edit', args: {} };
        const confirmationPromise = messageBus.requestConfirmation(
          toolCall,
          {},
        );

        await new Promise((resolve) => setTimeout(resolve, 0));

        const request = handler.mock.calls[0][0] as ToolConfirmationRequest;
        messageBus.respondToConfirmation(
          request.correlationId,
          ToolConfirmationOutcome.Cancel,
        );

        const result = await confirmationPromise;
        expect(result).toBe(false);
      });

      it('only responds to matching correlation ID', async () => {
        const config: PolicyEngineConfig = {
          defaultDecision: PolicyDecision.ASK_USER,
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const handler = vi.fn();
        messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler);

        const toolCall: FunctionCall = { name: 'edit', args: {} };
        const confirmationPromise = messageBus.requestConfirmation(
          toolCall,
          {},
        );

        await new Promise((resolve) => setTimeout(resolve, 0));

        // Respond with wrong correlation ID
        messageBus.respondToConfirmation(
          'wrong-id',
          ToolConfirmationOutcome.ProceedOnce,
        );

        // Should not resolve yet
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Now respond with correct ID
        const request = handler.mock.calls[0][0] as ToolConfirmationRequest;
        messageBus.respondToConfirmation(
          request.correlationId,
          ToolConfirmationOutcome.ProceedOnce,
        );

        const result = await confirmationPromise;
        expect(result).toBe(true);
      });

      it('times out after 5 minutes and returns false', async () => {
        vi.useFakeTimers();

        const config: PolicyEngineConfig = {
          defaultDecision: PolicyDecision.ASK_USER,
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const toolCall: FunctionCall = { name: 'edit', args: {} };
        const confirmationPromise = messageBus.requestConfirmation(
          toolCall,
          {},
        );

        // Fast-forward 5 minutes
        vi.advanceTimersByTime(300000);

        const result = await confirmationPromise;
        expect(result).toBe(false);

        vi.useRealTimers();
      });
    });

    describe('server name validation', () => {
      it('passes server name to policy engine', async () => {
        const config: PolicyEngineConfig = {
          rules: [
            {
              toolName: 'my-server__tool',
              decision: PolicyDecision.ALLOW,
            },
          ],
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        const toolCall: FunctionCall = { name: 'my-server__tool', args: {} };
        const result = await messageBus.requestConfirmation(
          toolCall,
          {},
          'my-server',
        );

        expect(result).toBe(true);
      });

      it('denies spoofed server names', async () => {
        const config: PolicyEngineConfig = {
          rules: [{ decision: PolicyDecision.ALLOW }],
        };
        policyEngine = new PolicyEngine(config);
        messageBus = new MessageBus(policyEngine);

        // Tool claims to be from 'trusted-server' but actually from 'malicious-server'
        const toolCall: FunctionCall = {
          name: 'trusted-server__tool',
          args: {},
        };
        const result = await messageBus.requestConfirmation(
          toolCall,
          {},
          'malicious-server',
        );

        expect(result).toBe(false);
      });
    });
  });

  describe('respondToConfirmation', () => {
    it('publishes confirmation response message', () => {
      const handler = vi.fn();
      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_RESPONSE, handler);

      messageBus.respondToConfirmation(
        'test-id',
        ToolConfirmationOutcome.ProceedOnce,
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
          correlationId: 'test-id',
          outcome: ToolConfirmationOutcome.ProceedOnce,
          confirmed: true,
        }),
      );
    });

    it('includes requiresUserConfirmation flag when provided', () => {
      const handler = vi.fn();
      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_RESPONSE, handler);

      messageBus.respondToConfirmation(
        'test-id',
        ToolConfirmationOutcome.ProceedAlways,
        undefined,
        true,
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
          correlationId: 'test-id',
          outcome: ToolConfirmationOutcome.ProceedAlways,
          confirmed: true,
          requiresUserConfirmation: true,
        }),
      );
    });
  });

  describe('removeAllListeners', () => {
    it('removes all event listeners', () => {
      const handler = vi.fn();

      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler);
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBeGreaterThan(0);

      messageBus.removeAllListeners();
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(0);
    });
  });

  describe('listenerCount', () => {
    it('returns number of listeners for a message type', () => {
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(0);

      const unsubscribe1 = messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        vi.fn(),
      );
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(1);

      const unsubscribe2 = messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        vi.fn(),
      );
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(2);

      unsubscribe1();
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(1);

      unsubscribe2();
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(0);
    });
  });

  describe('debug mode', () => {
    it('logs messages when debug mode enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      const debugBus = new MessageBus(policyEngine, true);

      const message: ToolConfirmationRequest = {
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall: { name: 'edit', args: {} },
        correlationId: 'test-id',
      };

      debugBus.publish(message);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MessageBus] Publishing'),
        message,
      );

      consoleSpy.mockRestore();
    });

    it('does not log when debug mode disabled', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      const message: ToolConfirmationRequest = {
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall: { name: 'edit', args: {} },
        correlationId: 'test-id',
      };

      messageBus.publish(message);

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
