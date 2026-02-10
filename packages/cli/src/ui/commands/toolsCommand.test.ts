/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { toolsCommand } from './toolsCommand.ts';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import type { Tool } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-core';

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
  it('reports missing tool registry', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: vi.fn().mockReturnValue(undefined),
          getSettingsService: vi.fn(),
        },
      },
      ui: { addItem: vi.fn() },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'list');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Could not retrieve tool registry.',
      },
      expect.any(Number),
    );
  });

  it('lists available tools with status badges', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['file-reader']);

    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({ 'tools.disabled': ['file-reader'] }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'list');

    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(output).toContain('File Reader [disabled]');
    expect(output).toContain('Code Editor [enabled]');
    expect(output).toContain('Disabled tools: 1');
  });

  it('disables a tool using its friendly name', async () => {
    const settings = new SettingsService();
    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({}),
        },
      },
      ui: { addItem: vi.fn() },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'disable "File Reader"');

    expect(settings.get('tools.disabled')).toEqual(['file-reader']);
    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(output).toContain("Disabled tool 'File Reader'");
  });

  it('refreshes Gemini tool schema after disabling a tool', async () => {
    const settings = new SettingsService();
    const setToolsSpy = vi.fn();

    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({}),
          getGeminiClient: () => ({ setTools: setToolsSpy }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'disable code-editor');

    expect(setToolsSpy).toHaveBeenCalled();
  });

  it('enables a tool using its canonical name', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['code-editor']);

    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({ 'tools.disabled': ['code-editor'] }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'enable code-editor');

    expect(settings.get('tools.disabled')).toEqual([]);
    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(output).toContain("Enabled tool 'Code Editor'");
  });

  it('errors when the requested tool cannot be resolved', async () => {
    const settings = new SettingsService();
    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({}),
        },
      },
      ui: { addItem: vi.fn() },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'disable missing');

    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0];
    expect(output.type).toBe(MessageType.ERROR);
    expect(output.text).toContain('Tool "missing" not found');
  });

  it('enabling a tool does not create an allowed whitelist when none exists', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['code-editor']);

    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({ 'tools.disabled': ['code-editor'] }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'enable code-editor');

    expect(settings.get('tools.disabled')).toEqual([]);
    expect(settings.get('tools.allowed')).toEqual([]);
  });

  it('enabling a tool preserves existing allowed whitelist', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['code-editor']);
    settings.set('tools.allowed', ['file-reader']);

    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({
            'tools.disabled': ['code-editor'],
            'tools.allowed': ['file-reader'],
          }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'enable code-editor');

    expect(settings.get('tools.disabled')).toEqual([]);
    expect(settings.get('tools.allowed')).toEqual(
      expect.arrayContaining(['file-reader', 'code-editor']),
    );
  });

  it('enabling a default-disabled tool keeps other tools enabled', async () => {
    const settings = new SettingsService();
    settings.set('tools.disabled', ['file-reader']);

    const mockContext = createMockCommandContext({
      services: {
        config: {
          getToolRegistry: () => ({ getAllTools: () => mockTools }),
          getSettingsService: () => settings,
          getEphemeralSettings: () => ({ 'tools.disabled': ['file-reader'] }),
        },
      },
      ui: { addItem: vi.fn() },
    });

    if (!toolsCommand.action) throw new Error('Action not defined');
    await toolsCommand.action(mockContext, 'enable file-reader');

    (mockContext.ui.addItem as vi.Mock).mockClear();
    await toolsCommand.action(mockContext, 'list');

    const output = (mockContext.ui.addItem as vi.Mock).mock.calls[0][0].text;
    expect(output).toContain('File Reader [enabled]');
    expect(output).toContain('Code Editor [enabled]');
  });
});
