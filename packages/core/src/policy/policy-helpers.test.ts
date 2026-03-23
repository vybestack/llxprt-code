/**
 * @license
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPolicyContextFromInvocation,
  evaluatePolicyDecision,
  handlePolicyDenial,
  publishConfirmationRequest,
} from './policy-helpers.js';
import type { PolicyEngine } from './policy-engine.js';
import { PolicyDecision } from './types.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { MessageBusType } from '../confirmation-bus/types.js';
import type { ToolCallRequestInfo } from '../core/turn.js';
import type { AnyToolInvocation } from '../tools/tools.js';

describe('policy-helpers', () => {
  describe('getPolicyContextFromInvocation', () => {
    it('should fallback to request data for non-BaseToolInvocation', () => {
      const mockInvocation = {
        // Not a BaseToolInvocation - just a plain object
      } as unknown as AnyToolInvocation;

      const request: ToolCallRequestInfo = {
        callId: 'call-123',
        name: 'test-tool',
        args: { baz: 'qux' },
        agentId: 'agent-1',
      };

      const context = getPolicyContextFromInvocation(mockInvocation, request);

      expect(context).toEqual({
        toolName: 'test-tool',
        args: { baz: 'qux' },
      });
    });
  });

  describe('evaluatePolicyDecision', () => {
    it('should call policyEngine.evaluate with correct parameters', () => {
      // Use a plain object that will fall through to the fallback path
      const mockInvocation = {} as unknown as AnyToolInvocation;

      const request: ToolCallRequestInfo = {
        callId: 'call-123',
        name: 'test-tool',
        args: { foo: 'bar' },
        agentId: 'agent-1',
      };

      const mockPolicyEngine = {
        evaluate: vi
          .fn()
          .mockReturnValue({ action: PolicyDecision.ALLOW, reason: '' }),
      } as unknown as PolicyEngine;

      const result = evaluatePolicyDecision(
        mockInvocation,
        request,
        mockPolicyEngine,
      );

      expect(mockPolicyEngine.evaluate).toHaveBeenCalledWith(
        'test-tool',
        { foo: 'bar' },
        undefined, // serverName will be undefined for non-BaseToolInvocation
      );
      expect(result.decision).toEqual({
        action: PolicyDecision.ALLOW,
        reason: '',
      });
      expect(result.context).toEqual({
        toolName: 'test-tool',
        args: { foo: 'bar' },
      });
    });
  });

  describe('handlePolicyDenial', () => {
    let mockSetStatusFn: ReturnType<typeof vi.fn>;
    let mockMessageBus: MessageBus;

    beforeEach(() => {
      mockSetStatusFn = vi.fn();
      mockMessageBus = {
        publish: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      } as unknown as MessageBus;
    });

    it('should call setStatusFn with error response', () => {
      const request: ToolCallRequestInfo = {
        callId: 'call-123',
        name: 'test-tool',
        args: {},
        agentId: 'agent-1',
      };

      const context = {
        toolName: 'test-tool',
        args: { foo: 'bar' },
      };

      handlePolicyDenial(request, context, mockSetStatusFn, mockMessageBus);

      expect(mockSetStatusFn).toHaveBeenCalledWith(
        'call-123',
        'error',
        expect.objectContaining({
          callId: 'call-123',
          error: expect.any(Error),
          responseParts: expect.arrayContaining([
            expect.objectContaining({
              functionResponse: expect.objectContaining({
                id: 'call-123',
                name: 'test-tool',
                response: expect.objectContaining({
                  error: 'Policy denied execution of tool "test-tool".',
                }),
              }),
            }),
          ]),
          resultDisplay: 'Policy denied execution of tool "test-tool".',
          errorType: 'policy_violation',
          agentId: 'agent-1',
        }),
      );
    });

    it('should publish TOOL_POLICY_REJECTION event', () => {
      const request: ToolCallRequestInfo = {
        callId: 'call-123',
        name: 'test-tool',
        args: {},
        agentId: 'agent-1',
      };

      const context = {
        toolName: 'test-tool',
        args: { foo: 'bar' },
        serverName: 'test-server',
      };

      handlePolicyDenial(request, context, mockSetStatusFn, mockMessageBus);

      expect(mockMessageBus.publish).toHaveBeenCalledWith({
        type: MessageBusType.TOOL_POLICY_REJECTION,
        toolCall: {
          name: 'test-tool',
          args: { foo: 'bar' },
        },
        correlationId: expect.any(String),
        reason: 'Policy denied execution of tool "test-tool".',
        serverName: 'test-server',
      });
    });
  });

  describe('publishConfirmationRequest', () => {
    let mockMessageBus: MessageBus;

    beforeEach(() => {
      mockMessageBus = {
        publish: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      } as unknown as MessageBus;
    });

    it('should publish TOOL_CONFIRMATION_REQUEST with correct payload', () => {
      const correlationId = 'corr-123';
      const context = {
        toolName: 'test-tool',
        args: { foo: 'bar' },
        serverName: 'test-server',
      };

      publishConfirmationRequest(correlationId, context, mockMessageBus);

      expect(mockMessageBus.publish).toHaveBeenCalledWith({
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall: {
          name: 'test-tool',
          args: { foo: 'bar' },
        },
        correlationId: 'corr-123',
        serverName: 'test-server',
      });
    });

    it('should handle context without serverName', () => {
      const correlationId = 'corr-123';
      const context = {
        toolName: 'test-tool',
        args: { foo: 'bar' },
      };

      publishConfirmationRequest(correlationId, context, mockMessageBus);

      expect(mockMessageBus.publish).toHaveBeenCalledWith({
        type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        toolCall: {
          name: 'test-tool',
          args: { foo: 'bar' },
        },
        correlationId: 'corr-123',
        serverName: undefined,
      });
    });
  });
});
