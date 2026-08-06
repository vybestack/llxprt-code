/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/** @vitest-environment jsdom */

import { act, useCallback, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { CommandKind, type SlashCommand } from '../commands/types.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { CoreEvent, coreEvents } from '@vybestack/llxprt-code-core';
import { useCommandReload } from './slashCommandProcessorSupport.js';

const loaderState = {
  builtinCommands: [] as SlashCommand[],
  fileCommands: [] as SlashCommand[],
  mcpCommands: [] as SlashCommand[],
};

vi.mock('../../services/BuiltinCommandLoader.js', () => ({
  BuiltinCommandLoader: class {
    loadCommands(): Promise<readonly SlashCommand[]> {
      return Promise.resolve(loaderState.builtinCommands);
    }
  },
}));

vi.mock('../../services/FileCommandLoader.js', () => ({
  FileCommandLoader: class {
    constructor(private readonly config: CliUiRuntime) {}

    loadCommands(): Promise<readonly SlashCommand[]> {
      return Promise.resolve(
        this.config.getFolderTrust() && !this.config.isTrustedFolder()
          ? []
          : loaderState.fileCommands,
      );
    }
  },
}));

vi.mock('../../services/McpPromptLoader.js', () => ({
  McpPromptLoader: class {
    loadCommands(): Promise<readonly SlashCommand[]> {
      return Promise.resolve(loaderState.mcpCommands);
    }
  },
}));

const actual = { ...(await import('@vybestack/llxprt-code-mcp')) };
vi.mock('@vybestack/llxprt-code-mcp', () => {
  return {
    ...actual,
    addMCPStatusChangeListener: vi.fn(),
    removeMCPStatusChangeListener: vi.fn(),
  };
});

const actualActual = { ...(await import('@vybestack/llxprt-code-core')) };
vi.mock('@vybestack/llxprt-code-core', () => {
  return {
    ...actualActual,
    IdeClient: {
      getInstance: () =>
        Promise.resolve({
          addStatusChangeListener: vi.fn(),
          removeStatusChangeListener: vi.fn(),
        }),
    },
  };
});

function useCommandRegistry(config: CliUiRuntime): readonly SlashCommand[] {
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [commands, setCommands] = useState<readonly SlashCommand[]>([]);
  const reloadCommands = useCallback(() => {
    setReloadTrigger((value) => value + 1);
  }, []);
  useCommandReload(config, reloadTrigger, true, reloadCommands, setCommands);
  return commands;
}

describe('useCommandReload', () => {
  beforeEach(() => {
    loaderState.builtinCommands = [];
    loaderState.fileCommands = [];
    loaderState.mcpCommands = [];
  });

  it('reloads the command registry when folder trust changes', async () => {
    let trusted = false;
    const config = {
      getFolderTrust: () => true,
      isTrustedFolder: () => trusted,
    } as CliUiRuntime;
    loaderState.fileCommands = [
      {
        name: 'trusted-file-command',
        description: 'Available only in a trusted folder',
        kind: CommandKind.FILE,
      },
    ];
    const { result } = renderHook(() => useCommandRegistry(config));
    await waitFor(() => expect(result.current).toStrictEqual([]));

    trusted = true;
    act(() => {
      coreEvents.emitFolderTrustChanged(true);
    });

    await waitFor(() => {
      expect(result.current.map((command) => command.name)).toStrictEqual([
        'trusted-file-command',
      ]);
    });
  });

  it('removes populated file commands when folder trust is revoked', async () => {
    loaderState.fileCommands = [
      {
        name: 'trusted-file-command',
        description: 'Available only in a trusted folder',
        kind: CommandKind.FILE,
      },
    ];
    let trusted = true;
    const config = {
      getFolderTrust: () => true,
      isTrustedFolder: () => trusted,
    } as CliUiRuntime;
    const { result } = renderHook(() => useCommandRegistry(config));
    await waitFor(() => expect(result.current).toHaveLength(1));

    trusted = false;
    act(() => {
      coreEvents.emitFolderTrustChanged(false);
    });

    await waitFor(() => expect(result.current).toStrictEqual([]));
    expect(loaderState.fileCommands).toHaveLength(1);
  });

  it('stops listening for folder trust changes after unmount', async () => {
    const config = {
      getFolderTrust: () => false,
      isTrustedFolder: () => true,
    } as CliUiRuntime;
    const listenersBeforeMount = coreEvents.listenerCount(
      CoreEvent.FolderTrustChanged,
    );
    const { result, unmount } = renderHook(() => useCommandRegistry(config));
    await waitFor(() => expect(result.current).toStrictEqual([]));
    expect(coreEvents.listenerCount(CoreEvent.FolderTrustChanged)).toBe(
      listenersBeforeMount + 1,
    );

    unmount();

    expect(coreEvents.listenerCount(CoreEvent.FolderTrustChanged)).toBe(
      listenersBeforeMount,
    );
  });
});
