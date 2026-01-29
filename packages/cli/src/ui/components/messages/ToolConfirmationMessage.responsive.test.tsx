/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../../test-utils/render.js';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from 'vitest';
import { ToolConfirmationMessage } from './ToolConfirmationMessage.js';
import {
  ToolCallConfirmationDetails,
  Config,
} from '@vybestack/llxprt-code-core';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { KeypressProvider } from '../../contexts/KeypressContext.js';

vi.mock('../../hooks/useTerminalSize.js');

describe('ToolConfirmationMessage Responsive Behavior', () => {
  let mockUseTerminalSize: MockedFunction<typeof useTerminalSize>;

  const mockConfig = {
    isTrustedFolder: () => true,
    getIdeMode: () => false,
  } as unknown as Config;

  // Helper function for waiting between input events
  const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

  const mockExecuteDetails: ToolCallConfirmationDetails = {
    type: 'exec',
    title: 'Execute Command',
    rootCommand: 'npm',
    command:
      'npm install --save-dev typescript @types/node jest ts-jest @types/jest eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier',
    onConfirm: vi.fn(),
  };

  const mockInfoDetails: ToolCallConfirmationDetails = {
    type: 'info',
    title: 'Confirm Web Fetch',
    prompt:
      'fetch documentation from https://docs.example.com/api/users and https://docs.example.com/api/authentication',
    urls: [
      'https://docs.example.com/api/users',
      'https://docs.example.com/api/authentication',
      'https://docs.example.com/api/permissions',
      'https://docs.example.com/api/security',
    ],
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTerminalSize = useTerminalSize as MockedFunction<
      typeof useTerminalSize
    >;
  });

  describe('NARROW width behavior (< 80 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 60, rows: 20 });
    });

    it('should show summary with details toggle for exec commands at narrow width', () => {
      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={mockExecuteDetails}
          config={mockConfig}
          terminalWidth={60}
          isFocused={true}
        />,
      );

      const output = lastFrame();

      // Should show basic command info
      expect(output).toContain('npm');
      expect(output).toContain('Allow execution');

      // Should show details toggle prompt
      expect(output).toContain("Press 'd' to see full details");

      // Should NOT show full command initially
      expect(output).not.toContain('npm install --save-dev typescript');
    });

    it('should show summary with details toggle for info commands at narrow width', () => {
      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={mockInfoDetails}
          config={mockConfig}
          terminalWidth={60}
          isFocused={true}
        />,
      );

      const output = lastFrame();

      // Should show basic info
      expect(output).toContain('fetch documentation');
      expect(output).toContain('Do you want to proceed');

      // Should show details toggle prompt
      expect(output).toContain("Press 'd' to see full details");

      // Should NOT show all URLs initially
      expect(output).not.toContain('https://docs.example.com/api/permissions');
      expect(output).not.toContain('https://docs.example.com/api/security');
    });

    it('should toggle to show full details when d key is pressed', async () => {
      const { lastFrame, stdin } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={mockExecuteDetails}
          config={mockConfig}
          terminalWidth={60}
          isFocused={true}
        />,
      );
      await wait();

      // Initial state - should show summary
      let output = lastFrame();
      expect(output).toContain("Press 'd' to see full details");
      expect(output).not.toContain('npm install --save-dev typescript');

      // Press 'd' key
      stdin.write('d');
      await wait();

      // After pressing 'd' - should show full details
      output = lastFrame();
      expect(output).not.toContain("Press 'd' to see full details");
      expect(output).toContain('npm install --save-dev typescript');
      expect(output).toContain('Full Parameters:');
    });

    it('should toggle back to summary when d key is pressed again', async () => {
      const { lastFrame, stdin } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={mockExecuteDetails}
          config={mockConfig}
          terminalWidth={60}
          isFocused={true}
        />,
      );
      await wait();

      // Press 'd' twice to toggle on and off
      stdin.write('d');
      await wait();
      stdin.write('d');
      await wait();

      const output = lastFrame();
      // Should be back to summary view
      expect(output).toContain("Press 'd' to see full details");
      expect(output).not.toContain('npm install --save-dev typescript');
    });

    it('should show full URLs when details are toggled for info commands', async () => {
      const { lastFrame, stdin } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={mockInfoDetails}
          config={mockConfig}
          terminalWidth={60}
          isFocused={true}
        />,
      );
      await wait();

      // Press 'd' to show details
      stdin.write('d');
      await wait();

      const output = lastFrame();
      // Should show all URLs
      expect(output).toContain('https://docs.example.com/api/users');
      expect(output).toContain('https://docs.example.com/api/authentication');
      expect(output).toContain('https://docs.example.com/api/permissions');
      expect(output).toContain('https://docs.example.com/api/security');
      expect(output).toContain('Full Parameters:');
    });

    it('should not respond to d key when not focused', async () => {
      const { lastFrame, stdin } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={mockExecuteDetails}
          config={mockConfig}
          terminalWidth={60}
          isFocused={false}
        />,
      );

      // Press 'd' key when not focused
      stdin.write('d');

      const output = lastFrame();
      // Should still show summary (not respond to key)
      expect(output).toContain("Press 'd' to see full details");
      expect(output).not.toContain('npm install --save-dev typescript');
    });
  });

  describe('STANDARD width behavior (80-120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 100, rows: 20 });
    });

    it('should still offer details toggle at standard width for very long commands', () => {
      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={mockExecuteDetails}
          config={mockConfig}
          terminalWidth={100}
          isFocused={true}
        />,
      );

      const output = lastFrame();

      // Should still offer details toggle for complex commands
      expect(output).toContain("Press 'd' to see full details");
    });
  });

  describe('WIDE width behavior (> 120 cols)', () => {
    beforeEach(() => {
      mockUseTerminalSize.mockReturnValue({ columns: 180, rows: 20 });
    });

    it('should show more details by default at wide width', () => {
      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={mockExecuteDetails}
          config={mockConfig}
          terminalWidth={180}
          isFocused={true}
        />,
      );

      const output = lastFrame();

      // Should show more command details by default at wide width
      expect(output).toContain('npm install --save-dev');
      // But still offer full details toggle for very long commands
      expect(output).toContain("Press 'd' to see full details");
    });
  });

  describe('Edge cases', () => {
    it('should handle commands with no parameters gracefully', () => {
      const simpleDetails: ToolCallConfirmationDetails = {
        type: 'exec',
        title: 'Execute Command',
        rootCommand: 'ls',
        command: 'ls',
        onConfirm: vi.fn(),
      };

      mockUseTerminalSize.mockReturnValue({ columns: 60, rows: 20 });

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={simpleDetails}
          config={mockConfig}
          terminalWidth={60}
          isFocused={true}
        />,
      );

      const output = lastFrame();

      // Should not show details toggle for simple commands
      expect(output).toContain('ls');
      expect(output).not.toContain("Press 'd' to see full details");
    });

    it('should maintain details state when component re-renders', async () => {
      const { lastFrame, stdin, rerender } = renderWithProviders(
        <ToolConfirmationMessage
          confirmationDetails={mockExecuteDetails}
          config={mockConfig}
          terminalWidth={60}
          isFocused={true}
        />,
      );

      // Press 'd' to show details
      stdin.write('d');

      // Re-render with same props - need to wrap in provider again
      rerender(
        <KeypressProvider>
          <ToolConfirmationMessage
            confirmationDetails={mockExecuteDetails}
            config={mockConfig}
            terminalWidth={60}
            isFocused={true}
          />
        </KeypressProvider>,
      );

      const output = lastFrame();
      // Should still show details after re-renderWithProviders
      expect(output).toContain('npm install --save-dev typescript');
      expect(output).toContain('Full Parameters:');
    });
  });
});
