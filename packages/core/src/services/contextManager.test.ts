/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import type { Config } from '../config/config.js';
import { coreEvents, CoreEvent } from '../utils/events.js';
import type { MemoryLoadResult } from '../utils/memoryDiscovery.js';

const mockLoadGlobalMemory = vi.fn();
const mockLoadEnvironmentMemory = vi.fn();
const mockLoadJitSubdirectoryMemory = vi.fn();
const mockLoadCoreMemory = vi.fn();

// Mock memoryDiscovery module
vi.mock('../utils/memoryDiscovery.js', (importOriginal) => {
  const actual =
    importOriginal() as typeof import('../utils/memoryDiscovery.js');
  return {
    ...actual,
    loadGlobalMemory: mockLoadGlobalMemory,
    loadEnvironmentMemory: mockLoadEnvironmentMemory,
    loadJitSubdirectoryMemory: mockLoadJitSubdirectoryMemory,
    loadCoreMemory: mockLoadCoreMemory,
    concatenateInstructions: actual.concatenateInstructions,
  };
});

const { ContextManager } = await import('./contextManager.js');

describe('ContextManager', () => {
  let contextManager: ContextManager;
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      getDebugMode: vi.fn().mockReturnValue(false),
      getWorkingDir: vi.fn().mockReturnValue('/app'),
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue(['/app']),
      }),
      getExtensionLoader: vi.fn().mockReturnValue({}),
      getMcpClientManager: vi.fn().mockReturnValue({
        getMcpInstructions: vi.fn().mockReturnValue('MCP Instructions'),
      }),
    } as unknown as Config;

    contextManager = new ContextManager(mockConfig);
    vi.clearAllMocks();
    vi.spyOn(coreEvents, 'emit');
  });

  describe('refresh', () => {
    it('should load and format global and environment memory', async () => {
      const mockGlobalResult: MemoryLoadResult = {
        files: [
          {
            path: '/home/user/.llxprt/.LLXPRT_SYSTEM',
            content: 'Global Content',
          },
        ],
      };
      mockLoadGlobalMemory.mockResolvedValue(mockGlobalResult);

      const mockEnvResult: MemoryLoadResult = {
        files: [{ path: '/app/.llxprt/LLXPRT.md', content: 'Env Content' }],
      };
      mockLoadEnvironmentMemory.mockResolvedValue(mockEnvResult);

      const mockCoreResult: MemoryLoadResult = {
        files: [],
      };
      mockLoadCoreMemory.mockResolvedValue(mockCoreResult);

      await contextManager.refresh();

      expect(mockLoadGlobalMemory).toHaveBeenCalledWith(false);
      expect(contextManager.getGlobalMemory()).toMatch(
        /--- Context from: .*LLXPRT_SYSTEM ---/,
      );
      expect(contextManager.getGlobalMemory()).toContain('Global Content');

      expect(mockLoadEnvironmentMemory).toHaveBeenCalledWith(
        ['/app'],
        expect.anything(),
        false,
      );
      expect(contextManager.getEnvironmentMemory()).toContain(
        `--- Context from: ${path.join('.llxprt', 'LLXPRT.md')} ---`,
      );
      expect(contextManager.getEnvironmentMemory()).toContain('Env Content');
      expect(contextManager.getEnvironmentMemory()).toContain(
        'MCP Instructions',
      );

      expect(mockLoadCoreMemory).toHaveBeenCalledWith(['/app'], false);

      expect(contextManager.getLoadedPaths()).toContain(
        '/home/user/.llxprt/.LLXPRT_SYSTEM',
      );
      expect(contextManager.getLoadedPaths()).toContain(
        '/app/.llxprt/LLXPRT.md',
      );
    });

    it('should emit MemoryChanged event when memory is refreshed', async () => {
      const mockGlobalResult = {
        files: [{ path: '/app/.llxprt/LLXPRT.md', content: 'content' }],
      };
      const mockEnvResult = {
        files: [{ path: '/app/src/.llxprt/LLXPRT.md', content: 'env content' }],
      };
      const mockCoreResult = {
        files: [],
      };
      mockLoadGlobalMemory.mockResolvedValue(mockGlobalResult);
      mockLoadEnvironmentMemory.mockResolvedValue(mockEnvResult);
      mockLoadCoreMemory.mockResolvedValue(mockCoreResult);

      await contextManager.refresh();

      expect(coreEvents.emit).toHaveBeenCalledWith(CoreEvent.MemoryChanged, {
        fileCount: 2,
        coreMemoryFileCount: 0,
      });
    });

    it('should load core memory during refresh', async () => {
      const mockGlobalResult = {
        files: [],
      };
      const mockEnvResult = {
        files: [],
      };
      const mockCoreResult = {
        files: [
          { path: '/app/.llxprt/.LLXPRT_SYSTEM', content: 'Core content' },
        ],
      };
      mockLoadGlobalMemory.mockResolvedValue(mockGlobalResult);
      mockLoadEnvironmentMemory.mockResolvedValue(mockEnvResult);
      mockLoadCoreMemory.mockResolvedValue(mockCoreResult);

      await contextManager.refresh();

      expect(mockLoadCoreMemory).toHaveBeenCalledWith(['/app'], false);
      expect(contextManager.getCoreMemory()).toContain('Core content');
      expect(contextManager.getLoadedPaths()).toContain(
        '/app/.llxprt/.LLXPRT_SYSTEM',
      );
      expect(contextManager.getCoreMemoryFileCount()).toBe(1);
      expect(contextManager.getContextFileCount()).toBe(0);
    });

    it('should emit separate core memory and context file counts', async () => {
      const mockGlobalResult = {
        files: [
          {
            path: '/home/user/.llxprt/.LLXPRT_SYSTEM',
            content: 'Global System',
          },
        ],
      };
      const mockEnvResult = {
        files: [{ path: '/app/.llxprt/LLXPRT.md', content: 'Env Content' }],
      };
      const mockCoreResult = {
        files: [
          { path: '/app/.llxprt/.LLXPRT_SYSTEM', content: 'Core content' },
        ],
      };
      mockLoadGlobalMemory.mockResolvedValue(mockGlobalResult);
      mockLoadEnvironmentMemory.mockResolvedValue(mockEnvResult);
      mockLoadCoreMemory.mockResolvedValue(mockCoreResult);

      await contextManager.refresh();

      expect(contextManager.getContextFileCount()).toBe(2);
      expect(contextManager.getCoreMemoryFileCount()).toBe(1);
      expect(coreEvents.emit).toHaveBeenCalledWith(CoreEvent.MemoryChanged, {
        fileCount: 2,
        coreMemoryFileCount: 1,
      });
    });
  });

  describe('loadJitSubdirectoryMemory', () => {
    it('should load subdirectory memory without duplicating already-loaded paths', async () => {
      const mockGlobalResult = {
        files: [{ path: '/app/.llxprt/LLXPRT.md', content: 'root' }],
      };
      const mockEnvResult = {
        files: [{ path: '/app/.llxprt/LLXPRT.md', content: 'root' }],
      };
      const mockCoreResult = {
        files: [],
      };
      mockLoadGlobalMemory.mockResolvedValue(mockGlobalResult);
      mockLoadEnvironmentMemory.mockResolvedValue(mockEnvResult);
      mockLoadCoreMemory.mockResolvedValue(mockCoreResult);

      await contextManager.refresh();

      const mockSubdirResult = {
        files: [
          { path: '/app/.llxprt/LLXPRT.md', content: 'root' },
          { path: '/app/src/.llxprt/LLXPRT.md', content: 'subdir' },
        ],
      };
      mockLoadJitSubdirectoryMemory.mockResolvedValue(mockSubdirResult);

      const result = await contextManager.loadJitSubdirectoryMemory('/app/src');

      expect(mockLoadJitSubdirectoryMemory).toHaveBeenCalledWith(
        '/app/src',
        ['/app'],
        expect.any(Set),
        false,
      );
      expect(result).toContain('subdir');
      expect(result).not.toContain('root');
    });

    it('should return empty string if all files were already loaded', async () => {
      const mockResult = {
        files: [{ path: '/app/.llxprt/LLXPRT.md', content: 'content' }],
      };
      const mockCoreResult = {
        files: [],
      };
      mockLoadGlobalMemory.mockResolvedValue(mockResult);
      mockLoadEnvironmentMemory.mockResolvedValue({
        files: [],
      });
      mockLoadCoreMemory.mockResolvedValue(mockCoreResult);

      await contextManager.refresh();

      mockLoadJitSubdirectoryMemory.mockResolvedValue(mockResult);

      const result = await contextManager.loadJitSubdirectoryMemory('/app');

      expect(result).toBe('');
    });
  });
});
