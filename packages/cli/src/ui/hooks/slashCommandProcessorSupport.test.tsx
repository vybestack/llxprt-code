/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/** @vitest-environment jsdom */

import { act, useCallback, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { CommandKind, type SlashCommand } from '../commands/types.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { coreEvents } from '@vybestack/llxprt-code-core';
import { useCommandReload } from './slashCommandProcessorSupport.js';

const loaderState = vi.hoisted(() => ({
  builtinCommands: [] as SlashCommand[],
  fileCommands: [] as SlashCommand[],
  mcpCommands: [] as SlashCommand[],
}));

vi.mock('../../services/BuiltinCommandLoader.js', () => ({
  BuiltinCommandLoader: class {
    loadCommands(): Promise<readonly SlashCommand[]> {
      return Promise.resolve(loaderState.builtinCommands);
    }
  },
}));

vi.mock('../../services/FileCommandLoader.js', () => ({
  FileCommandLoader: class {
    loadCommands(): Promise<readonly SlashCommand[]> {
      return Promise.resolve(loaderState.fileCommands);
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

vi.mock('@vybestack/llxprt-code-mcp', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-mcp')>();
  return {
    ...actual,
    addMCPStatusChangeListener: vi.fn(),
    removeMCPStatusChangeListener: vi.fn(),
  };
});

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
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
    const config = {} as CliUiRuntime;
    const { result } = renderHook(() => useCommandRegistry(config));
    await waitFor(() => expect(result.current).toStrictEqual([]));

    loaderState.fileCommands = [
      {
        name: 'trusted-file-command',
        description: 'Available only in a trusted folder',
        kind: CommandKind.FILE,
      },
    ];
    act(() => {
      coreEvents.emitFolderTrustChanged(true);
    });

    await waitFor(() => {
      expect(result.current.map((command) => command.name)).toStrictEqual([
        'trusted-file-command',
      ]);
    });
  });
});
