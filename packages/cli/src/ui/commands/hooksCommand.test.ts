/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hooksCommand } from './hooksCommand.js';
import { MessageType } from '../types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from './types.js';
import type { Config, HookRegistryEntry } from '@vybestack/llxprt-code-core';
import {
  HookType,
  HookEventName,
  ConfigSource,
} from '@vybestack/llxprt-code-core';

describe('hooksCommand', () => {
  let context: CommandContext;
  let mockHooks: HookRegistryEntry[];
  let mockGetDisabledHooks: ReturnType<typeof vi.fn>;
  let mockSetDisabledHooks: ReturnType<typeof vi.fn>;
  let mockSetHookEnabled: ReturnType<typeof vi.fn>;
  let mockGetHookName: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    mockHooks = [
      {
        eventName: HookEventName.BeforeTool,
        enabled: true,
        source: ConfigSource.Project,
        config: {
          type: HookType.Command,
          name: 'hook1',
          command: 'echo hook1',
        },
      },
      {
        eventName: HookEventName.AfterTool,
        enabled: true,
        source: ConfigSource.Project,
        config: {
          type: HookType.Command,
          name: 'hook2',
          command: 'echo hook2',
        },
      },
      {
        eventName: HookEventName.BeforeModel,
        enabled: false,
        source: ConfigSource.Project,
        config: {
          type: HookType.Command,
          name: 'hook3',
          command: 'echo hook3',
        },
      },
    ];

    mockGetDisabledHooks = vi.fn().mockReturnValue(['hook3']);
    mockSetDisabledHooks = vi.fn();
    mockSetHookEnabled = vi.fn();
    mockGetHookName = vi.fn().mockImplementation((entry: HookRegistryEntry) => {
      const hookName = entry.config.name;
      if (!hookName) {
        throw new Error('Hook must have a name for testing');
      }
      return hookName;
    });

    const mockRegistry = {
      getAllHooks: vi.fn().mockReturnValue(mockHooks),
      setHookEnabled: mockSetHookEnabled,
      getHookName: mockGetHookName,
    };

    const mockHookSystem = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getRegistry: vi.fn().mockReturnValue(mockRegistry),
    };

    context = createMockCommandContext({
      services: {
        config: {
          getHookSystem: vi.fn().mockReturnValue(mockHookSystem),
          getDisabledHooks: mockGetDisabledHooks,
          setDisabledHooks: mockSetDisabledHooks,
        } as unknown as Config,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('list command', () => {
    it('should list all hooks', async () => {
      const listCmd = hooksCommand.subCommands!.find((s) => s.name === 'list')!;
      await listCmd.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.HOOKS_LIST,
          hooks: mockHooks,
        }),
        expect.any(Number),
      );
    });

    it('should show error if config is not loaded', async () => {
      const contextNoConfig = createMockCommandContext({
        services: {
          config: null,
        },
      });

      const listCmd = hooksCommand.subCommands!.find((s) => s.name === 'list')!;
      await listCmd.action!(contextNoConfig, '');

      expect(contextNoConfig.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: 'Config not loaded.',
        }),
        expect.any(Number),
      );
    });

    it('should show info if hook system is not enabled', async () => {
      const contextNoHooks = createMockCommandContext({
        services: {
          config: {
            getHookSystem: vi.fn().mockReturnValue(null),
          } as unknown as Config,
        },
      });

      const listCmd = hooksCommand.subCommands!.find((s) => s.name === 'list')!;
      await listCmd.action!(contextNoHooks, '');

      expect(contextNoHooks.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'Hooks system is not enabled. Enable it in settings with hooks.enabled.',
        }),
        expect.any(Number),
      );
    });
  });

  describe('enable command', () => {
    it('should enable a hook by name', async () => {
      const enableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable',
      )!;
      await enableCmd.action!(context, 'hook3');

      expect(mockSetDisabledHooks).toHaveBeenCalledWith([]);
      expect(mockSetHookEnabled).toHaveBeenCalledWith('hook3', true);
      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: "Enabled hook 'hook3'.",
        }),
        expect.any(Number),
      );
    });

    it('should show error if hook not found', async () => {
      const enableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable',
      )!;
      await enableCmd.action!(context, 'nonexistent');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: "Hook 'nonexistent' not found.",
        }),
        expect.any(Number),
      );
    });

    it('should show usage error if no hook name provided', async () => {
      const enableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable',
      )!;
      await enableCmd.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: 'Usage: /hooks enable <hook-name>',
        }),
        expect.any(Number),
      );
    });
  });

  describe('disable command', () => {
    it('should disable a hook by name', async () => {
      const disableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'disable',
      )!;
      await disableCmd.action!(context, 'hook1');

      expect(mockSetDisabledHooks).toHaveBeenCalledWith(['hook3', 'hook1']);
      expect(mockSetHookEnabled).toHaveBeenCalledWith('hook1', false);
      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: "Disabled hook 'hook1'.",
        }),
        expect.any(Number),
      );
    });

    it('should show error if hook not found', async () => {
      const disableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'disable',
      )!;
      await disableCmd.action!(context, 'nonexistent');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: "Hook 'nonexistent' not found.",
        }),
        expect.any(Number),
      );
    });

    it('should show usage error if no hook name provided', async () => {
      const disableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'disable',
      )!;
      await disableCmd.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: 'Usage: /hooks disable <hook-name>',
        }),
        expect.any(Number),
      );
    });
  });

  describe('enable-all command', () => {
    it('should enable all hooks', async () => {
      const enableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable-all',
      )!;
      await enableAllCmd.action!(context, '');

      expect(mockSetDisabledHooks).toHaveBeenCalledWith([]);
      expect(mockSetHookEnabled).toHaveBeenCalledWith('hook1', true);
      expect(mockSetHookEnabled).toHaveBeenCalledWith('hook2', true);
      expect(mockSetHookEnabled).toHaveBeenCalledWith('hook3', true);
      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'Enabled all 3 hook(s).',
        }),
        expect.any(Number),
      );
      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.HOOKS_LIST,
          hooks: mockHooks,
        }),
        expect.any(Number),
      );
    });

    it('should show info if no hooks registered', async () => {
      const mockRegistryEmpty = {
        getAllHooks: vi.fn().mockReturnValue([]),
        setHookEnabled: mockSetHookEnabled,
        getHookName: mockGetHookName,
      };

      const mockHookSystemEmpty = {
        initialize: vi.fn().mockResolvedValue(undefined),
        getRegistry: vi.fn().mockReturnValue(mockRegistryEmpty),
      };

      const contextEmpty = createMockCommandContext({
        services: {
          config: {
            getHookSystem: vi.fn().mockReturnValue(mockHookSystemEmpty),
            getDisabledHooks: mockGetDisabledHooks,
            setDisabledHooks: mockSetDisabledHooks,
          } as unknown as Config,
        },
      });

      const enableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable-all',
      )!;
      await enableAllCmd.action!(contextEmpty, '');

      expect(contextEmpty.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'No hooks registered.',
        }),
        expect.any(Number),
      );
    });

    it('should show error if config is not loaded', async () => {
      const contextNoConfig = createMockCommandContext({
        services: {
          config: null,
        },
      });

      const enableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable-all',
      )!;
      await enableAllCmd.action!(contextNoConfig, '');

      expect(contextNoConfig.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: 'Config not loaded.',
        }),
        expect.any(Number),
      );
    });

    it('should show error if hook system is not enabled', async () => {
      const contextNoHooks = createMockCommandContext({
        services: {
          config: {
            getHookSystem: vi.fn().mockReturnValue(null),
          } as unknown as Config,
        },
      });

      const enableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable-all',
      )!;
      await enableAllCmd.action!(contextNoHooks, '');

      expect(contextNoHooks.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: 'Hooks system is not enabled.',
        }),
        expect.any(Number),
      );
    });
  });

  describe('disable-all command', () => {
    it('should disable all hooks', async () => {
      const disableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'disable-all',
      )!;
      await disableAllCmd.action!(context, '');

      expect(mockSetDisabledHooks).toHaveBeenCalledWith([
        'hook1',
        'hook2',
        'hook3',
      ]);
      expect(mockSetHookEnabled).toHaveBeenCalledWith('hook1', false);
      expect(mockSetHookEnabled).toHaveBeenCalledWith('hook2', false);
      expect(mockSetHookEnabled).toHaveBeenCalledWith('hook3', false);
      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'Disabled all 3 hook(s).',
        }),
        expect.any(Number),
      );
      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.HOOKS_LIST,
          hooks: mockHooks,
        }),
        expect.any(Number),
      );
    });

    it('should show info if no hooks registered', async () => {
      const mockRegistryEmpty = {
        getAllHooks: vi.fn().mockReturnValue([]),
        setHookEnabled: mockSetHookEnabled,
        getHookName: mockGetHookName,
      };

      const mockHookSystemEmpty = {
        initialize: vi.fn().mockResolvedValue(undefined),
        getRegistry: vi.fn().mockReturnValue(mockRegistryEmpty),
      };

      const contextEmpty = createMockCommandContext({
        services: {
          config: {
            getHookSystem: vi.fn().mockReturnValue(mockHookSystemEmpty),
            getDisabledHooks: mockGetDisabledHooks,
            setDisabledHooks: mockSetDisabledHooks,
          } as unknown as Config,
        },
      });

      const disableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'disable-all',
      )!;
      await disableAllCmd.action!(contextEmpty, '');

      expect(contextEmpty.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'No hooks registered.',
        }),
        expect.any(Number),
      );
    });

    it('should show error if config is not loaded', async () => {
      const contextNoConfig = createMockCommandContext({
        services: {
          config: null,
        },
      });

      const disableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'disable-all',
      )!;
      await disableAllCmd.action!(contextNoConfig, '');

      expect(contextNoConfig.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: 'Config not loaded.',
        }),
        expect.any(Number),
      );
    });

    it('should show error if hook system is not enabled', async () => {
      const contextNoHooks = createMockCommandContext({
        services: {
          config: {
            getHookSystem: vi.fn().mockReturnValue(null),
          } as unknown as Config,
        },
      });

      const disableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'disable-all',
      )!;
      await disableAllCmd.action!(contextNoHooks, '');

      expect(contextNoHooks.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: 'Hooks system is not enabled.',
        }),
        expect.any(Number),
      );
    });
  });

  describe('completion', () => {
    it('should provide hook name completions', async () => {
      const enableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable',
      )!;

      const completions = await enableCmd.completion!(context, 'hook');

      expect(completions).toEqual(['hook1', 'hook2', 'hook3']);
    });

    it('should filter completions by partial arg', async () => {
      const enableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable',
      )!;

      const completions = await enableCmd.completion!(context, 'hook1');

      expect(completions).toEqual(['hook1']);
    });

    it('should return empty array if config not loaded', async () => {
      const contextNoConfig = createMockCommandContext({
        services: {
          config: null,
        },
      });

      const enableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable',
      )!;

      const completions = await enableCmd.completion!(contextNoConfig, 'hook');

      expect(completions).toEqual([]);
    });
  });

  describe('default action', () => {
    it('should list hooks when no subcommand is provided', async () => {
      await hooksCommand.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.HOOKS_LIST,
          hooks: mockHooks,
        }),
        expect.any(Number),
      );
    });

    it('should list hooks when unknown subcommand is provided', async () => {
      await hooksCommand.action!(context, 'unknown');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.HOOKS_LIST,
          hooks: mockHooks,
        }),
        expect.any(Number),
      );
    });
  });
});
