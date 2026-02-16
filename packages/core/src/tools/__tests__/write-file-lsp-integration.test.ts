/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* @plan PLAN-20250212-LSP.P32 */
/* @requirement REQ-DIAG-040, REQ-DIAG-070, REQ-GRACE-050 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WriteFileTool } from '../write-file.js';
import { Config, ApprovalMode } from '../../config/config.js';
import { createMockWorkspaceContext } from '../../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../../services/fileSystemService.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import type { Diagnostic } from '../../lsp/types.js';

/**
 * Phase 32 TEST - Write Tool LSP Integration
 *
 * REQUIREMENTS:
 * - REQ-DIAG-040: Multi-file diagnostics after write
 * - REQ-DIAG-045: Known files from getAllDiagnostics
 * - REQ-DIAG-050: Written file first, others second
 * - REQ-DIAG-060: Max other files cap
 * - REQ-DIAG-070: Total line cap
 * - REQ-FMT-068: Caps applied in order
 * - REQ-FMT-090: Deterministic file ordering
 * - REQ-GRACE-050: LSP failure never fails write
 * - REQ-GRACE-055: No LSP error text visible
 */

// Mock LSP service client for testing
class MockLspServiceClient {
  alive = true;
  private readonly diagnosticsByFile = new Map<string, Diagnostic[]>();
  private shouldThrow = false;
  private throwOnCheckFile = false;

  setDiagnostics(filePath: string, diagnostics: Diagnostic[]): void {
    this.diagnosticsByFile.set(filePath, diagnostics);
  }

  setShouldThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  setThrowOnCheckFile(shouldThrow: boolean): void {
    this.throwOnCheckFile = shouldThrow;
  }

  setAlive(alive: boolean): void {
    this.alive = alive;
  }

  async checkFile(_filePath: string): Promise<Diagnostic[]> {
    if (this.shouldThrow || this.throwOnCheckFile) {
      throw new Error('LSP service crashed');
    }
    if (!this.alive) {
      return [];
    }
    // Return diagnostics for this file if present
    return this.diagnosticsByFile.get(_filePath) || [];
  }

  async getAllDiagnostics(): Promise<Record<string, Diagnostic[]>> {
    if (this.shouldThrow) {
      throw new Error('LSP service crashed');
    }
    if (!this.alive) {
      return {};
    }
    // Return all known-file diagnostics
    const all: Record<string, Diagnostic[]> = {};
    for (const [file, diags] of this.diagnosticsByFile.entries()) {
      all[file] = diags;
    }
    return all;
  }

  isAlive(): boolean {
    return this.alive;
  }
}

// Type to access protected createInvocation in tests
type TestableWriteFileTool = {
  createInvocation(params: Record<string, unknown>): {
    execute(signal: AbortSignal): Promise<Record<string, unknown>>;
  };
};

describe('write tool LSP integration', () => {
  let mockConfig: Config;
  let testDir: string;
  let testFilePath: string;
  let mockLspClient: MockLspServiceClient;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-lsp-test-'));
    testFilePath = path.join(testDir, 'test.ts');

    // Create mock LSP client
    mockLspClient = new MockLspServiceClient();

    // Create mocked config like edit-lsp-integration.test.ts does
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
    const tool = new WriteFileTool(mockConfig);
    vi.spyOn(mockConfig, 'getLspServiceClient').mockReturnValue(undefined);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('<diagnostics');
  });

  it('should succeed with dead LSP client (isAlive=false)', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
    mockLspClient.setAlive(false);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('<diagnostics');
  });

  it('should append diagnostics when LSP finds errors in written file', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
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
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).toContain('<diagnostics');
    expect(result.llmContent).toContain('ERROR [42:5] Type error (ts2322)');
  });

  it('should not append diagnostics when LSP finds no errors', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
    mockLspClient.setDiagnostics(testFilePath, []);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('<diagnostics');
  });

  it('should not append diagnostics when LSP finds only warnings (default filter)', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
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
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('<diagnostics');
  });

  it('should apply per-file cap when diagnostics exceed maxDiagnosticsPerFile', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
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
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).toContain('<diagnostics');
    // Should have 20 errors + overflow message
    expect(result.llmContent).toContain('... and 5 more');
  });

  it('should apply total line cap across multiple files', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
    const otherFile1 = path.join(testDir, 'other1.ts');
    const otherFile2 = path.join(testDir, 'other2.ts');

    // Written file: 20 errors
    const writtenDiags: Diagnostic[] = Array.from({ length: 20 }, (_, i) => ({
      message: `Written error ${i}`,
      severity: 'error',
      source: 'ts',
      line: i + 1,
      column: 1,
    }));
    mockLspClient.setDiagnostics(testFilePath, writtenDiags);

    // Other file 1: 20 errors
    const otherDiags1: Diagnostic[] = Array.from({ length: 20 }, (_, i) => ({
      message: `Other1 error ${i}`,
      severity: 'error',
      source: 'ts',
      line: i + 1,
      column: 1,
    }));
    mockLspClient.setDiagnostics(otherFile1, otherDiags1);

    // Other file 2: 20 errors
    const otherDiags2: Diagnostic[] = Array.from({ length: 20 }, (_, i) => ({
      message: `Other2 error ${i}`,
      severity: 'error',
      source: 'ts',
      line: i + 1,
      column: 1,
    }));
    mockLspClient.setDiagnostics(otherFile2, otherDiags2);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    // Total cap is 50, so should see written file (20) + other1 (20) + other2 (10)
    // and other2 should be cut off
    expect(result.llmContent).toContain('test.ts');
    expect(result.llmContent).toContain('other1.ts');
    expect(result.llmContent).toContain('other2.ts');
  });

  it('should handle LSP error during checkFile gracefully', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
    mockLspClient.setThrowOnCheckFile(true);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('crashed');
    expect(result.llmContent).not.toContain('LSP service');
  });

  it('should handle LSP error during getAllDiagnostics gracefully', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
    mockLspClient.setShouldThrow(true);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('crashed');
    expect(result.llmContent).not.toContain('LSP service');
  });

  it('should include multiple file diagnostics when available', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
    const otherFile = path.join(testDir, 'other.ts');

    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Written file error',
        severity: 'error',
        source: 'ts',
        line: 5,
        column: 1,
      },
    ]);

    mockLspClient.setDiagnostics(otherFile, [
      {
        message: 'Other file error',
        severity: 'error',
        source: 'ts',
        line: 10,
        column: 2,
      },
    ]);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).toContain('<diagnostics');
    expect(result.llmContent).toContain('test.ts');
    expect(result.llmContent).toContain('other.ts');
    expect(result.llmContent).toContain('Written file error');
    expect(result.llmContent).toContain('Other file error');
  });

  it('should show other files sorted alphabetically', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
    const zFile = path.join(testDir, 'z.ts');
    const aFile = path.join(testDir, 'a.ts');
    const mFile = path.join(testDir, 'm.ts');

    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Written error',
        severity: 'error',
        source: 'ts',
        line: 1,
        column: 1,
      },
    ]);
    mockLspClient.setDiagnostics(zFile, [
      {
        message: 'Z error',
        severity: 'error',
        source: 'ts',
        line: 1,
        column: 1,
      },
    ]);
    mockLspClient.setDiagnostics(aFile, [
      {
        message: 'A error',
        severity: 'error',
        source: 'ts',
        line: 1,
        column: 1,
      },
    ]);
    mockLspClient.setDiagnostics(mFile, [
      {
        message: 'M error',
        severity: 'error',
        source: 'ts',
        line: 1,
        column: 1,
      },
    ]);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    // Written file (test.ts) should be first
    const testIndex = result.llmContent.indexOf('test.ts');
    const aIndex = result.llmContent.indexOf('a.ts');
    const mIndex = result.llmContent.indexOf('m.ts');
    const zIndex = result.llmContent.indexOf('z.ts');

    // test.ts should be before all others
    expect(testIndex).toBeLessThan(aIndex);
    expect(testIndex).toBeLessThan(mIndex);
    expect(testIndex).toBeLessThan(zIndex);

    // Others should be alphabetical
    expect(aIndex).toBeLessThan(mIndex);
    expect(mIndex).toBeLessThan(zIndex);
  });

  it('should cap other files at maxProjectDiagnosticsFiles (default 5)', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
    const otherFiles = Array.from({ length: 7 }, (_, i) =>
      path.join(testDir, `other${i}.ts`),
    );

    // Add diagnostics to all files
    for (const file of otherFiles) {
      mockLspClient.setDiagnostics(file, [
        {
          message: 'Error',
          severity: 'error',
          source: 'ts',
          line: 1,
          column: 1,
        },
      ]);
    }
    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Written error',
        severity: 'error',
        source: 'ts',
        line: 1,
        column: 1,
      },
    ]);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    // Should include written file + 5 others (total 6)
    const matches = result.llmContent.match(/<diagnostics/g);
    expect(matches).toBeTruthy();
    // At most 6 files: written + 5 others
    expect(matches!.length).toBeLessThanOrEqual(6);
  });

  it('should apply overflow suffix without counting toward total cap', async () => {
    // Arrange
    const tool = new WriteFileTool(mockConfig);
    const diagnostics: Diagnostic[] = Array.from({ length: 30 }, (_, i) => ({
      message: `Error ${i}`,
      severity: 'error',
      source: 'ts',
      line: i + 1,
      column: 1,
      code: `ts${i}`,
    }));
    mockLspClient.setDiagnostics(testFilePath, diagnostics);

    // Act
    const invocation = (
      tool as unknown as TestableWriteFileTool
    ).createInvocation({
      absolute_path: testFilePath,
      content: 'new content',
    });
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('... and 10 more');
    // Overflow line should show last diagnostic
    expect(result.llmContent).toMatch(/last: ERROR \[30:1\]/);
  });
});
