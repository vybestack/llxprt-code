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
import type {
  AgentToolHandle,
  AgentToolInvocation,
} from '@vybestack/llxprt-code-agents';
import {
  FileDiscoveryService,
  StandardFileSystemService,
} from '@vybestack/llxprt-code-storage';
import * as os from 'os';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Minimal adapter that wraps a real tool (from ToolRegistry.getTool) as an
 * AgentToolHandle for the at-command test harness. This mirrors the shape
 * ToolControl.get() produces (via the internal wrapToolHandle) so the
 * at-command processor exercises the same code paths as production.
 */
function wrapToolForTest(tool: unknown): AgentToolHandle {
  const t = tool as {
    name: string;
    displayName: string;
    description: string;
    kind?: string;
    build(params: Record<string, unknown>): {
      getDescription(): string;
      execute(
        signal: AbortSignal,
        updateOutput?: (chunk: string) => void,
      ): Promise<{
        llmContent: unknown;
        returnDisplay?: unknown;
        error?: unknown;
      }>;
      shouldConfirmExecute(signal: AbortSignal): Promise<unknown | false>;
      toolLocations(): ReadonlyArray<{ path: string; line?: number }>;
    };
    buildAndExecute(
      params: Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<{
      llmContent: unknown;
      returnDisplay?: unknown;
      error?: unknown;
    }>;
  };
  const buildInvocation = (
    params: Record<string, unknown>,
  ): AgentToolInvocation => {
    const invocation = t.build(params);
    return {
      getDescription: () => invocation.getDescription(),
      execute: async (signal, updateOutput) => {
        const result = await invocation.execute(signal, updateOutput);
        return result;
      },
      shouldConfirmExecute: (signal) => invocation.shouldConfirmExecute(signal),
      toolLocations: () => invocation.toolLocations(),
    };
  };
  return {
    name: t.name,
    displayName: t.displayName,
    ...(t.description.length > 0 ? { description: t.description } : {}),
    ...(t.kind !== undefined ? { kind: t.kind } : {}),
    source: 'builtin',
    build: buildInvocation,
    buildAndExecute: async (params, signal) => {
      const result = await t.buildAndExecute(params, signal);
      return result;
    },
  };
}

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
  getToolHandle: (name: string) => AgentToolHandle | undefined;
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

  const getToolHandle = (name: string): AgentToolHandle | undefined => {
    const tool = registry.getTool(name);
    if (tool === undefined) return undefined;
    return wrapToolForTest(tool);
  };

  return {
    testRootDir,
    mockConfig,
    mockAddItem,
    mockOnDebugMessage,
    abortController,
    originalCwd,
    getToolHandle,
  };
}

export async function teardownAtCommandTest(
  setup: AtCommandTestSetup,
): Promise<void> {
  setup.abortController.abort();
  process.chdir(setup.originalCwd);
  await fsPromises.rm(setup.testRootDir, { recursive: true, force: true });
}
