/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* @plan PLAN-20250212-LSP.P31 */
/* @requirement REQ-DIAG-010, REQ-GRACE-050, REQ-GRACE-055 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeleteLineRangeTool } from '../delete_line_range.js';
import { Config, ApprovalMode } from '../../config/config.js';
import { createMockWorkspaceContext } from '../../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../../services/fileSystemService.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import type { Diagnostic } from '../../lsp/types.js';

/**
 * Phase 31 TEST - DeleteLineRange Tool LSP Integration
 *
 * REQUIREMENTS:
 * - REQ-DIAG-010: delete_line_range appends LSP diagnostics to llmContent after success
 * - REQ-GRACE-050: LSP failure never fails edit
 * - REQ-GRACE-055: No LSP error text visible on failure
 */

// Mock LSP service client for testing
class MockLspServiceClient {
  alive = true;
  private readonly diagnosticsByFile = new Map<string, Diagnostic[]>();
  private shouldThrow = false;

  setDiagnostics(filePath: string, diagnostics: Diagnostic[]): void {
    this.diagnosticsByFile.set(filePath, diagnostics);
  }

  setShouldThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  setAlive(alive: boolean): void {
    this.alive = alive;
  }

  async checkFile(filePath: string): Promise<Diagnostic[]> {
    if (this.shouldThrow) {
      throw new Error('LSP service crashed');
    }
    if (!this.alive) {
      return [];
    }
    return this.diagnosticsByFile.get(filePath) || [];
  }

  isAlive(): boolean {
    return this.alive;
  }
}

// Type to access protected createInvocation in tests
type TestableDeleteLineRangeTool = {
  createInvocation(params: Record<string, unknown>): {
    execute(signal: AbortSignal): Promise<Record<string, unknown>>;
  };
};

describe('delete_line_range tool LSP integration', () => {
  let mockConfig: Config;
  let testDir: string;
  let testFilePath: string;
  let mockLspClient: MockLspServiceClient;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'delete-line-range-lsp-test-'),
    );
    testFilePath = path.join(testDir, 'test.ts');

    // Create a test file with some content
    await fs.writeFile(testFilePath, 'line 1\nline 2\nline 3\nline 4\nline 5');

    // Create mock LSP client
    mockLspClient = new MockLspServiceClient();

    // Create mocked config
    mockConfig = {
      getTargetDir: () => testDir,
      getApprovalMode: () => ApprovalMode.AUTO_EDIT,
      setApprovalMode: vi.fn(),
      getWorkspaceContext: () => createMockWorkspaceContext(testDir),
      getFileSystemService: () => new StandardFileSystemService(),
      getFileService: () => ({ shouldLlxprtIgnoreFile: () => false }),
      getIdeClient: () => undefined,
      getIdeMode: () => false,
      getLspServiceClient: () => mockLspClient,
      getLspConfig: () => ({
        servers: [],
        includeSeverities: ['error'],
        maxDiagnosticsPerFile: 20,
      }),
      getConversationLoggingEnabled: () => false,
      getApiKey: () => 'test-api-key',
      getModel: () => 'test-model',
      getSandbox: () => false,
      getDebugMode: () => false,
      getQuestion: () => undefined,
      getToolDiscoveryCommand: () => undefined,
      getToolCallCommand: () => undefined,
      getMcpServerCommand: () => undefined,
      getMcpServers: () => undefined,
      getUserAgent: () => 'test-agent',
      getUserMemory: () => '',
      setUserMemory: vi.fn(),
      getLlxprtMdFileCount: () => 0,
      setLlxprtMdFileCount: vi.fn(),
      getEphemeralSetting: vi.fn(() => 'auto'),
      getToolRegistry: () =>
        ({}) as unknown as ReturnType<Config['getToolRegistry']>,
    } as unknown as Config;
  });

  it('should succeed without LSP when lspClient is undefined', async () => {
    // Arrange
    const tool = new DeleteLineRangeTool(mockConfig);
    vi.spyOn(mockConfig, 'getLspServiceClient').mockReturnValue(undefined);

    // Act
    const invocation = (
      tool as unknown as TestableDeleteLineRangeTool
    ).createInvocation({
      absolute_path: testFilePath,
      start_line: 2,
      end_line: 3,
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully deleted lines');
    expect(result.llmContent).not.toContain('LSP errors detected');
  });

  it('should succeed with dead LSP client (isAlive=false)', async () => {
    // Arrange
    const tool = new DeleteLineRangeTool(mockConfig);
    mockLspClient.setAlive(false);

    // Act
    const invocation = (
      tool as unknown as TestableDeleteLineRangeTool
    ).createInvocation({
      absolute_path: testFilePath,
      start_line: 2,
      end_line: 3,
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully deleted lines');
    expect(result.llmContent).not.toContain('LSP errors detected');
  });

  it('should append diagnostics when LSP finds errors after deletion', async () => {
    // Arrange
    const tool = new DeleteLineRangeTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Type error after delete',
        severity: 'error',
        source: 'ts',
        line: 10,
        column: 1,
        code: 'ts2322',
      },
    ]);

    // Act
    const invocation = (
      tool as unknown as TestableDeleteLineRangeTool
    ).createInvocation({
      absolute_path: testFilePath,
      start_line: 2,
      end_line: 3,
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully deleted lines');
    expect(result.llmContent).toContain(
      'LSP errors detected in this file, please fix:',
    );
    expect(result.llmContent).toContain('<diagnostics');
    expect(result.llmContent).toContain(
      'ERROR [10:1] Type error after delete (ts2322)',
    );
  });

  it('should catch LSP errors silently and succeed (REQ-GRACE-050)', async () => {
    // Arrange
    const tool = new DeleteLineRangeTool(mockConfig);
    mockLspClient.setShouldThrow(true);

    // Act
    const invocation = (
      tool as unknown as TestableDeleteLineRangeTool
    ).createInvocation({
      absolute_path: testFilePath,
      start_line: 2,
      end_line: 3,
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert - delete should succeed despite LSP crash
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully deleted lines');
  });

  it('should not show LSP error text on failure (REQ-GRACE-055)', async () => {
    // Arrange
    const tool = new DeleteLineRangeTool(mockConfig);
    mockLspClient.setShouldThrow(true);

    // Act
    const invocation = (
      tool as unknown as TestableDeleteLineRangeTool
    ).createInvocation({
      absolute_path: testFilePath,
      start_line: 2,
      end_line: 3,
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully deleted lines');
    expect(result.llmContent).not.toContain('LSP error');
    expect(result.llmContent).not.toContain('LSP service crashed');
  });

  it('should not append diagnostics when LSP finds no errors', async () => {
    // Arrange
    const tool = new DeleteLineRangeTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, []);

    // Act
    const invocation = (
      tool as unknown as TestableDeleteLineRangeTool
    ).createInvocation({
      absolute_path: testFilePath,
      start_line: 2,
      end_line: 3,
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully deleted lines');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('<diagnostics');
  });
});
