/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SimpleExtensionLoader } from './extensionLoader.js';
import type { Config } from '../config/config.js';
import type { McpClientManager } from '../tools/mcp-client-manager.js';

describe('SimpleExtensionLoader', () => {
  let mockConfig: Config;
  let extensionReloadingEnabled: boolean;
  let mockMcpClientManager: McpClientManager;
  const activeExtension = {
    name: 'test-extension',
    isActive: true,
    version: '1.0.0',
    path: '/path/to/extension',
    contextFiles: [],
    id: '123',
  };
  const inactiveExtension = {
    name: 'test-extension',
    isActive: false,
    version: '1.0.0',
    path: '/path/to/extension',
    contextFiles: [],
    id: '123',
  };

  beforeEach(() => {
    mockMcpClientManager = {
      startExtension: vi.fn(),
      stopExtension: vi.fn(),
    } as unknown as McpClientManager;
    extensionReloadingEnabled = false;
    mockConfig = {
      getMcpClientManager: () => mockMcpClientManager,
      getEnableExtensionReloading: () => extensionReloadingEnabled,
      refreshMemory: vi.fn(),
      getHookSystem: () => undefined,
      getSubagentManager: vi.fn().mockReturnValue({
        removeExtensionSubagents: vi.fn(),
      }),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as Config;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start active extensions', async () => {
    const loader = new SimpleExtensionLoader([activeExtension]);
    await loader.start(mockConfig);
    expect(mockMcpClientManager.startExtension).toHaveBeenCalledExactlyOnceWith(
      activeExtension,
    );
  });

  it('should not start inactive extensions', async () => {
    const loader = new SimpleExtensionLoader([inactiveExtension]);
    await loader.start(mockConfig);
    expect(mockMcpClientManager.startExtension).not.toHaveBeenCalled();
  });

  describe('interactive extension loading and unloading', () => {
    it('should not call `start` or `stop` if the loader is not already started', async () => {
      const loader = new SimpleExtensionLoader([]);
      await loader.loadExtension(activeExtension);
      expect(mockMcpClientManager.startExtension).not.toHaveBeenCalled();
      await loader.unloadExtension(activeExtension);
      expect(mockMcpClientManager.stopExtension).not.toHaveBeenCalled();
    });

    it('should start extensions that were explicitly loaded prior to initializing the loader', async () => {
      const loader = new SimpleExtensionLoader([]);
      await loader.loadExtension(activeExtension);
      expect(mockMcpClientManager.startExtension).not.toHaveBeenCalled();
      await loader.start(mockConfig);
      expect(
        mockMcpClientManager.startExtension,
      ).toHaveBeenCalledExactlyOnceWith(activeExtension);
    });

    it.each([true, false])(
      'should only call `start` and `stop` if extension reloading is enabled ($i)',
      async (reloadingEnabled) => {
        extensionReloadingEnabled = reloadingEnabled;
        const loader = new SimpleExtensionLoader([]);
        await loader.start(mockConfig);
        expect(mockMcpClientManager.startExtension).not.toHaveBeenCalled();
        await loader.loadExtension(activeExtension);
        const expectedStartCalls = reloadingEnabled ? 1 : 0;
        const expectedStopCalls = reloadingEnabled ? 1 : 0;

        await loader.unloadExtension(activeExtension);

        expect(mockMcpClientManager.startExtension).toHaveBeenCalledTimes(
          expectedStartCalls,
        );
        expect(mockMcpClientManager.stopExtension).toHaveBeenCalledTimes(
          expectedStopCalls,
        );

        const actualStartCalls = mockMcpClientManager.startExtension.mock.calls;
        const actualStopCalls = mockMcpClientManager.stopExtension.mock.calls;

        const expectedStartCallArguments = reloadingEnabled
          ? [[activeExtension]]
          : [];
        const expectedStopCallArguments = reloadingEnabled
          ? [[activeExtension]]
          : [];

        expect(actualStartCalls).toEqual(expectedStartCallArguments);
        expect(actualStopCalls).toEqual(expectedStopCallArguments);
      },
    );
  });

  describe('Hook system integration (126c32ac)', () => {
    it('should call hookSystem.initialize() after extension changes', async () => {
      const mockHookSystemInit = vi.fn();
      const mockRefreshMemory = vi.fn();

      const mockConfigWithHooks = {
        getMcpClientManager: () => ({
          startExtension: vi.fn(),
        }),
        getEnableExtensionReloading: () => true,
        refreshMemory: mockRefreshMemory,
        getHookSystem: () => ({
          initialize: mockHookSystemInit,
        }),
      } as unknown as Config;

      const extensionWithHooks = {
        name: 'test-ext',
        isActive: true,
        version: '1.0.0',
        path: '/ext',
        contextFiles: [],
        id: 'ext-123',
      };

      extensionReloadingEnabled = true;
      const loader = new SimpleExtensionLoader([]);
      await loader.start(mockConfigWithHooks);

      mockRefreshMemory.mockClear();
      mockHookSystemInit.mockClear();

      // Load extension — triggers refresh
      await loader.loadExtension(extensionWithHooks);

      expect(mockRefreshMemory).toHaveBeenCalledOnce();
      expect(mockHookSystemInit).toHaveBeenCalledOnce();
    });

    it('should call hookSystem.initialize() after unload', async () => {
      const mockHookSystemInit = vi.fn();
      const mockRefreshMemory = vi.fn();

      const mockConfigWithHooks = {
        getMcpClientManager: () => ({
          startExtension: vi.fn(),
          stopExtension: vi.fn(),
        }),
        getEnableExtensionReloading: () => true,
        refreshMemory: mockRefreshMemory,
        getHookSystem: () => ({
          initialize: mockHookSystemInit,
        }),
        getSubagentManager: vi.fn(() => ({
          removeExtensionSubagents: vi.fn(),
        })),
      } as unknown as Config;

      const extensionWithHooks = {
        name: 'test-ext',
        isActive: true,
        version: '1.0.0',
        path: '/ext',
        contextFiles: [],
        id: 'ext-123',
      };

      extensionReloadingEnabled = true;
      const loader = new SimpleExtensionLoader([extensionWithHooks]);
      await loader.start(mockConfigWithHooks);

      mockRefreshMemory.mockClear();
      mockHookSystemInit.mockClear();

      // Unload extension — triggers refresh
      await loader.unloadExtension(extensionWithHooks);

      expect(mockRefreshMemory).toHaveBeenCalledOnce();
      expect(mockHookSystemInit).toHaveBeenCalledOnce();
    });
  });
});
