/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { toolsCommand } from './toolsCommand.ts';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import type { Agent, ToolInfo } from '@vybestack/llxprt-code-agents';
import { SettingsService } from '@vybestack/llxprt-code-settings';

const mockTools: readonly ToolInfo[] = [
  {
    name: 'file-reader',
    displayName: 'File Reader',
    description: 'Reads files from the local system.',
    source: 'builtin',
    enabled: true,
  },
  {
    name: 'code-editor',
    displayName: 'Code Editor',
    description: 'Edits code files.',
    source: 'builtin',
    enabled: true,
  },
  {
    name: 'mcp-search',
    displayName: 'MCP Search',
    description: 'Searches via MCP server.',
    source: 'mcp',
    server: 'my-server',
    enabled: true,
  },
];

// Partial Agent mock: /tools only reads agent.tools.list(). The single
// `as unknown as Agent` cast lives here so call sites stay strongly typed.
function createMockAgent(tools: readonly ToolInfo[] = mockTools): Agent {
  return {
    tools: {
      list: () => tools,
    },
  } as unknown as Agent;
}

describe('toolsCommand', () => {
  it('reports missing tools from the agent', async () => {
    const mockContext = createMockCommandContext({
      services: {
        agent: null,
        config: {
          getSettingsService: vi.fn(),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'list');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Could not retrieve tools from the agent.',
      },
      expect.any(Number),
    );
  });

  it('lists available tools with status badges', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['file-reader']);

    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({ 'tools.disabled': ['file-reader'] }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'list');

    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(output).toContain('File Reader [disabled]');
    expect(output).toContain('Code Editor [enabled]');
    expect(output).toContain('Disabled tools: 1');
  });

  it('excludes MCP tools from the /tools list output', async () => {
    const settings = new SettingsService();
    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({}),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'list');

    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(output).toContain('File Reader');
    expect(output).not.toContain('MCP Search');
  });

  it('errors when attempting /tools disable on an MCP tool name', async () => {
    const settings = new SettingsService();
    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({}),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'disable mcp-search');

    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0];
    expect(output.type).toBe(MessageType.ERROR);
    expect(output.text).toContain('Tool "mcp-search" not found');
  });

  it('disables a tool using its friendly name', async () => {
    const settings = new SettingsService();
    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({}),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'disable "File Reader"');

    expect(settings.get('tools.disabled')).toStrictEqual(['file-reader']);
    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(output).toContain("Disabled tool 'File Reader'");
  });

  it('refreshes Gemini tool schema after disabling a tool', async () => {
    const settings = new SettingsService();
    const setToolsSpy = vi.fn();

    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({}),
          getAgentClient: () => ({ setTools: setToolsSpy }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'disable code-editor');

    expect(setToolsSpy).toHaveBeenCalled();
  });

  it('enables a tool using its canonical name', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['code-editor']);

    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({ 'tools.disabled': ['code-editor'] }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'enable code-editor');

    expect(settings.get('tools.disabled')).toStrictEqual([]);
    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(output).toContain("Enabled tool 'Code Editor'");
  });

  it('errors when the requested tool cannot be resolved', async () => {
    const settings = new SettingsService();
    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({}),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'disable missing');

    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0];
    expect(output.type).toBe(MessageType.ERROR);
    expect(output.text).toContain('Tool "missing" not found');
  });

  it('enabling a tool does not create an allowed whitelist when none exists', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['code-editor']);

    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({ 'tools.disabled': ['code-editor'] }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'enable code-editor');

    expect(settings.get('tools.disabled')).toStrictEqual([]);
    expect(settings.get('tools.allowed')).toStrictEqual([]);
  });

  it('enabling a tool preserves existing allowed whitelist', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['code-editor']);
    settings.set('tools.allowed', ['file-reader']);

    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({
            'tools.disabled': ['code-editor'],
            'tools.allowed': ['file-reader'],
          }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'enable code-editor');

    expect(settings.get('tools.disabled')).toStrictEqual([]);
    expect(settings.get('tools.allowed')).toStrictEqual(
      expect.arrayContaining(['file-reader', 'code-editor']),
    );
  });

  it('enabling a default-disabled tool keeps other tools enabled', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['file-reader']);

    const mockContext = createMockCommandContext({
      services: {
        agent: createMockAgent(),
        config: {
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({ 'tools.disabled': ['file-reader'] }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    await toolsCommand.action!(mockContext, 'enable file-reader');

    (mockContext.ui.addItem as vi.Mock).mockClear();
    await toolsCommand.action!(mockContext, 'list');

    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(output).toContain('File Reader [enabled]');
    expect(output).toContain('Code Editor [enabled]');
  });
});
