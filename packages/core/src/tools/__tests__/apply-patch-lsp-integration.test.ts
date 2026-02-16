/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* @plan PLAN-20250212-LSP.P31 */
/* @requirement REQ-DIAG-040, REQ-DIAG-070, REQ-GRACE-050 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApplyPatchTool, classifyPatchOperations } from '../apply-patch.js';
import { ApprovalMode, Config } from '../../config/config.js';
import { createMockWorkspaceContext } from '../../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../../services/fileSystemService.js';
import * as Diff from 'diff';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import type { Diagnostic } from '../../lsp/types.js';

/**
 * Mock LSP service client for testing
 */
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
type TestableApplyPatchTool = {
  createInvocation(
    params: Record<string, unknown>,
    messageBus?: unknown,
  ): {
    execute(signal: AbortSignal): Promise<Record<string, unknown>>;
  };
};

describe('apply_patch tool LSP integration', () => {
  let mockConfig: Config;
  let testDir: string;
  let testFilePath: string;
  let mockLspClient: MockLspServiceClient;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-patch-test-'));
    testFilePath = path.join(testDir, 'test.ts');

    // Create a test file with some content
    await fs.writeFile(testFilePath, 'original content\nline 2\nline 3');

    // Create mock LSP client
    mockLspClient = new MockLspServiceClient();

    // Create mocked config like edit.test.ts does
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

  it('should append diagnostics on modified file', async () => {
    // Arrange
    const tool = new ApplyPatchTool(mockConfig);
    const patchContent = `--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,1 @@
-original content
+modified content`;
    mockLspClient.setDiagnostics(testFilePath, [
      {
        message: 'Type error',
        severity: 'error',
        source: 'ts',
        line: 1,
        column: 5,
        code: 'ts2322',
      },
    ]);

    // Act
    const invocation = (
      tool as unknown as TestableApplyPatchTool
    ).createInvocation(
      {
        absolute_path: testFilePath,
        patch_content: patchContent,
      },
      undefined,
    );
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully applied patch');
    expect(result.llmContent).toContain(
      'LSP errors detected in this file, please fix:',
    );
    expect(result.llmContent).toContain('<diagnostics');
    expect(result.llmContent).toContain('ERROR [1:5] Type error (ts2322)');
  });

  describe('classifyPatchOperations pure behavior', () => {
    it('should classify patch with hunks as content write', () => {
      const patches: Diff.StructuredPatch[] = [
        {
          oldFileName: 'file.ts',
          newFileName: 'file.ts',
          oldHeader: undefined,
          newHeader: undefined,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ['-old', '+new'],
            },
          ],
        },
      ];

      const result = classifyPatchOperations(patches);

      expect(result.hasAnyContentWrites).toBe(true);
      expect(result.contentWriteFiles).toEqual(['file.ts']);
    });

    it('should classify patch with no hunks as no content write', () => {
      const patches: Diff.StructuredPatch[] = [
        {
          oldFileName: 'file.ts',
          newFileName: 'file.ts',
          oldHeader: undefined,
          newHeader: undefined,
          hunks: [],
        },
      ];

      const result = classifyPatchOperations(patches);

      expect(result.hasAnyContentWrites).toBe(false);
      expect(result.contentWriteFiles).toEqual([]);
    });

    it('should handle patches with newFileName', () => {
      const patches: Diff.StructuredPatch[] = [
        {
          oldFileName: 'old.ts',
          newFileName: 'new.ts',
          oldHeader: undefined,
          newHeader: undefined,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ['-old', '+new'],
            },
          ],
        },
      ];

      const result = classifyPatchOperations(patches);

      expect(result.hasAnyContentWrites).toBe(true);
      expect(result.contentWriteFiles).toEqual(['new.ts']);
    });

    it('should handle multiple patches', () => {
      const patches: Diff.StructuredPatch[] = [
        {
          oldFileName: 'a.ts',
          newFileName: 'a.ts',
          oldHeader: undefined,
          newHeader: undefined,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ['-old', '+new'],
            },
          ],
        },
        {
          oldFileName: 'b.ts',
          newFileName: 'b.ts',
          oldHeader: undefined,
          newHeader: undefined,
          hunks: [],
        },
        {
          oldFileName: 'c.ts',
          newFileName: 'c.ts',
          oldHeader: undefined,
          newHeader: undefined,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ['-old', '+new'],
            },
          ],
        },
      ];

      const result = classifyPatchOperations(patches);

      expect(result.hasAnyContentWrites).toBe(true);
      expect(result.contentWriteFiles).toEqual(['a.ts', 'c.ts']);
    });

    it('should handle empty patches', () => {
      const patches: Diff.StructuredPatch[] = [];

      const result = classifyPatchOperations(patches);

      expect(result.hasAnyContentWrites).toBe(false);
      expect(result.contentWriteFiles).toEqual([]);
    });
  });

  it('should not check file diagnostics for patch with no hunks', async () => {
    // Arrange
    const _tool = new ApplyPatchTool(mockConfig);

    // Test classification directly - patch without hunks (no content changes)
    const patches: Diff.StructuredPatch[] = [
      {
        oldFileName: 'test.ts',
        newFileName: 'test.ts',
        oldHeader: undefined,
        newHeader: undefined,
        hunks: [], // No hunks means no content changes
      },
    ];
    const classification = classifyPatchOperations(patches);

    // Assert
    expect(classification.hasAnyContentWrites).toBe(false);
    expect(classification.contentWriteFiles).toEqual([]);
  });

  it('should check file diagnostics for patch with hunks', async () => {
    // Arrange
    const _tool = new ApplyPatchTool(mockConfig);

    // Test classification directly - patch with hunks (has content changes)
    const patches: Diff.StructuredPatch[] = [
      {
        oldFileName: 'test.ts',
        newFileName: 'new.ts',
        oldHeader: undefined,
        newHeader: undefined,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ['-old', '+new'],
          },
        ],
      },
    ];
    const classification = classifyPatchOperations(patches);

    // Assert
    expect(classification.hasAnyContentWrites).toBe(true);
    expect(classification.contentWriteFiles).toEqual(['new.ts']);
  });

  it('should succeed with no lsp client', async () => {
    // Arrange
    const tool = new ApplyPatchTool(mockConfig);
    vi.spyOn(mockConfig, 'getLspServiceClient').mockReturnValue(undefined);
    const patchContent = `--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,1 @@
-original content
+modified content`;

    // Act
    const invocation = (
      tool as unknown as TestableApplyPatchTool
    ).createInvocation(
      {
        absolute_path: testFilePath,
        patch_content: patchContent,
      },
      undefined,
    );
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully applied patch');
    expect(result.llmContent).not.toContain('LSP errors detected');
  });

  it('should succeed with dead lsp client (isAlive=false)', async () => {
    // Arrange
    const tool = new ApplyPatchTool(mockConfig);
    mockLspClient.setAlive(false);
    const patchContent = `--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,1 @@
-original content
+modified content`;

    // Act
    const invocation = (
      tool as unknown as TestableApplyPatchTool
    ).createInvocation(
      {
        absolute_path: testFilePath,
        patch_content: patchContent,
      },
      undefined,
    );
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully applied patch');
    expect(result.llmContent).not.toContain('LSP errors detected');
  });

  it('should succeed when lsp throws (no error text visible)', async () => {
    // Arrange
    const tool = new ApplyPatchTool(mockConfig);
    mockLspClient.setShouldThrow(true);
    const patchContent = `--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,1 @@
-original content
+modified content`;

    // Act
    const invocation = (
      tool as unknown as TestableApplyPatchTool
    ).createInvocation(
      {
        absolute_path: testFilePath,
        patch_content: patchContent,
      },
      undefined,
    );
    const result = await invocation.execute(new AbortController().signal);

    // Assert - patch should succeed despite LSP crash
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully applied patch');
    expect(result.llmContent).not.toContain('LSP error');
    expect(result.llmContent).not.toContain('LSP service crashed');
    expect(result.llmContent).not.toContain('diagnostic timeout');
  });

  it('should apply per-file cap with suffix when diagnostics exceed maxDiagnosticsPerFile', async () => {
    // Arrange
    const tool = new ApplyPatchTool(mockConfig);
    const patchContent = `--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,1 @@
-original content
+modified content`;
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
      tool as unknown as TestableApplyPatchTool
    ).createInvocation(
      {
        absolute_path: testFilePath,
        patch_content: patchContent,
      },
      undefined,
    );
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully applied patch');
    expect(result.llmContent).toContain('LSP errors detected');
    expect(result.llmContent).toContain('... and 5 more'); // 25 total - 20 cap = 5 more
  });

  it('should not append diagnostics when no errors found', async () => {
    // Arrange
    const tool = new ApplyPatchTool(mockConfig);
    const patchContent = `--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,1 @@
-original content
+modified content`;
    mockLspClient.setDiagnostics(testFilePath, []);

    // Act
    const invocation = (
      tool as unknown as TestableApplyPatchTool
    ).createInvocation(
      {
        absolute_path: testFilePath,
        patch_content: patchContent,
      },
      undefined,
    );
    const result = await invocation.execute(new AbortController().signal);

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully applied patch');
    expect(result.llmContent).not.toContain('LSP errors detected');
    expect(result.llmContent).not.toContain('<diagnostics');
  });
});
