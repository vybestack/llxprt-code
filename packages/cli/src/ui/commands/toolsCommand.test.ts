/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { toolsCommand } from './toolsCommand.tsx';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import type { Tool } from '@vybestack/llxprt-code-core';

// Mock tools for testing
const mockTools = [
  {
    name: 'file-reader',
    displayName: 'File Reader',
    description: 'Reads files from the local system.',
    schema: {},
  },
  {
    name: 'code-editor',
    displayName: 'Code Editor',
    description: 'Edits code files.',
    schema: {},
  },
] as Tool[];

describe('toolsCommand', () => {
  it('should display an error if the tool registry is unavailable', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => undefined,
        },
      },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Could not retrieve tool registry.',
      },
      expect.any(Number),
    );
  });

  it('should display "No tools available" when none are found', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => [] as Tool[] }),
          getEphemeralSettings: () => ({}),
        },
      },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('No tools available'),
      }),
      expect.any(Number),
    );
  });

  it('should list tools without descriptions by default', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getEphemeralSettings: () => ({}),
        },
      },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, '');

    const message = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(message).not.toContain('Reads files from the local system.');
    expect(message).toContain('File Reader');
    expect(message).toContain('Code Editor');
  });

  it('should list tools with descriptions when "desc" arg is passed', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getEphemeralSettings: () => ({}),
        },
      },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'desc');

    const message = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(message).toContain('Reads files from the local system.');
    expect(message).toContain('Edits code files.');
  });

  describe('disable/enable functionality', () => {
    it('should return dialog action for disable', async () => {
      const mockContext = createMockCommandContext({
        services: {
          config: {
            getEphemeralSettings: () => ({}),
            getToolRegistry: () =>
              Promise.resolve({ getAllTools: () => mockTools }),
          },
        },
      });

      if (!toolsCommand.action) throw new Error('Action not defined');
      const result = await toolsCommand.action(mockContext, 'disable');

      expect(result).toEqual({
        type: 'dialog',
        dialog: 'tools',
      });
    });

    it('should return dialog action for enable', async () => {
      const mockContext = createMockCommandContext({
        services: {
          config: {
            getEphemeralSettings: () => ({ 'disabled-tools': ['file-reader'] }),
            getToolRegistry: () =>
              Promise.resolve({ getAllTools: () => mockTools }),
          },
        },
      });

      if (!toolsCommand.action) throw new Error('Action not defined');
      const result = await toolsCommand.action(mockContext, 'enable');

      expect(result).toEqual({
        type: 'dialog',
        dialog: 'tools',
      });
    });

    it('should show disabled tools in list', async () => {
      const mockContext = createMockCommandContext({
        services: {
          config: {
            getEphemeralSettings: () => ({ 'disabled-tools': ['file-reader'] }),
            getToolRegistry: () =>
              Promise.resolve({ getAllTools: () => mockTools }),
          },
        },
      });

      if (!toolsCommand.action) throw new Error('Action not defined');
      await toolsCommand.action(mockContext, '');

      const message = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
      expect(message).toContain('[DISABLED]');
      expect(message).toContain('1 tool(s) disabled');
    });
  });

  describe('completion', () => {
    it('should complete subcommands', async () => {
      const mockContext = createMockCommandContext({});

      if (!toolsCommand.completion) throw new Error('Completion not defined');
      const completions = await toolsCommand.completion(mockContext, 'dis');

      expect(completions).toContain('disable');
    });
  });
});
