/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import {
  SimpleExtensionLoader,
  type ExtensionRuntimeConfiguration,
} from './extensionLoader.js';
import type { LlxprtExtension } from '../config/config.js';

describe('SimpleExtensionLoader', () => {
  let mockConfig: ExtensionRuntimeConfiguration;
  let refreshMemory: Mock<() => Promise<void>>;
  let extensionReloadingEnabled: boolean;
  let mockMcpClientManager: {
    startExtension: Mock<(extension: LlxprtExtension) => Promise<void>>;
    stopExtension: Mock<(extension: LlxprtExtension) => Promise<void>>;
  };
  const activeExtension = {
    name: 'test-extension',
    isActive: true,
    version: '1.0.0',
    path: '/path/to/extension',
    contextFiles: [],
    id: '123',
  };

  function expectedStartCallsFor(reloadingEnabled: boolean): number {
    return reloadingEnabled ? 1 : 0;
  }

  function expectedStopCallsFor(reloadingEnabled: boolean): number {
    return reloadingEnabled ? 1 : 0;
  }

  function expectedCallArgumentsFor(
    reloadingEnabled: boolean,
  ): Array<[LlxprtExtension]> {
    return reloadingEnabled ? [[activeExtension]] : [];
  }

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
      startExtension: vi
        .fn<(extension: LlxprtExtension) => Promise<void>>()
        .mockResolvedValue(undefined),
      stopExtension: vi
        .fn<(extension: LlxprtExtension) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    refreshMemory = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    extensionReloadingEnabled = false;
    mockConfig = {
      getEnableExtensionReloading: () => extensionReloadingEnabled,
      setExtensions: () => {},
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start active extensions', async () => {
    const loader = new SimpleExtensionLoader([activeExtension]);
    await loader.start(
      mockConfig,
      (extension) => mockMcpClientManager.startExtension(extension),
      (extension) => mockMcpClientManager.stopExtension(extension),
      undefined,
      undefined,
      refreshMemory,
    );
    expect(mockMcpClientManager.startExtension).toHaveBeenCalledTimes(1);
    expect(mockMcpClientManager.startExtension).toHaveBeenCalledWith(
      activeExtension,
    );
  });

  it('should not start inactive extensions', async () => {
    const loader = new SimpleExtensionLoader([inactiveExtension]);
    await loader.start(
      mockConfig,
      (extension) => mockMcpClientManager.startExtension(extension),
      (extension) => mockMcpClientManager.stopExtension(extension),
      undefined,
      undefined,
      refreshMemory,
    );
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
      await loader.start(
        mockConfig,
        (extension) => mockMcpClientManager.startExtension(extension),
        (extension) => mockMcpClientManager.stopExtension(extension),
        undefined,
        undefined,
        refreshMemory,
      );
      expect(mockMcpClientManager.startExtension).toHaveBeenCalledTimes(1);
      expect(mockMcpClientManager.startExtension).toHaveBeenCalledWith(
        activeExtension,
      );
    });

    it.each([true, false])(
      'should only call `start` and `stop` if extension reloading is enabled ($i)',
      async (reloadingEnabled) => {
        extensionReloadingEnabled = reloadingEnabled;
        const loader = new SimpleExtensionLoader([]);
        await loader.start(
          mockConfig,
          (extension) => mockMcpClientManager.startExtension(extension),
          (extension) => mockMcpClientManager.stopExtension(extension),
          undefined,
          undefined,
          refreshMemory,
        );
        expect(mockMcpClientManager.startExtension).not.toHaveBeenCalled();
        await loader.loadExtension(activeExtension);

        await loader.unloadExtension(activeExtension);

        expect(mockMcpClientManager.startExtension).toHaveBeenCalledTimes(
          expectedStartCallsFor(reloadingEnabled),
        );
        expect(mockMcpClientManager.stopExtension).toHaveBeenCalledTimes(
          expectedStopCallsFor(reloadingEnabled),
        );

        const actualStartCalls = mockMcpClientManager.startExtension.mock.calls;
        const actualStopCalls = mockMcpClientManager.stopExtension.mock.calls;

        expect(actualStartCalls).toStrictEqual(
          expectedCallArgumentsFor(reloadingEnabled),
        );
        expect(actualStopCalls).toStrictEqual(
          expectedCallArgumentsFor(reloadingEnabled),
        );
      },
    );
  });

  describe('Hook system integration (126c32ac)', () => {
    it('should call hookSystem.initialize() after extension changes', async () => {
      const mockHookSystemInit = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);
      const mockRefreshMemory = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);

      const mockConfigWithHooks: ExtensionRuntimeConfiguration = {
        getEnableExtensionReloading: () => true,
        setExtensions: () => {},
      };

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
      await loader.start(
        mockConfigWithHooks,
        (extension) => mockMcpClientManager.startExtension(extension),
        (extension) => mockMcpClientManager.stopExtension(extension),
        undefined,
        undefined,
        mockRefreshMemory,
        mockHookSystemInit,
      );

      mockRefreshMemory.mockClear();
      mockHookSystemInit.mockClear();

      // Load extension — triggers refresh
      await loader.loadExtension(extensionWithHooks);

      expect(mockRefreshMemory).toHaveBeenCalledOnce();
      expect(mockHookSystemInit).toHaveBeenCalledOnce();
    });

    it('should call hookSystem.initialize() after unload', async () => {
      const mockHookSystemInit = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);
      const mockRefreshMemory = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);

      const mockConfigWithHooks: ExtensionRuntimeConfiguration = {
        getEnableExtensionReloading: () => true,
        setExtensions: () => {},
      };

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
      await loader.start(
        mockConfigWithHooks,
        (extension) => mockMcpClientManager.startExtension(extension),
        (extension) => mockMcpClientManager.stopExtension(extension),
        undefined,
        undefined,
        mockRefreshMemory,
        mockHookSystemInit,
      );

      mockRefreshMemory.mockClear();
      mockHookSystemInit.mockClear();

      // Unload extension — triggers refresh
      await loader.unloadExtension(extensionWithHooks);

      expect(mockRefreshMemory).toHaveBeenCalledOnce();
      expect(mockHookSystemInit).toHaveBeenCalledOnce();
    });
  });
});
