/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManager } from './contextManager.js';
import * as memoryDiscovery from '../utils/memoryDiscovery.js';
import type { Config } from '../config/config.js';
import { coreEvents, CoreEvent } from '../utils/events.js';

// Mock memoryDiscovery module
vi.mock('../utils/memoryDiscovery.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../utils/memoryDiscovery.js')>();
  return {
    ...actual,
    loadGlobalMemory: vi.fn(),
    loadEnvironmentMemory: vi.fn(),
    loadJitSubdirectoryMemory: vi.fn(),
    concatenateInstructions: vi
      .fn()
      .mockImplementation(actual.concatenateInstructions),
  };
});

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
      const mockGlobalResult: memoryDiscovery.MemoryLoadResult = {
        files: [
          {
            path: '/home/user/.llxprt/.LLXPRT_SYSTEM',
            content: 'Global Content',
          },
        ],
      };
      vi.mocked(memoryDiscovery.loadGlobalMemory).mockResolvedValue(
        mockGlobalResult,
      );

      const mockEnvResult: memoryDiscovery.MemoryLoadResult = {
        files: [{ path: '/app/.llxprt/LLXPRT.md', content: 'Env Content' }],
      };
      vi.mocked(memoryDiscovery.loadEnvironmentMemory).mockResolvedValue(
        mockEnvResult,
      );

      await contextManager.refresh();

      expect(memoryDiscovery.loadGlobalMemory).toHaveBeenCalledWith(false);
      expect(contextManager.getGlobalMemory()).toMatch(
        /--- Context from: .*LLXPRT_SYSTEM ---/,
      );
      expect(contextManager.getGlobalMemory()).toContain('Global Content');

      expect(memoryDiscovery.loadEnvironmentMemory).toHaveBeenCalledWith(
        ['/app'],
        expect.anything(),
        false,
      );
      expect(contextManager.getEnvironmentMemory()).toContain(
        '--- Context from: .llxprt/LLXPRT.md ---',
      );
      expect(contextManager.getEnvironmentMemory()).toContain('Env Content');
      expect(contextManager.getEnvironmentMemory()).toContain(
        'MCP Instructions',
      );

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
      vi.mocked(memoryDiscovery.loadGlobalMemory).mockResolvedValue(
        mockGlobalResult,
      );
      vi.mocked(memoryDiscovery.loadEnvironmentMemory).mockResolvedValue(
        mockEnvResult,
      );

      await contextManager.refresh();

      expect(coreEvents.emit).toHaveBeenCalledWith(CoreEvent.MemoryChanged, {
        fileCount: 2,
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
      vi.mocked(memoryDiscovery.loadGlobalMemory).mockResolvedValue(
        mockGlobalResult,
      );
      vi.mocked(memoryDiscovery.loadEnvironmentMemory).mockResolvedValue(
        mockEnvResult,
      );

      await contextManager.refresh();

      const mockSubdirResult = {
        files: [
          { path: '/app/.llxprt/LLXPRT.md', content: 'root' },
          { path: '/app/src/.llxprt/LLXPRT.md', content: 'subdir' },
        ],
      };
      vi.mocked(memoryDiscovery.loadJitSubdirectoryMemory).mockResolvedValue(
        mockSubdirResult,
      );

      const result = await contextManager.loadJitSubdirectoryMemory('/app/src');

      expect(memoryDiscovery.loadJitSubdirectoryMemory).toHaveBeenCalledWith(
        '/app/src',
        expect.anything(),
        false,
      );
      expect(result).toContain('subdir');
      expect(result).not.toContain('root');
    });

    it('should return empty string if all files were already loaded', async () => {
      const mockResult = {
        files: [{ path: '/app/.llxprt/LLXPRT.md', content: 'content' }],
      };
      vi.mocked(memoryDiscovery.loadGlobalMemory).mockResolvedValue(mockResult);
      vi.mocked(memoryDiscovery.loadEnvironmentMemory).mockResolvedValue({
        files: [],
      });

      await contextManager.refresh();

      vi.mocked(memoryDiscovery.loadJitSubdirectoryMemory).mockResolvedValue(
        mockResult,
      );

      const result = await contextManager.loadJitSubdirectoryMemory('/app');

      expect(result).toBe('');
    });
  });
});
