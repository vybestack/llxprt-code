import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { afterEach as afterFixtureTest, vi } from 'bun:test';
afterFixtureTest(() => {
  fixtureFilesystem = undefined;
});
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
const makeFixtureFilesystem = installTestWorkspaceFilesystem();
let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;
function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}
function fixtureScans() {
  fixturePaths();
  if (!fixtureFilesystem) throw new Error('Fixture filesystem absent');
  return fixtureFilesystem.scans;
}
function fixtureIgnore() {
  fixturePaths();
  if (!fixtureFilesystem) throw new Error('Fixture filesystem absent');
  return fixtureFilesystem.ignore;
}
function fixtureFiles() {
  fixturePaths();
  if (!fixtureFilesystem) throw new Error('Fixture filesystem absent');
  return fixtureFilesystem.files;
}

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import {
  ApprovalMode,
  type AnyDeclarativeTool,
  CoreToolHostAdapter,
  GlobTool,
  type MessageBus,
  ReadManyFilesTool,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
import type {
  AgentToolHandle,
  AgentToolInvocation,
} from '@vybestack/llxprt-code-agents';
import * as os from 'os';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import type { CliUiRuntime } from '../../cliUiRuntime.js';

/**
 * Minimal adapter that wraps a real tool (from ToolRegistry.getTool) as an
 * AgentToolHandle for the at-command test harness. Mirrors the
 * production-equivalent result projection (llmContent + returnDisplay
 * unconditionally, error only when defined) so tests exercise shapes that
 * match what ToolControl.get()/wrapInvocation produces internally.
 *
 * Note: production's ToolControl.get() uses the internal `wrapToolHandle`
 * (packages/agents/src/api/control/toolControl.ts), which is deliberately NOT
 * exported from the agents barrel. Re-exporting it purely to DRY this test
 * harness would widen the public API surface (and churn the public-surface
 * guard snapshots) for no runtime benefit, so we keep a small, typed local
 * adapter instead.
 */
function wrapToolForTest(t: AnyDeclarativeTool): AgentToolHandle {
  /**
   * Projects a raw tool result to the public shape: llmContent and
   * returnDisplay always present, error included only when defined.
   */
  const projectResult = (result: {
    llmContent: unknown;
    returnDisplay?: unknown;
    error?: unknown;
  }): { llmContent: unknown; returnDisplay?: unknown; error?: unknown } => {
    const projected: {
      llmContent: unknown;
      returnDisplay?: unknown;
      error?: unknown;
    } = {
      llmContent: result.llmContent,
      returnDisplay: result.returnDisplay,
    };
    if (result.error !== undefined) {
      projected.error = result.error;
    }
    return projected;
  };
  const buildInvocation = (
    params: Record<string, unknown>,
  ): AgentToolInvocation => {
    const invocation = t.build(params);
    return {
      getDescription: () => invocation.getDescription(),
      execute: async (signal, updateOutput) => {
        // Mirror production wrapInvocation (toolControl.ts): the public
        // AgentToolInvocation.execute contract forwards only string chunks, so
        // filter here too rather than passing updateOutput straight through.
        const result = await invocation.execute(
          signal,
          updateOutput !== undefined
            ? (chunk) => {
                if (typeof chunk === 'string') {
                  updateOutput(chunk);
                }
              }
            : undefined,
        );
        return projectResult(result);
      },
      shouldConfirmExecute: (signal) => invocation.shouldConfirmExecute(signal),
      toolLocations: () => invocation.toolLocations(),
    };
  };
  return {
    name: t.name,
    displayName: t.displayName,
    ...(t.description.length > 0 ? { description: t.description } : {}),
    kind: t.kind,
    source: 'builtin',
    build: buildInvocation,
    buildAndExecute: async (params, signal) => {
      const result = await t.buildAndExecute(params, signal);
      return projectResult(result);
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
  mockConfig: CliUiRuntime;
  mockAddItem: ReturnType<typeof vi.fn>;
  mockOnDebugMessage: ReturnType<typeof vi.fn>;
  abortController: AbortController;
  originalCwd: string;
  settingsOwner: SessionSettingsOwner;
  telemetry: RootTelemetry;
  getToolHandle: (name: string) => AgentToolHandle | undefined;
}

function buildMockConfig(testRootDir: string): CliUiRuntime {
  const mockConfig = {
    getTargetDir: () => testRootDir,
    isSandboxed: () => false,

    ignore: fixtureIgnore(),
    getFileFilteringRespectGitIgnore: () => true,
    getFileFilteringRespectLlxprtIgnore: () => true,
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getEnableRecursiveFileSearch: vi.fn(() => true),
    directories: () => fixturePaths().directories(),
    contains: (inputPath: string) =>
      fixturePaths().contains(path.resolve(testRootDir, inputPath)),
    addDirectory: (directory: string) => {
      fixturePaths();
      if (!fixtureFilesystem) throw new Error('Missing filesystem root');
      fixtureFilesystem.addDirectory(directory);
    },
    getEphemeralSettings: () => ({}), // No disabled tools
    getMcpServers: () => ({}),
    getMcpServerCommand: () => undefined,
    listResources: () => [],
    listPrompts: () => [],
    getDebugMode: () => false,
  } as unknown as CliUiRuntime;

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
  const sessionSettings = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(sessionSettings);
  const telemetry = RootTelemetry.prepare({
    enabled: false,
    sessionId: 'at-command-test',
    maxBytes: 1024,
    maxFiles: 1,
  });
  let approvalMode = ApprovalMode.DEFAULT;
  const hostConfig = {
    getSessionId: () => 'at-command-test',
    getTargetDir: () => testRootDir,
    getApprovalMode: () => approvalMode,
    setApprovalMode: (mode: ApprovalMode) => {
      approvalMode = mode;
    },
    isInteractive: () => false,
    getFileFilteringOptions: () => mockConfig.getFileFilteringOptions(),
    getFileFilteringRespectLlxprtIgnore: () =>
      mockConfig.getFileFilteringRespectLlxprtIgnore(),
    getConversationLoggingEnabled: () => false,
    getDebugMode: () => false,
  };
  const toolHost = new CoreToolHostAdapter(
    hostConfig,
    fixturePaths(),
    fixtureFiles(),
    fixtureIgnore(),
    fixtureScans(),
    () => settingsOwner.readToolExecutionPolicy(),
    { isTrustedFolder: () => true, getIdeTrust: () => undefined },
    telemetry,
  );
  const registry = new ToolRegistry(
    mockConfig,
    mockMessageBus,
    assembleTaskSchemaPolicy(sessionSettings),
  );
  registry.registerTool(new ReadManyFilesTool(toolHost));
  registry.registerTool(new GlobTool(toolHost));

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
    settingsOwner,
    telemetry,
    getToolHandle,
  };
}

export async function teardownAtCommandTest(
  setup: AtCommandTestSetup,
): Promise<void> {
  setup.abortController.abort();
  await setup.settingsOwner.dispose();
  await setup.telemetry.close();
  process.chdir(setup.originalCwd);
  await fsPromises.rm(setup.testRootDir, { recursive: true, force: true });
}

export async function unexpectedResourceRead(): Promise<never> {
  throw new Error('File-only test must not read MCP resources');
}
