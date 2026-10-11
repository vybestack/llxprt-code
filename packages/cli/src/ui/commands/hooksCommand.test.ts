import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { hooksCommand } from './hooksCommand.js';
import { MessageType } from '../types.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import type { CommandContext } from './types.js';
import type { HookRegistryEntry } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  readHookDefinitions,
  hookSessionRuntime,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import { SessionStartSource } from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  HookType,
  HookEventName,
  ConfigSource,
} from '@vybestack/llxprt-code-core';

describe('hooksCommand', () => {
  let context: CommandContext;
  let mockHooks: HookRegistryEntry[];
  const owners: Array<{ root: SessionHookOwner; config: Config }> = [];
  let root: SessionHookOwner;
  const makeContext = async (
    entries: HookRegistryEntry[],
  ): Promise<CommandContext> => {
    const definitions = Object.fromEntries(
      Object.values(HookEventName).map((event) => [
        event,
        entries
          .filter((entry) => entry.eventName === event)
          .map((entry) => ({ hooks: [entry.config] })),
      ]),
    );
    const config = new Config({
      sessionId: 'cli-hook-admin',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'model',
      debugMode: false,
      enableHooks: true,
      hooks: definitions,
      disabledHooks: entries
        .filter((entry) => !entry.enabled)
        .map((entry) => entry.config.name ?? entry.config.command),
    });
    const bus = new MessageBus();
    root = new SessionHookOwner(
      readHookDefinitions(config),
      hookSessionRuntime(
        config,
        new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        }),
        RootTelemetry.prepare({
          enabled: false,
          sessionId: config.getSessionId(),
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
      true,
      bus,
    );
    const current = root;
    const control = {
      listHooks: () => current.listHooks(),
      getDisabledHooks: () => current.getDisabledHooks(),
      setDisabledHooks: (names: readonly string[]) =>
        current.setDisabledHooks(names),
      enable: (name: string) =>
        current.setDisabledHooks(
          current.getDisabledHooks().filter((disabled) => disabled !== name),
        ),
      disable: (name: string) =>
        current.setDisabledHooks([...current.getDisabledHooks(), name]),
    };
    owners.push({ root, config });
    await root
      .execution({
        sessionId: () => config.getSessionId(),
        transcriptPath: () => undefined,
      })
      .sessionStart?.(SessionStartSource.Startup);
    return createMockCommandContext({
      services: { config, agent: { hooks: control } },
    });
  };
  const projected = (): HookRegistryEntry[] =>
    root.listHooks().map((hook) => {
      const original = mockHooks.find(
        (entry) => entry.config.name === hook.name,
      );
      if (original === undefined) throw new Error('Unexpected hook projection');
      return {
        ...original,
        config: { type: HookType.Command, name: hook.name, command: '' },
        enabled: hook.enabled,
      };
    });

  beforeEach(async () => {
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

    context = await makeContext(mockHooks);
  });

  afterEach(async () => {
    const resources = owners.splice(0);
    const retired = await Promise.allSettled(
      resources.map(async ({ root, config }) => {
        await root.dispose();
        await config.dispose();
      }),
    );
    vi.restoreAllMocks();
    const failures = retired.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'CLI hook fixture retirement failed');
  });

  describe('list command', () => {
    it('should list all hooks', async () => {
      const listCmd = hooksCommand.subCommands!.find((s) => s.name === 'list')!;
      await listCmd.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.HOOKS_LIST,
          hooks: projected(),
        }),
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
          text: 'Configuration not loaded.',
        }),
        expect.any(Number),
      );
    });

    it('should show info if hook system is not enabled', async () => {
      const contextNoHooks = createMockCommandContext({
        services: { agent: null },
      });

      const listCmd = hooksCommand.subCommands!.find((s) => s.name === 'list')!;
      await listCmd.action!(contextNoHooks, '');

      expect(contextNoHooks.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'Hook execution requires an active Agent. Enable hooks in settings with hooksConfig.enabled.',
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

      expect(root.getDisabledHooks()).toStrictEqual([]);
      expect(
        root.listHooks().find((hook) => hook.name === 'hook3')?.enabled,
      ).toBe(true);
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

      expect(root.getDisabledHooks()).toStrictEqual(['hook3', 'hook1']);
      expect(
        root.listHooks().find((hook) => hook.name === 'hook1')?.enabled,
      ).toBe(false);
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

      expect(root.getDisabledHooks()).toStrictEqual([]);
      expect(
        root.listHooks().find((hook) => hook.name === 'hook1')?.enabled,
      ).toBe(true);
      expect(
        root.listHooks().find((hook) => hook.name === 'hook2')?.enabled,
      ).toBe(true);
      expect(
        root.listHooks().find((hook) => hook.name === 'hook3')?.enabled,
      ).toBe(true);
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
          hooks: projected(),
        }),
      );
    });

    it('should show info if no hooks registered', async () => {
      const contextEmpty = await makeContext([]);

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
          text: 'Configuration not loaded.',
        }),
        expect.any(Number),
      );
    });

    it('should explain when executable hook ownership is absent', async () => {
      const contextNoHooks = createMockCommandContext({
        services: { agent: null },
      });

      const enableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable-all',
      )!;
      await enableAllCmd.action!(contextNoHooks, '');

      expect(contextNoHooks.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'Hook execution requires an active Agent. Enable hooks in settings with hooksConfig.enabled.',
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

      expect(root.getDisabledHooks()).toStrictEqual([
        'hook1',
        'hook2',
        'hook3',
      ]);
      expect(
        root.listHooks().find((hook) => hook.name === 'hook1')?.enabled,
      ).toBe(false);
      expect(
        root.listHooks().find((hook) => hook.name === 'hook2')?.enabled,
      ).toBe(false);
      expect(
        root.listHooks().find((hook) => hook.name === 'hook3')?.enabled,
      ).toBe(false);
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
          hooks: projected(),
        }),
      );
    });

    it('should show info if no hooks registered', async () => {
      const contextEmpty = await makeContext([]);

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
          text: 'Configuration not loaded.',
        }),
        expect.any(Number),
      );
    });

    it('should explain when executable hook ownership is absent', async () => {
      const contextNoHooks = createMockCommandContext({
        services: { agent: null },
      });

      const disableAllCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'disable-all',
      )!;
      await disableAllCmd.action!(contextNoHooks, '');

      expect(contextNoHooks.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'Hook execution requires an active Agent. Enable hooks in settings with hooksConfig.enabled.',
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

      expect(completions).toStrictEqual(['hook1', 'hook2', 'hook3']);
    });

    it('should filter completions by partial arg', async () => {
      const enableCmd = hooksCommand.subCommands!.find(
        (s) => s.name === 'enable',
      )!;

      const completions = await enableCmd.completion!(context, 'hook1');

      expect(completions).toStrictEqual(['hook1']);
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

      expect(completions).toStrictEqual([]);
    });
  });

  describe('default action', () => {
    it('should list hooks when no subcommand is provided', async () => {
      await hooksCommand.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.HOOKS_LIST,
          hooks: projected(),
        }),
      );
    });

    it('should list hooks when unknown subcommand is provided', async () => {
      await hooksCommand.action!(context, 'unknown');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.HOOKS_LIST,
          hooks: projected(),
        }),
      );
    });
  });
});
