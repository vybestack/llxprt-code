import { describe, expect, it } from 'vitest';
import type { PendingApproval, UseToolApprovalResult } from './useToolApproval';
import type { ToolConfirmationType } from '../types/events';
import type { ToolApprovalOutcome } from '../ui/components/ChatLayout';

describe('useToolApproval', () => {
  describe('PendingApproval type', () => {
    it('extends ToolApprovalDetails with correlationId', () => {
      const approval: PendingApproval = {
        callId: 'call-123',
        toolName: 'write_file',
        confirmationType: 'edit' as ToolConfirmationType,
        question: 'Allow file write?',
        preview: 'Writing to /path/to/file.ts',
        params: { path: '/path/to/file.ts' },
        canAllowAlways: true,
        correlationId: 'corr-456',
      };

      expect(approval.callId).toBe('call-123');
      expect(approval.correlationId).toBe('corr-456');
      expect(approval.toolName).toBe('write_file');
    });

    it('supports all confirmation types', () => {
      const confirmationTypes: ToolConfirmationType[] = [
        'edit',
        'exec',
        'mcp',
        'info',
      ];

      for (const type of confirmationTypes) {
        const approval: PendingApproval = {
          callId: `call-${type}`,
          toolName: `${type}_tool`,
          confirmationType: type,
          question: `Allow ${type}?`,
          preview: `Preview for ${type}`,
          params: {},
          canAllowAlways: true,
          correlationId: `corr-${type}`,
        };

        expect(approval.confirmationType).toBe(type);
      }
    });
  });

  describe('UseToolApprovalResult type', () => {
    it('has correct shape', () => {
      const mockResult: UseToolApprovalResult = {
        pendingApproval: null,
        queueApproval: () => {},
        queueApprovalFromScheduler: () => {},
        handleDecision: () => {},
        clearApproval: () => {},
      };

      expect(mockResult.pendingApproval).toBeNull();
      expect(typeof mockResult.queueApproval).toBe('function');
      expect(typeof mockResult.queueApprovalFromScheduler).toBe('function');
      expect(typeof mockResult.handleDecision).toBe('function');
      expect(typeof mockResult.clearApproval).toBe('function');
    });

    it('pendingApproval can be a PendingApproval object', () => {
      const approval: PendingApproval = {
        callId: 'call-789',
        toolName: 'run_command',
        confirmationType: 'exec' as ToolConfirmationType,
        question: 'Allow command?',
        preview: 'npm test',
        params: { command: 'npm test' },
        canAllowAlways: false,
        correlationId: 'corr-789',
      };

      const mockResult: UseToolApprovalResult = {
        pendingApproval: approval,
        queueApproval: () => {},
        queueApprovalFromScheduler: () => {},
        handleDecision: () => {},
        clearApproval: () => {},
      };

      expect(mockResult.pendingApproval).toBe(approval);
      expect(mockResult.pendingApproval?.toolName).toBe('run_command');
    });

    it('queueApproval accepts PendingApproval', () => {
      let queuedApproval: PendingApproval | null = null;

      const mockResult: UseToolApprovalResult = {
        pendingApproval: null,
        queueApproval: (approval: PendingApproval) => {
          queuedApproval = approval;
        },
        queueApprovalFromScheduler: () => {},
        handleDecision: () => {},
        clearApproval: () => {},
      };

      const approval: PendingApproval = {
        callId: 'call-queue',
        toolName: 'test_tool',
        confirmationType: 'info' as ToolConfirmationType,
        question: 'Allow?',
        preview: 'Test',
        params: {},
        canAllowAlways: true,
        correlationId: 'corr-queue',
      };

      mockResult.queueApproval(approval);

      expect(queuedApproval).toBe(approval);
    });

    it('handleDecision receives callId and outcome', () => {
      let receivedCallId: string | null = null;
      let receivedOutcome: ToolApprovalOutcome | null = null;

      const mockResult: UseToolApprovalResult = {
        pendingApproval: null,
        queueApproval: () => {},
        queueApprovalFromScheduler: () => {},
        handleDecision: (callId: string, outcome) => {
          receivedCallId = callId;
          receivedOutcome = outcome;
        },
        clearApproval: () => {},
      };

      mockResult.handleDecision('call-decision', 'allow_always');

      expect(receivedCallId).toBe('call-decision');
      expect(receivedOutcome).toBe('allow_always');
    });
  });
});
