/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import {
  type Config,
  CoreToolHostAdapter,
  GlobTool,
  type MessageBus,
  ReadManyFilesTool,
  ToolRegistry,
  COMMON_IGNORE_PATTERNS,
  DEFAULT_FILE_EXCLUDES,
} from '@vybestack/llxprt-code-core';
import {
  FileDiscoveryService,
  StandardFileSystemService,
} from '@vybestack/llxprt-code-storage';
import * as os from 'os';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';

export async function createTestFile(
  fullPath: string,
  fileContents: string,
): Promise<string> {
  await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
  await fsPromises.writeFile(fullPath, fileContents);
  return fs.realpathSync(fullPath);
}

export interface AtCommandTestSetup {
  testRootDir: string;
  mockConfig: Config;
  mockAddItem: ReturnType<typeof vi.fn>;
  mockOnDebugMessage: ReturnType<typeof vi.fn>;
  abortController: AbortController;
  originalCwd: string;
}

function buildMockConfig(testRootDir: string): Config {
  const getToolRegistry = vi.fn();

  const mockConfig = {
    getToolRegistry,
    getTargetDir: () => testRootDir,
    isSandboxed: () => false,

    getFileService: () => new FileDiscoveryService(testRootDir),
    getFileFilteringRespectGitIgnore: () => true,
    getFileFilteringRespectLlxprtIgnore: () => true,
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileSystemService: () => new StandardFileSystemService(),
    getEnableRecursiveFileSearch: vi.fn(() => true),
    getWorkspaceContext: () => {
      const workspaceRoot = fs.realpathSync(testRootDir);
      return {
        isPathWithinWorkspace: (inputPath: string) => {
          const absoluteInput = path.isAbsolute(inputPath)
            ? inputPath
            : path.resolve(testRootDir, inputPath);
          let resolved: string;
          try {
            resolved = fs.realpathSync(absoluteInput);
          } catch {
            if (absoluteInput.startsWith(testRootDir)) {
              resolved = path.resolve(
                workspaceRoot,
                path.relative(testRootDir, absoluteInput),
              );
            } else {
              resolved = path.normalize(absoluteInput);
            }
          }
          return (
            resolved === workspaceRoot ||
            resolved.startsWith(workspaceRoot + path.sep)
          );
        },
        getDirectories: () => [workspaceRoot],
      };
    },
    getEphemeralSettings: () => ({}), // No disabled tools
    getMcpServers: () => ({}),
    getMcpServerCommand: () => undefined,
    getResourceRegistry: () => ({
      findResourceByUri: () => undefined,
    }),
    getMcpClientManager: () => undefined,
    getPromptRegistry: () => ({
      getPromptsByServer: () => [],
    }),
    getDebugMode: () => false,
    getFileExclusions: () => ({
      getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
      getDefaultExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
      getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
      buildExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
      getReadManyFilesExcludes: () => DEFAULT_FILE_EXCLUDES,
    }),
    getUsageStatisticsEnabled: () => false,
    getEnableExtensionReloading: () => false,
  } as unknown as Config;

  return mockConfig;
}

export async function setupAtCommandTest(): Promise<AtCommandTestSetup> {
  vi.resetAllMocks();

  const testRootDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'folder-structure-test-'),
  );
  const originalCwd = process.cwd();
  process.chdir(testRootDir);

  const abortController = new AbortController();
  const mockAddItem = vi.fn();
  const mockOnDebugMessage = vi.fn();

  const mockConfig = buildMockConfig(testRootDir);

  const mockMessageBus = {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    respondToConfirmation: vi.fn(),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  } as unknown as MessageBus;
  const toolHost = new CoreToolHostAdapter(mockConfig);
  const registry = new ToolRegistry(mockConfig, mockMessageBus);
  registry.registerTool(new ReadManyFilesTool(toolHost));
  registry.registerTool(new GlobTool(toolHost));
  vi.mocked(mockConfig.getToolRegistry).mockReturnValue(registry);

  return {
    testRootDir,
    mockConfig,
    mockAddItem,
    mockOnDebugMessage,
    abortController,
    originalCwd,
  };
}

export async function teardownAtCommandTest(
  setup: AtCommandTestSetup,
): Promise<void> {
  setup.abortController.abort();
  process.chdir(setup.originalCwd);
  await fsPromises.rm(setup.testRootDir, { recursive: true, force: true });
}
