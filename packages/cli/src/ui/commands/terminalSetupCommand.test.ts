/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { terminalSetupCommand } from './terminalSetupCommand.js';
import * as terminalSetupModule from '../utils/terminalSetup.js';
import type { CommandContext } from './types.js';

vi.mock('../utils/terminalSetup.js');

describe('terminalSetupCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    expect(terminalSetupCommand.name).toBe('terminal-setup');
    expect(terminalSetupCommand.description).toContain('multiline input');
    expect(terminalSetupCommand.kind).toBe('built-in');
  });

  it('should return success message when terminal setup succeeds', async () => {
    vi.spyOn(terminalSetupModule, 'terminalSetup').mockResolvedValue({
      success: true,
      message: 'Terminal configured successfully',
    });

    const result = await terminalSetupCommand.action!({} as CommandContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      content: 'Terminal configured successfully',
      messageType: 'info',
    });
  });

  it('should append restart message when terminal setup requires restart', async () => {
    vi.spyOn(terminalSetupModule, 'terminalSetup').mockResolvedValue({
      success: true,
      message: 'Terminal configured successfully',
      requiresRestart: true,
    });

    const result = await terminalSetupCommand.action!({} as CommandContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      content:
        'Terminal configured successfully\n\nPlease restart your terminal for the changes to take effect.',
      messageType: 'info',
    });
  });

  it('should return error message when terminal setup fails', async () => {
    vi.spyOn(terminalSetupModule, 'terminalSetup').mockResolvedValue({
      success: false,
      message: 'Failed to detect terminal',
    });

    const result = await terminalSetupCommand.action!({} as CommandContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      content: 'Failed to detect terminal',
      messageType: 'error',
    });
  });

  it('should handle exceptions from terminal setup', async () => {
    vi.spyOn(terminalSetupModule, 'terminalSetup').mockRejectedValue(
      new Error('Unexpected error'),
    );

    const result = await terminalSetupCommand.action!({} as CommandContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      content: 'Failed to configure terminal: Error: Unexpected error',
      messageType: 'error',
    });
  });
});

// Issue #2114: characterization tests for stripJsonComments, whose regex was
// hoist-and-bounded. The module is mocked above, so import the real impl.
describe('issue #2114 stripJsonComments characterization', () => {
  it('strips a leading single-line comment', async () => {
    const { stripJsonComments } = await vi.importActual<
      typeof import('../utils/terminalSetup.js')
    >('../utils/terminalSetup.js');
    expect(stripJsonComments('// hello\n')).toBe('\n');
  });

  it('strips an indented comment and preserves non-comment lines', async () => {
    const { stripJsonComments } = await vi.importActual<
      typeof import('../utils/terminalSetup.js')
    >('../utils/terminalSetup.js');
    const input = '{\n  // a comment\n  "k": 1\n}\n';
    expect(stripJsonComments(input)).toBe('{\n\n  "k": 1\n}\n');
  });

  it('leaves trailing inline text after // untouched (only leading comments strip)', async () => {
    const { stripJsonComments } = await vi.importActual<
      typeof import('../utils/terminalSetup.js')
    >('../utils/terminalSetup.js');
    expect(stripJsonComments('  url: "http://x" // note')).toBe(
      '  url: "http://x" // note',
    );
  });

  it('strips very long leading comments without a regex length cap', async () => {
    const { stripJsonComments } = await vi.importActual<
      typeof import('../utils/terminalSetup.js')
    >('../utils/terminalSetup.js');
    const input = `// ${'x'.repeat(9000)}\n{"k":1}\n`;
    expect(stripJsonComments(input)).toBe('\n{"k":1}\n');
  });
});
