import { describe, expect, it } from 'vitest';
import type {
  ToolApprovalOutcome,
  ToolApprovalDetails,
  ToolApprovalModalProps,
} from './ToolApprovalModal';
import type { ThemeDefinition } from '../../features/theme';
import type { ToolConfirmationType } from '../../types/events';

describe('ToolApprovalModal', () => {
  const mockTheme: ThemeDefinition = {
    slug: 'test',
    name: 'Test Theme',
    kind: 'dark',
    colors: {
      background: '#000000',
      text: {
        primary: '#ffffff',
        muted: '#888888',
        user: '#00ff00',
        responder: '#0088ff',
        thinking: '#ff8800',
        tool: '#ff00ff',
      },
      input: {
        fg: '#ffffff',
        bg: '#000000',
        border: '#333333',
        placeholder: '#666666',
      },
      panel: {
        bg: '#111111',
        border: '#333333',
      },
      status: {
        fg: '#ffffff',
      },
      accent: {
        primary: '#00ffff',
      },
      selection: {
        fg: '#000000',
        bg: '#ffffff',
      },
      diff: {
        addedBg: '#003300',
        addedFg: '#00ff00',
        removedBg: '#330000',
        removedFg: '#ff0000',
      },
      message: {
        userBorder: '#00ff00',
        systemBorder: '#888888',
        systemText: '#888888',
      },
    },
  };

  describe('ToolApprovalOutcome type', () => {
    it('accepts valid outcome values', () => {
      const allowOnce: ToolApprovalOutcome = 'allow_once';
      const allowAlways: ToolApprovalOutcome = 'allow_always';
      const suggestEdit: ToolApprovalOutcome = 'suggest_edit';
      const cancel: ToolApprovalOutcome = 'cancel';

      expect(allowOnce).toBe('allow_once');
      expect(allowAlways).toBe('allow_always');
      expect(suggestEdit).toBe('suggest_edit');
      expect(cancel).toBe('cancel');
    });
  });

  describe('ToolApprovalDetails type', () => {
    it('accepts required properties for edit confirmation', () => {
      const details: ToolApprovalDetails = {
        callId: 'call-123',
        toolName: 'write_file',
        confirmationType: 'edit' as ToolConfirmationType,
        question: 'Allow file write?',
        preview: 'Writing to /path/to/file.ts',
        params: { path: '/path/to/file.ts', content: 'new content' },
        canAllowAlways: true,
      };

      expect(details.callId).toBe('call-123');
      expect(details.toolName).toBe('write_file');
      expect(details.confirmationType).toBe('edit');
      expect(details.canAllowAlways).toBe(true);
    });

    it('accepts exec confirmation type', () => {
      const details: ToolApprovalDetails = {
        callId: 'call-456',
        toolName: 'run_command',
        confirmationType: 'exec' as ToolConfirmationType,
        question: 'Allow command execution?',
        preview: 'npm install express',
        params: { command: 'npm install express' },
        canAllowAlways: false,
      };

      expect(details.confirmationType).toBe('exec');
      expect(details.preview).toBe('npm install express');
    });

    it('accepts mcp confirmation type', () => {
      const details: ToolApprovalDetails = {
        callId: 'call-789',
        toolName: 'mcp_tool',
        confirmationType: 'mcp' as ToolConfirmationType,
        question: 'Allow MCP tool call?',
        preview: 'Calling external service',
        params: { serverName: 'my-mcp-server', action: 'query' },
        canAllowAlways: true,
      };

      expect(details.confirmationType).toBe('mcp');
    });

    it('accepts info confirmation type', () => {
      const details: ToolApprovalDetails = {
        callId: 'call-info',
        toolName: 'read_file',
        confirmationType: 'info' as ToolConfirmationType,
        question: 'Allow file read?',
        preview: 'Reading /path/to/file.ts',
        params: { path: '/path/to/file.ts' },
        canAllowAlways: true,
      };

      expect(details.confirmationType).toBe('info');
    });
  });

  describe('ToolApprovalModalProps type', () => {
    it('accepts required props', () => {
      const details: ToolApprovalDetails = {
        callId: 'call-123',
        toolName: 'write_file',
        confirmationType: 'edit' as ToolConfirmationType,
        question: 'Allow file write?',
        preview: 'Writing to file',
        params: {},
        canAllowAlways: true,
      };

      const props: ToolApprovalModalProps = {
        details,
        onDecision: () => {},
        onClose: () => {},
      };

      expect(props.details).toBe(details);
      expect(typeof props.onDecision).toBe('function');
      expect(typeof props.onClose).toBe('function');
    });

    it('accepts optional theme prop', () => {
      const details: ToolApprovalDetails = {
        callId: 'call-123',
        toolName: 'write_file',
        confirmationType: 'edit' as ToolConfirmationType,
        question: 'Allow file write?',
        preview: 'Writing to file',
        params: {},
        canAllowAlways: false,
      };

      const props: ToolApprovalModalProps = {
        details,
        onDecision: () => {},
        onClose: () => {},
        theme: mockTheme,
      };

      expect(props.theme).toBe(mockTheme);
    });

    it('onDecision callback receives correct arguments', () => {
      let receivedCallId: string | null = null;
      let receivedOutcome: ToolApprovalOutcome | null = null;

      const details: ToolApprovalDetails = {
        callId: 'call-test',
        toolName: 'test_tool',
        confirmationType: 'exec' as ToolConfirmationType,
        question: 'Allow?',
        preview: 'Test preview',
        params: {},
        canAllowAlways: true,
      };

      const props: ToolApprovalModalProps = {
        details,
        onDecision: (callId: string, outcome: ToolApprovalOutcome) => {
          receivedCallId = callId;
          receivedOutcome = outcome;
        },
        onClose: () => {},
      };

      props.onDecision('call-test', 'allow_once');

      expect(receivedCallId).toBe('call-test');
      expect(receivedOutcome).toBe('allow_once');
    });
  });
});
