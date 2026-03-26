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
import { renderWithProviders } from '../../../test-utils/render.js';

describe('ToolConfirmationMessage redirection warning', () => {
  const mockConfig = {
    isTrustedFolder: () => true,
    getIdeMode: () => false,
  } as unknown as Config;

  it('should display redirection warning for command with > operator', () => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: 'echo "hello" > test.txt',
      rootCommand: 'echo',
      rootCommands: ['echo'],
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={100}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('echo "hello" > test.txt');
    expect(output).toContain('Command contains redirection');
  });

  it('should NOT display redirection warning for command without redirection', () => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: 'git status',
      rootCommand: 'git',
      rootCommands: ['git'],
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={100}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('git status');
    expect(output).not.toContain('Command contains redirection');
  });

  it('should display redirection warning for compound command with redirection', () => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: 'git log && cat file.txt > out.txt',
      rootCommand: 'git',
      rootCommands: ['git', 'cat'],
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={100}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('Command contains redirection');
  });

  it('should NOT display warning for redirection characters inside quotes', () => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: 'echo "use > to redirect"',
      rootCommand: 'echo',
      rootCommands: ['echo'],
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={100}
      />,
    );

    const output = lastFrame();
    expect(output).not.toContain('Command contains redirection');
  });
});
