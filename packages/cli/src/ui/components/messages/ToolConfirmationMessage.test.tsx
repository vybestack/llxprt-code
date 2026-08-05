/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { ToolConfirmationMessage } from './ToolConfirmationMessage.js';
import type {
  ToolCallConfirmationDetails,
  Config,
} from '@vybestack/llxprt-code-core';
import {
  renderWithProviders,
  createMockSettings,
} from '../../../test-utils/render.js';

describe('ToolConfirmationMessage', () => {
  const mockConfig = {
    isTrustedFolder: () => true,
    getIdeMode: () => false,
  } as unknown as Config;

  it('should not display urls if prompt and url are the same', () => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: 'Confirm Web Fetch',
      prompt: 'https://example.com',
      urls: ['https://example.com'],
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={80}
      />,
    );

    expect(lastFrame()).not.toContain('URLs to fetch:');
  });

  it('should display urls if prompt and url are different', () => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: 'Confirm Web Fetch',
      prompt:
        'fetch https://github.com/google/gemini-react/blob/main/README.md',
      urls: [
        'https://raw.githubusercontent.com/google/gemini-react/main/README.md',
      ],
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={80}
      />,
    );

    expect(lastFrame()).toContain('URLs to fetch:');
    // Asserted on the URL alone: RenderInline now emits OSC-8 hyperlink
    // escapes around it, so the rendered frame no longer contains the plain
    // "- <url>" sequence.
    expect(lastFrame()).toContain(
      'https://raw.githubusercontent.com/google/gemini-react/main/README.md',
    );
  });

  describe('with folder trust', () => {
    const editConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'edit',
      title: 'Confirm Edit',
      fileName: 'test.txt',
      filePath: '/test.txt',
      fileDiff: '...diff...',
      originalContent: 'a',
      newContent: 'b',
      onConfirm: vi.fn(),
    };

    const execConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Execution',
      command: 'echo "hello"',
      rootCommand: 'echo',
      rootCommands: ['echo'],
      onConfirm: vi.fn(),
    };

    const infoConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: 'Confirm Web Fetch',
      prompt: 'https://example.com',
      urls: ['https://example.com'],
      onConfirm: vi.fn(),
    };

    const mcpConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'mcp',
      title: 'Confirm MCP Tool',
      serverName: 'test-server',
      toolName: 'test-tool',
      toolDisplayName: 'Test Tool',
      onConfirm: vi.fn(),
    };

    describe.each([
      {
        description: 'for edit confirmations',
        details: editConfirmationDetails,
        alwaysAllowText: 'Allow for this session',
      },
      {
        description: 'for exec confirmations',
        details: execConfirmationDetails,
        alwaysAllowText: 'Allow for this session',
      },
      {
        description: 'for info confirmations',
        details: infoConfirmationDetails,
        alwaysAllowText: 'Allow for this session',
      },
      {
        description: 'for mcp confirmations',
        details: mcpConfirmationDetails,
        alwaysAllowText: 'Allow tool for this session',
      },
    ])('$description', ({ details, alwaysAllowText }) => {
      it('should show "allow always" when folder is trusted', () => {
        const mockConfig = {
          isTrustedFolder: () => true,
          getIdeMode: () => false,
        } as unknown as Config;

        const { lastFrame } = renderWithProviders(
          <ToolConfirmationMessage
            confirmationDetails={details}
            config={mockConfig}
            availableTerminalHeight={30}
            terminalWidth={80}
          />,
        );

        expect(lastFrame()).toContain(alwaysAllowText);
      });

      it('should NOT show "allow always" when folder is untrusted', () => {
        const mockConfig = {
          isTrustedFolder: () => false,
          getIdeMode: () => false,
        } as unknown as Config;

        const { lastFrame } = renderWithProviders(
          <ToolConfirmationMessage
            confirmationDetails={details}
            config={mockConfig}
            availableTerminalHeight={30}
            terminalWidth={80}
          />,
        );

        expect(lastFrame()).not.toContain(alwaysAllowText);
      });
    });

    it('should render confirmation question with theme-respecting color', () => {
      const mockConfig = {
        isTrustedFolder: () => true,
        getIdeMode: () => false,
      } as unknown as Config;

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={execConfirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      // The confirmation question should be colored with theme-respecting success color
      expect(lastFrame()).toContain('Allow execution of:');
    });
  });

  describe('enablePermanentToolApproval setting', () => {
    const editConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'edit',
      title: 'Confirm Edit',
      fileName: 'test.txt',
      filePath: '/test.txt',
      fileDiff: '...diff...',
      originalContent: 'a',
      newContent: 'b',
      onConfirm: vi.fn(),
    };

    it('should NOT show "Allow for all future sessions" when setting is false (default)', () => {
      const mockConfig = {
        isTrustedFolder: () => true,
        getIdeMode: () => false,
      } as unknown as Config;

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={editConfirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
        {
          settings: createMockSettings({
            security: { enablePermanentToolApproval: false },
          }),
        },
      );

      expect(lastFrame()).not.toContain('Allow for all future sessions');
    });

    it('should show "Allow for all future sessions" when setting is true', () => {
      const mockConfig = {
        isTrustedFolder: () => true,
        getIdeMode: () => false,
      } as unknown as Config;

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={editConfirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
        {
          settings: createMockSettings({
            security: { enablePermanentToolApproval: true },
          }),
        },
      );

      expect(lastFrame()).toContain('Allow for all future sessions');
    });
  });

  describe('exec confirmation background note', () => {
    it('renders the background note when isBackground is true (T23 / AC-9)', () => {
      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Confirm Shell Command',
        command: 'npm run dev',
        rootCommand: 'npm',
        rootCommands: ['npm'],
        isBackground: true,
        onConfirm: vi.fn(),
      };

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={confirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      expect(lastFrame()).toContain('Background:');
      expect(lastFrame()).toContain(
        'this command will keep running after the tool returns; its output goes to a log file.',
      );
    });

    it('renders no background note when the flag is absent (T24 / AC-9)', () => {
      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Confirm Shell Command',
        command: 'npm run dev',
        rootCommand: 'npm',
        rootCommands: ['npm'],
        onConfirm: vi.fn(),
      };

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={confirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      expect(lastFrame()).not.toContain(
        'this command will keep running after the tool returns; its output goes to a log file.',
      );
    });

    it('renders both notes with one blank line before the block and none between them (G2a)', () => {
      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Confirm Shell Command',
        command: 'echo hi > out.txt',
        rootCommand: 'echo',
        rootCommands: ['echo'],
        isBackground: true,
        onConfirm: vi.fn(),
      };

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={confirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      const frame = String(lastFrame());
      // Both notes are present.
      expect(frame).toContain(
        'Command contains redirection which can be undesirable.',
      );
      expect(frame).toContain(
        'this command will keep running after the tool returns; its output goes to a log file.',
      );

      const noteLine = frame.indexOf('Note: ');
      const backgroundLine = frame.indexOf('Background: ');
      const tipLine = frame.indexOf('Tip:  ');
      // All three markers render.
      expect(noteLine).toBeGreaterThanOrEqual(0);
      expect(backgroundLine).toBeGreaterThanOrEqual(0);
      expect(tipLine).toBeGreaterThanOrEqual(0);
      // The background note comes after the tip line, not before the note.
      expect(backgroundLine).toBeGreaterThan(tipLine);

      // Exactly one blank line between the command body and the warning
      // block, and no blank line between the redirection tip and the
      // background note.
      const lines = frame.split('\n');
      const tipIndex = lines.findIndex((line) => line.startsWith('Tip:  '));
      const backgroundIndex = lines.findIndex((line) =>
        line.startsWith('Background: '),
      );
      // No blank line between tip and background note (adjacent lines).
      expect(backgroundIndex).toBe(tipIndex + 1);

      // No double blank lines anywhere in the rendered output.
      let consecutiveBlanks = 0;
      let maxConsecutiveBlanks = 0;
      for (const line of lines) {
        if (line.trim() === '') {
          consecutiveBlanks += 1;
          maxConsecutiveBlanks = Math.max(
            maxConsecutiveBlanks,
            consecutiveBlanks,
          );
        } else {
          consecutiveBlanks = 0;
        }
      }
      expect(maxConsecutiveBlanks).toBeLessThanOrEqual(1);
    });

    it('renders a background-only note with a single leading blank line (G2b)', () => {
      const confirmationDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Confirm Shell Command',
        command: 'npm run dev',
        rootCommand: 'npm',
        rootCommands: ['npm'],
        isBackground: true,
        onConfirm: vi.fn(),
      };

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={confirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      const frame = String(lastFrame());
      // Existing T23 assertions still hold.
      expect(frame).toContain('Background:');
      expect(frame).toContain(
        'this command will keep running after the tool returns; its output goes to a log file.',
      );

      const lines = frame.split('\n');
      const backgroundIndex = lines.findIndex((line) =>
        line.startsWith('Background: '),
      );
      // Exactly one blank line precedes the background note (its spacer).
      expect(backgroundIndex).toBeGreaterThan(0);
      expect(lines[backgroundIndex - 1]).toBe('');

      // No double blank lines anywhere.
      let consecutiveBlanks = 0;
      let maxConsecutiveBlanks = 0;
      for (const line of lines) {
        if (line.trim() === '') {
          consecutiveBlanks += 1;
          maxConsecutiveBlanks = Math.max(
            maxConsecutiveBlanks,
            consecutiveBlanks,
          );
        } else {
          consecutiveBlanks = 0;
        }
      }
      expect(maxConsecutiveBlanks).toBeLessThanOrEqual(1);
    });
  });
});
