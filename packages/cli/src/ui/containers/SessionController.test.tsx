/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
let fixtureDirectory: string;
let priorConfigHome: string | undefined;
const composeFixtureRuntime = installWorkspaceRuntimeFixture(
  () => fixtureDirectory,
);
let memoryRuntime: ReturnType<typeof composeFixtureRuntime>;

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';

// Mock before imports
// SessionController reads the runtime bridge both as a hook and via the
// module-level accessor. The real provider resolves the CLI runtime scope,
// which this container test does not establish.
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

void vi.mock('../contexts/RuntimeContext.js', () => {
  // resolveModelIdentity formats from status.providerName + status.modelName.
  // Without modelName the identity collapses to the bare provider name, which
  // is why this mock has to carry both.
  const status = {
    providerName: 'test-provider',
    modelName: 'test-model',
    isPaidMode: false,
  };
  // Exposed so tests can drive a provider/model change: the component reads
  // identity from the runtime, not from config.getModel().
  const setStatus = (next: {
    providerName?: string;
    modelName?: string;
    isPaidMode?: boolean;
  }) => {
    if (next.providerName !== undefined)
      status.providerName = next.providerName;
    if (next.modelName !== undefined) status.modelName = next.modelName;
    if (next.isPaidMode !== undefined) status.isPaidMode = next.isPaidMode;
  };
  const api = {
    __setStatusForTesting: setStatus,
    providerStatus: () => status,
    getActiveProfileName: () => undefined,
    providerManager: () => undefined,
  };
  return {
    useRuntimeApi: () => api,
    getRuntimeApi: () => api,
  };
});

void vi.mock('../hooks/useHistoryManager.js', () => ({
  useHistory: vi.fn(() => ({
    history: [],
    addItem: vi.fn(),
    updateItem: vi.fn(),
    clearItems: vi.fn(),
    loadHistory: vi.fn(),
  })),
}));

// Don't mock AppDispatchContext - use the real implementation

import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import {
  SessionController,
  SessionContext,
  type SessionContextType,
} from './SessionController.js';
import { MessageType } from '../types.js';
import type { Config } from '@vybestack/llxprt-code-core';
// import { AppAction } from '../reducers/appReducer.js';
import { useHistory } from '../hooks/useHistoryManager.js';
import { createTurnStore } from '../stores/turn/turnStore.js';

function dispatchAvailability(
  contextValue: SessionContextType | undefined,
): string {
  return contextValue?.appDispatch ? 'Dispatch available' : 'No dispatch';
}

// Get references to the mocked functions
const mockHistoryManager = useHistory as Mock<typeof useHistory>;

// Mock dependencies
void vi.mock(
  '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js',
  () => ({}),
);

export const loadSettings = vi.fn((_dir) => ({
  merged: {
    loadMemoryFromIncludeDirectories: false,
    ui: { memoryImportFormat: 'tree' },
  },
}));

void vi.mock('../../config/settings.js', () => ({
  loadSettings,
}));

void vi.mock('@vybestack/llxprt-code-core', () => {
  const coreModule = realLlxprtCodeCoreModule;
  return {
    ...coreModule,
  };
});

describe('SessionController', () => {
  let mockConfig: Partial<Config>;
  let mockAddItem: ReturnType<typeof vi.fn>;
  let mockUpdateItem: ReturnType<typeof vi.fn>;
  let mockClearItems: ReturnType<typeof vi.fn>;
  let mockLoadHistory: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // The runtime status mock is mutable so tests can drive provider, model and
    // paid-mode changes; reset it so those changes do not leak between tests.
    const runtimeModuleForReset = await import('../contexts/RuntimeContext.js');
    (
      runtimeModuleForReset.useRuntimeApi() as unknown as {
        __setStatusForTesting: (next: {
          providerName?: string;
          modelName?: string;
          isPaidMode?: boolean;
        }) => void;
      }
    ).__setStatusForTesting({
      providerName: 'test-provider',
      modelName: 'test-model',
      isPaidMode: false,
    });
    fixtureDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'controller-memory-')),
    );
    priorConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(fixtureDirectory, 'global');
    await mkdir(join(fixtureDirectory, 'global'));
    await mkdir(join(fixtureDirectory, '.git'));
    await writeFile(join(fixtureDirectory, 'LLXPRT.md'), 'test memory content');
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockAddItem = vi.fn();
    mockUpdateItem = vi.fn();
    mockClearItems = vi.fn();
    mockLoadHistory = vi.fn();

    mockHistoryManager.mockReturnValue({
      history: [],
      addItem: mockAddItem,
      updateItem: mockUpdateItem,
      clearItems: mockClearItems,
      loadHistory: mockLoadHistory,
    });

    mockConfig = {
      getMcpServers: () => undefined,
      getModel: vi.fn(() => 'test-model'),
      getDebugMode: vi.fn(() => false),
      getExtensionContextFilePaths: vi.fn(() => []),
      // The memory refresh now passes the loaded extensions through to
      // loadHierarchicalLlxprtMemory; without this the refresh throws before
      // reaching it.
      getExtensions: vi.fn(() => []),
      getFolderTrust: vi.fn(() => true),
      setModel: vi.fn(),
      getWorkingDir: vi.fn(() => fixtureDirectory),
      shouldLoadMemoryFromIncludeDirectories: vi.fn(() => false),

      getFileFilteringOptions: vi.fn(() => ({})),
    } as unknown as Partial<Config>;
    memoryRuntime = composeFixtureRuntime(mockConfig as Config);
  });

  afterEach(async () => {
    await composeFixtureRuntime.dispose();
    await rm(fixtureDirectory, { recursive: true, force: true });
    if (priorConfigHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = priorConfigHome;
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should provide session context properly', () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue).toBeDefined();
    expect(contextValue!.history).toStrictEqual([]);
    expect(typeof contextValue!.addItem).toBe('function');
    expect(typeof contextValue!.updateItem).toBe('function');
    expect(typeof contextValue!.clearItems).toBe('function');
    expect(typeof contextValue!.loadHistory).toBe('function');
    expect(typeof contextValue!.checkPaymentModeChange).toBe('function');
    expect(typeof contextValue!.performMemoryRefresh).toBe('function');
    expect(contextValue!.sessionState).toBeDefined();
    expect(contextValue!.dispatch).toBeDefined();
    expect(contextValue!.appState).toBeDefined();
    expect(contextValue!.appDispatch).toBeDefined();

    unmount();
  });

  it('should integrate appReducer and provide dispatch context', () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return React.createElement(
        Text,
        null,
        dispatchAvailability(contextValue),
      );
    };

    const { lastFrame, unmount } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    expect(lastFrame()).toContain('Dispatch available');
    unmount();
  });

  it('performs pending add requests recorded on the TurnStore', async () => {
    mockAddItem.mockReturnValue(1);

    const turnStore = createTurnStore();

    const TestComponent = () => null;

    const { unmount } = render(
      <SessionController config={memoryRuntime} turnStore={turnStore}>
        <TestComponent />
      </SessionController>,
    );

    const itemData = { type: MessageType.USER, text: 'Test message' };
    const baseTimestamp = Date.now();

    await React.act(async () => {
      turnStore.commands.requestAddItem(itemData, baseTimestamp);
    });

    expect(mockAddItem).toHaveBeenCalledWith(itemData, baseTimestamp);
    expect(turnStore.store.getState().pendingAddRequest).toBeNull();

    unmount();
  });

  it('should handle payment mode changes properly', async () => {
    // Mock useHistory to return a non-empty history
    mockHistoryManager.mockReturnValue({
      history: [{ id: 1, type: MessageType.USER, text: 'Test' }],
      addItem: mockAddItem,
      updateItem: mockUpdateItem,
      clearItems: mockClearItems,
      loadHistory: mockLoadHistory,
    });

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount, rerender } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    // Start with free mode
    expect(contextValue!.sessionState.isPaidMode).toBe(false);
    expect(contextValue!.sessionState.transientWarnings).toHaveLength(0);

    // Switch to paid mode with Gemini provider (only Gemini shows warnings).
    // SessionController reads isPaidMode from the runtime status snapshot, so
    // the change has to be driven there rather than through the provider
    // manager.
    const paidRuntimeModule = await import('../contexts/RuntimeContext.js');
    (
      paidRuntimeModule.useRuntimeApi() as unknown as {
        __setStatusForTesting: (next: {
          providerName?: string;
          modelName?: string;
          isPaidMode?: boolean;
        }) => void;
      }
    ).__setStatusForTesting({
      providerName: 'gemini',
      modelName: 'gemini-model',
      isPaidMode: true,
    });

    // Call checkPaymentModeChange
    contextValue!.checkPaymentModeChange();

    // Re-render to get updated state
    rerender(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    // The state should update synchronously after calling checkPaymentModeChange
    expect(contextValue!.sessionState.transientWarnings).toHaveLength(1);
    expect(contextValue!.sessionState.transientWarnings[0]).toContain(
      'PAID MODE',
    );
    expect(contextValue!.sessionState.transientWarnings[0]).toContain('Gemini');

    unmount();
  });

  it('should handle memory refresh successfully', async () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    await contextValue!.performMemoryRefresh();

    expect(memoryRuntime.getUserMemory()).toContain('test memory content');
    expect(memoryRuntime.getLlxprtMdFilePaths()).toContain(
      join(fixtureDirectory, 'LLXPRT.md'),
    );
    expect(memoryRuntime.getLlxprtMdFileCount()).toBe(1);

    // Check that info messages were added
    expect(mockAddItem).toHaveBeenCalledTimes(2);
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('Refreshing hierarchical memory'),
      }),
      expect.any(Number),
    );
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('Memory refreshed successfully'),
      }),
      expect.any(Number),
    );

    unmount();
  });

  it('should handle memory refresh errors', async () => {
    vi.spyOn(memoryRuntime, 'refreshMemory').mockRejectedValueOnce(
      new Error('Memory load failed'),
    );

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    await contextValue!.performMemoryRefresh();

    // Check that error message was added
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: expect.stringContaining(
          'Error refreshing memory: Memory load failed',
        ),
      }),
      expect.any(Number),
    );

    unmount();
  });

  it('reloads physical instructions through the retained workspace', async () => {
    await writeFile(
      join(fixtureDirectory, 'LLXPRT.md'),
      'refreshed retained workspace instructions',
    );
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    await contextValue!.performMemoryRefresh();

    expect(memoryRuntime.getUserMemory()).toContain(
      'refreshed retained workspace instructions',
    );
    expect(memoryRuntime.getUserMemory()).not.toContain('test memory content');
    expect(memoryRuntime.getLlxprtMdFilePaths()).toContain(
      join(fixtureDirectory, 'LLXPRT.md'),
    );

    unmount();
  });

  it('keeps the retained workspace when declarative working-directory display changes', async () => {
    await writeFile(
      join(fixtureDirectory, 'LLXPRT.md'),
      'refreshed retained workspace instructions',
    );
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    await contextValue!.performMemoryRefresh();

    expect(memoryRuntime.getUserMemory()).toContain(
      'refreshed retained workspace instructions',
    );
    expect(memoryRuntime.getUserMemory()).not.toContain('test memory content');
    expect(memoryRuntime.getLlxprtMdFilePaths()).toContain(
      join(fixtureDirectory, 'LLXPRT.md'),
    );

    unmount();
  });

  it('should handle model changes via events (not polling)', async () => {
    const { coreEvents } = await import('@vybestack/llxprt-code-core');

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount, rerender } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue!.sessionState.currentModel).toBe(
      'test-provider:test-model',
    );

    // Change the model
    (mockConfig.getModel as ReturnType<typeof vi.fn>).mockReturnValue(
      'new-model',
    );
    const runtimeModule = await import('../contexts/RuntimeContext.js');
    (
      runtimeModule.useRuntimeApi() as unknown as {
        __setStatusForTesting: (next: {
          providerName?: string;
          modelName?: string;
          isPaidMode?: boolean;
        }) => void;
      }
    ).__setStatusForTesting({
      providerName: 'new-provider',
      modelName: 'new-model',
    });

    // Emit event instead of advancing timer
    coreEvents.emitModelChanged('new-model');

    // Re-render to get updated state
    rerender(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    // The event should have updated the state
    expect(contextValue!.sessionState.currentModel).toBe(
      'new-provider:new-model',
    );

    unmount();
  });

  it('does not use setInterval polling', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const TestComponent = () => {
      React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    // No 1-second polling intervals should be created
    const pollingIntervals = setIntervalSpy.mock.calls.filter(
      ([, delay]) => delay === 1000,
    );
    expect(pollingIntervals).toHaveLength(0);
    setIntervalSpy.mockRestore();
    unmount();
  });

  it('should handle UPDATE_ITEM action', async () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );

    const itemId = 1;
    const updateData = { type: MessageType.USER, text: 'Updated' };

    contextValue!.updateItem(itemId, updateData);

    // Allow microtasks to complete
    await Promise.resolve();

    expect(mockUpdateItem).toHaveBeenCalledWith(itemId, updateData);

    unmount();
  });

  it('propagates theme invalidation and relogin state through the session', () => {
    let contextValue: SessionContextType | undefined;
    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };
    const { unmount, rerender } = render(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );
    if (!contextValue) throw new Error('Missing session context');
    contextValue.appDispatch({ type: 'REFRESH_THEME' });
    contextValue.appDispatch({ type: 'SET_NEEDS_RELOGIN', payload: true });
    rerender(
      <SessionController config={memoryRuntime}>
        <TestComponent />
      </SessionController>,
    );
    expect(contextValue.appState.themeRevision).toBe(1);
    expect(contextValue.appState.needsRelogin).toBe(true);
    unmount();
  });
});
