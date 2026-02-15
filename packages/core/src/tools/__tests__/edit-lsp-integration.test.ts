/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* @plan PLAN-20250212-LSP.P31 */
/* @requirement REQ-DIAG-010, REQ-GRACE-050, REQ-GRACE-055 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditTool } from '../edit.js';
import { Config, ApprovalMode } from '../../config/config.js';
import { createMockWorkspaceContext } from '../../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../../services/fileSystemService.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import type { Diagnostic } from '../../lsp/types.js';

/**
 * Phase 31 TEST - Edit Tool LSP Integration
 *
 * REQUIREMENTS:
 * - REQ-DIAG-010: Edit appends LSP diagnostics to llmContent after success
 * - REQ-GRACE-050: LSP failure never fails edit
 * - REQ-GRACE-055: No LSP error text visible on failure
 * - REQ-DIAG-020: Success message before diagnostics
 * - REQ-DIAG-030: Single-file diagnostics only
 * - REQ-SCOPE-010: Binary files ignored
 */

// Mock LSP service client for testing
class MockLspServiceClient {
  alive = true;
  private readonly diagnosticsByFile = new Map<string, Diagnostic[]>();
  private shouldThrow = false;
  private throwOnFile: string | null = null;

  setDiagnostics(filePath: string, diagnostics: Diagnostic[]): void {
    this.diagnosticsByFile.set(filePath, diagnostics);
  }

  setShouldThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  setThrowOnFile(filePath: string | null): void {
    this.throwOnFile = filePath;
  }

  setAlive(alive: boolean): void {
    this.alive = alive;
  }

  async checkFile(filePath: string): Promise<Diagnostic[]> {
    if (this.shouldThrow) {
      throw new Error('LSP service crashed');
    }
    if (this.throwOnFile !== null && filePath === this.throwOnFile) {
      throw new Error(`LSP error checking file: ${filePath}`);
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
type TestableEditTool = {
  createInvocation(params: Record<string, unknown>): {
    execute(signal: AbortSignal): Promise<Record<string, unknown>>;
  };
};

describe('edit tool LSP integration', () => {
  let mockConfig: Config;
  let testDir: string;
  let testFilePath: string;
  let mockLspClient: MockLspServiceClient;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edit-lsp-test-'));
    testFilePath = path.join(testDir, 'test.ts');

    // Create a test file with some content
    await fs.writeFile(testFilePath, 'original content\nline 2\nline 3');

    // Create mock LSP client
    mockLspClient = new MockLspServiceClient();

    // Create mocked config like apply-patch-lsp-integration.test.ts does
    mockConfig = {
      getTargetDir: () => testDir,
      getApprovalMode: () => ApprovalMode.AUTO_EDIT,
      setApprovalMode: vi.fn(),
      getWorkspaceContext: () => createMockWorkspaceContext(testDir),
      getFileSystemService: () => new StandardFileSystemService(),
      getIdeClient: () => undefined,
      getIdeMode: () => false,
      getLspServiceClient: () => mockLspClient,
      getLspConfig: () => ({
        servers: [],
        includeSeverities: ['error'],
        maxDiagnosticsPerFile: 20,
      }),
      getConversationLoggingEnabled: () => false,
      // Add other required Config properties
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
    const tool = new EditTool(mockConfig);
    vi.spyOn(mockConfig, 'getLspServiceClient').mockReturnValue(undefined);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully modified file');
    expect(result.llmContent).not.toContain('LSP errors detected');
  });

  it('should succeed with dead LSP client (isAlive=false)', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setAlive(false);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully modified file');
    expect(result.llmContent).not.toContain('LSP errors detected');
  });

  it('should append diagnostics when LSP finds errors in edited file', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Type error',
        severity: 'error',
        source: 'ts',
        line: 42,
        column: 5,
        code: 'ts2322',
      },
    ]);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully modified file');
    expect(result.llmContent).toContain(
      'LSP errors detected in this file, please fix:',
    );
    expect(result.llmContent).toContain('<diagnostics');
    expect(result.llmContent).toContain('ERROR [42:5] Type error (ts2322)');
  });

  it('should not append diagnostics when LSP finds no errors', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, []);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully modified file');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('<diagnostics');
  });

  it('should not append diagnostics when LSP finds only warnings (default filter)', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Unused variable',
        severity: 'warning',
        source: 'ts',
        line: 10,
        column: 7,
        code: 'ts6133',
      },
    ]);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully modified file');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('<diagnostics');
  });

  it('should apply per-file cap when diagnostics exceed maxDiagnosticsPerFile', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    const diagnostics: Diagnostic[] = Array.from({ length: 25 }, (_, i) => ({
      message: `Error ${i}`,
      severity: 'error',
      source: 'ts',
      line: i + 1,
      column: 1,
      code: `ts${i}`,
    }));
    mockLspClient.setDiagnostics(testFilePath, diagnostics);
    vi.spyOn(mockConfig, 'getLspConfig').mockReturnValue({
      servers: [],
      includeSeverities: ['error'],
      maxDiagnosticsPerFile: 20,
    });

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully modified file');
    expect(result.llmContent).toContain('LSP errors detected');
    expect(result.llmContent).toContain('... and 5 more'); // 25 total - 20 cap = 5 more
  });

  it('should show success message BEFORE diagnostics (REQ-DIAG-020)', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Type error',
        severity: 'error',
        source: 'ts',
        line: 42,
        column: 5,
      },
    ]);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    const successIndex = result.llmContent!.indexOf(
      'Successfully modified file',
    );
    const diagnosticsIndex = result.llmContent!.indexOf('LSP errors detected');
    expect(successIndex).toBeGreaterThanOrEqual(0);
    expect(diagnosticsIndex).toBeGreaterThanOrEqual(0);
    expect(successIndex).toBeLessThan(diagnosticsIndex);
  });

  it('should catch LSP errors silently and succeed (REQ-GRACE-050)', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setShouldThrow(true);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert - edit should succeed despite LSP crash
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully modified file');
  });

  it('should not show LSP error text on failure (REQ-GRACE-055)', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setShouldThrow(true);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully modified file');
    expect(result.llmContent).not.toContain('LSP error');
    expect(result.llmContent).not.toContain('LSP service crashed');
    expect(result.llmContent).not.toContain('diagnostic timeout');
    expect(result.llmContent).not.toContain('service unavailable');
  });

  it('should show only single-file diagnostics (REQ-DIAG-030)', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Error in edited file',
        severity: 'error',
        source: 'ts',
        line: 42,
        column: 5,
      },
    ]);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('LSP errors detected');
    // Diagnostics block should reference the edited file
    expect(result.llmContent).toContain('file="');
  });

  it('should handle empty diagnostics list', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, []);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully modified file');
    expect(result.llmContent).not.toContain('LSP errors detected');
  });

  it('should sort diagnostics by line and column', async () => {
    // Arrange
    const tool = new EditTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Error at line 100',
        severity: 'error',
        source: 'ts',
        line: 100,
        column: 5,
      },
      {
        message: 'Error at line 1',
        severity: 'error',
        source: 'ts',
        line: 1,
        column: 10,
      },
      {
        message: 'Error at line 50',
        severity: 'error',
        source: 'ts',
        line: 50,
        column: 1,
      },
    ]);

    // Act
    const invocation = (tool as unknown as TestableEditTool).createInvocation({
      absolute_path: testFilePath,
      old_string: 'original content',
      new_string: 'modified content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('LSP errors detected');
    // Should be sorted by line number
    const line1Index = result.llmContent!.indexOf('[1:');
    const line50Index = result.llmContent!.indexOf('[50:');
    const line100Index = result.llmContent!.indexOf('[100:');
    expect(line1Index).toBeLessThan(line50Index);
    expect(line50Index).toBeLessThan(line100Index);
  });
});
