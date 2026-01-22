const reactStub = vi.hoisted(() => {
  let stateCursor = 0;
  const states: unknown[] = [];
  const setters: Array<(value: unknown) => void> = [];
  const listeners = new Map<number, (value: unknown) => void>();
  const effects: Array<() => void | Promise<void> | (() => void)> = [];

  const reset = () => {
    stateCursor = 0;
    effects.length = 0;
  };

  const notify = (index: number, value: unknown) => {
    const listener = listeners.get(index);
    if (listener) {
      listener(value);
    }
  };

  const useState = <T>(
    initial: T | (() => T),
  ): [T, (value: T | ((prev: T) => T)) => void] => {
    const index = stateCursor++;
    if (states[index] === undefined) {
      states[index] =
        typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    const setState = (value: T | ((prev: T) => T)) => {
      const next =
        typeof value === 'function'
          ? (value as (prev: T) => T)(states[index] as T)
          : value;
      states[index] = next;
      notify(index, next);
    };
    setters[index] = setState;
    return [states[index] as T, setState];
  };

  const useEffect = (callback: () => void | (() => void) | Promise<void>) => {
    effects.push(callback);
  };

  const runEffects = async () => {
    for (const effect of effects) {
      await effect();
    }
  };

  return {
    module: {
      useState,
      useEffect,
      useMemo: <T>(factory: () => T) => factory(),
      useCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
      useRef: <T>(initial: T) => ({ current: initial }),
      useMemoizedState: <T>(value: T) => value,
    },
    reset,
    states,
    setters,
    listeners,
    runEffects,
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    ...reactStub.module,
  };
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSlashCommandProcessor } from './slashCommandProcessor.js';
import type { SlashCommand } from '../commands/types.js';
import { CommandKind } from '../commands/types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { Config } from '@vybestack/llxprt-code-core';

const coreMocks = vi.hoisted(() => {
  const logSlashCommand = vi.fn();
  class StubLogger {
    debug = vi.fn();
  }
  const uiTelemetryService = {
    on: vi.fn(),
    off: vi.fn(),
    getMetrics: vi.fn(() => ({})),
    getLastPromptTokenCount: vi.fn(() => 0),
  };
  return {
    Config: class {},
    GitService: vi.fn(),
    Logger: StubLogger,
    logSlashCommand,
    SlashCommandEvent: class {
      name: string;
      subcommand?: string;

      constructor(name: string, subcommand?: string) {
        this.name = name;
        this.subcommand = subcommand;
      }
    },
    ToolConfirmationOutcome: {
      Cancel: 'cancel',
      ProceedAlways: 'proceedAlways',
    },
    Storage: class {},
    ProfileManager: class {},
    SubagentManager: class {},
    uiTelemetryService,
    SessionMetrics: class {},
    ModelMetrics: class {},
    DebugLogger: class {
      static enabled = false;
      log = vi.fn();
      debug = vi.fn();
      error = vi.fn();
    },
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        addStatusChangeListener: vi.fn(),
        removeStatusChangeListener: vi.fn(),
      }),
    },
  };
});

vi.mock('@vybestack/llxprt-code-core', () => coreMocks);

const sessionStatsMock = vi.hoisted(() => ({
  stats: {},
  updateHistoryTokenCount: vi.fn(),
}));

vi.mock('../contexts/SessionContext.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../contexts/SessionContext.js')>();
  return {
    ...actual,
    useSessionStats: vi.fn(() => sessionStatsMock),
  };
});

const loaderMocks = vi.hoisted(() => {
  const builtinLoaderInstance = { loadCommands: vi.fn() };
  const fileLoaderInstance = { loadCommands: vi.fn() };
  const mcpLoaderInstance = { loadCommands: vi.fn() };
  return {
    builtinLoaderInstance,
    fileLoaderInstance,
    mcpLoaderInstance,
    BuiltinCommandLoader: vi
      .fn()
      .mockImplementation(() => builtinLoaderInstance),
    FileCommandLoader: vi.fn().mockImplementation(() => fileLoaderInstance),
    McpPromptLoader: vi.fn().mockImplementation(() => mcpLoaderInstance),
  };
});

vi.mock('../../services/BuiltinCommandLoader.js', () => ({
  BuiltinCommandLoader: loaderMocks.BuiltinCommandLoader,
}));

vi.mock('../../services/FileCommandLoader.js', () => ({
  FileCommandLoader: loaderMocks.FileCommandLoader,
}));

vi.mock('../../services/McpPromptLoader.js', () => ({
  McpPromptLoader: loaderMocks.McpPromptLoader,
}));

function createTestCommand(overrides: Partial<SlashCommand>): SlashCommand {
  return {
    name: overrides.name ?? 'testcmd',
    description: overrides.description ?? 'A test command',
    kind: overrides.kind ?? CommandKind.BUILT_IN,
    action: overrides.action ?? vi.fn(),
    subCommands: overrides.subCommands,
  };
}

describe('useSlashCommandProcessor', () => {
  let mockConfig: Config;
  const mockSettings = {
    merged: {},
  } as LoadedSettings;
  let addItem: ReturnType<typeof vi.fn>;
  let clearItems: ReturnType<typeof vi.fn>;
  let loadHistory: ReturnType<typeof vi.fn>;
  let refreshStatic: ReturnType<typeof vi.fn>;
  let onDebugMessage: ReturnType<typeof vi.fn>;
  let openThemeDialog: ReturnType<typeof vi.fn>;
  let openAuthDialog: ReturnType<typeof vi.fn>;
  let openEditorDialog: ReturnType<typeof vi.fn>;
  let openProviderDialog: ReturnType<typeof vi.fn>;
  let openLoadProfileDialog: ReturnType<typeof vi.fn>;
  let openToolsDialog: ReturnType<typeof vi.fn>;
  let toggleCorgiMode: ReturnType<typeof vi.fn>;
  let setQuittingMessages: ReturnType<typeof vi.fn>;
  let openPrivacyNotice: ReturnType<typeof vi.fn>;
  let openSettingsDialog: ReturnType<typeof vi.fn>;
  let toggleVimEnabled: ReturnType<typeof vi.fn>;
  let setIsProcessing: ReturnType<typeof vi.fn>;
  let setLlxprtMdFileCount: ReturnType<typeof vi.fn>;
  let commandsPromise: Promise<void>;
  let resolveCommandsUpdate: (() => void) | undefined;
  let latestCommands: readonly SlashCommand[];

  beforeEach(() => {
    vi.clearAllMocks();
    reactStub.reset();
    latestCommands = [];
    commandsPromise = new Promise((resolve) => {
      resolveCommandsUpdate = resolve;
    });
    reactStub.listeners.set(0, (value) => {
      latestCommands = value as SlashCommand[];
      resolveCommandsUpdate?.();
    });

    loaderMocks.builtinLoaderInstance.loadCommands.mockReset();
    loaderMocks.fileLoaderInstance.loadCommands.mockReset();
    loaderMocks.mcpLoaderInstance.loadCommands.mockReset();
    loaderMocks.builtinLoaderInstance.loadCommands.mockResolvedValue([]);
    loaderMocks.fileLoaderInstance.loadCommands.mockResolvedValue([]);
    loaderMocks.mcpLoaderInstance.loadCommands.mockResolvedValue([]);

    sessionStatsMock.updateHistoryTokenCount.mockReset();

    const mockIdeClient = {
      addStatusChangeListener: vi.fn(),
      removeStatusChangeListener: vi.fn(),
    };

    mockConfig = {
      getIdeClient: vi.fn().mockReturnValue(mockIdeClient),
      getProjectRoot: vi.fn().mockReturnValue('/test/project'),
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getDebugMode: vi.fn().mockReturnValue(false),
      getTargetDir: vi.fn().mockReturnValue('/test/project'),
      getUserMemory: vi.fn().mockReturnValue(''),
      setUserMemory: vi.fn(),
      getApprovalMode: vi.fn().mockReturnValue('default'),
      setApprovalMode: vi.fn(),
      getGeminiClient: vi.fn().mockReturnValue(undefined),
      storage: undefined,
    } as unknown as Config;

    addItem = vi.fn();
    clearItems = vi.fn();
    loadHistory = vi.fn().mockResolvedValue(undefined);
    refreshStatic = vi.fn();
    onDebugMessage = vi.fn();
    openThemeDialog = vi.fn();
    openAuthDialog = vi.fn();
    openEditorDialog = vi.fn();
    openProviderDialog = vi.fn();
    openLoadProfileDialog = vi.fn();
    openToolsDialog = vi.fn();
    toggleCorgiMode = vi.fn();
    setQuittingMessages = vi.fn();
    openPrivacyNotice = vi.fn();
    openSettingsDialog = vi.fn();
    toggleVimEnabled = vi.fn().mockResolvedValue(true);
    setIsProcessing = vi.fn();
    setLlxprtMdFileCount = vi.fn();
  });

  it('loads slash commands via BuiltinCommandLoader', async () => {
    const testCommand = createTestCommand({ name: 'subagent' });
    loaderMocks.builtinLoaderInstance.loadCommands.mockResolvedValue([
      testCommand,
    ]);

    useSlashCommandProcessor(
      mockConfig,
      mockSettings,
      addItem,
      clearItems,
      loadHistory,
      refreshStatic,
      onDebugMessage,
      openThemeDialog,
      openAuthDialog,
      openEditorDialog,
      openProviderDialog,
      openLoadProfileDialog,
      openToolsDialog,
      toggleCorgiMode,
      setQuittingMessages,
      openPrivacyNotice,
      openSettingsDialog,
      toggleVimEnabled,
      setIsProcessing,
      setLlxprtMdFileCount,
    );

    await reactStub.runEffects();
    await loaderMocks.builtinLoaderInstance.loadCommands.mock.results.at(-1)
      ?.value;
    await commandsPromise;

    expect(latestCommands).toEqual([testCommand]);
  });
});
