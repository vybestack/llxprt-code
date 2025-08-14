/**
 * REAL behavioral test for WriteFileTool emoji filtering
 * This test would catch the bug where emojis aren't filtered when writing files
 * NO MOCKING of components under test - only mock infrastructure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WriteFileTool } from './write-file.js';
import { Config } from '../config/config.js';
import { ConfigurationManager } from '../filters/ConfigurationManager.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';

describe('WriteFileTool Emoji Filtering - REAL Behavioral Tests', () => {
  let tool: WriteFileTool;
  let config: Config;
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    // Create real temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-file-emoji-test-'));
    testFile = path.join(tempDir, 'test.md');

    // Create config mock that works with WriteFileTool
    const mockConfig = {
      getTargetDir: () => tempDir,
      getApprovalMode: vi.fn(() => 'auto'),
      setApprovalMode: vi.fn(),
      getGeminiClient: vi.fn().mockReturnValue({
        getHistory: () => Promise.resolve([]),
        isInitialized: () => true,
      }),
      getIdeClient: vi.fn().mockReturnValue(null),
      getIdeMode: vi.fn(() => false),
      getIdeModeFeature: vi.fn(() => false),
      getWorkspaceContext: () => createMockWorkspaceContext(tempDir),
      getApiKey: () => 'test-key',
      getModel: () => 'test-model',
      getSandbox: () => false,
      getDebugMode: () => false,
      getQuestion: () => undefined,
      getFullContext: () => false,
      getToolDiscoveryCommand: () => undefined,
      getToolCallCommand: () => undefined,
      getMcpServerCommand: () => undefined,
      getMcpServers: () => undefined,
      getUserAgent: () => 'test-agent',
      getUserMemory: () => '',
      setUserMemory: vi.fn(),
      getLlxprtMdFileCount: () => 0,
      setLlxprtMdFileCount: vi.fn(),
      getConversationLoggingEnabled: () => false,
      getToolRegistry: () => null,
    };
    config = mockConfig as unknown as Config;

    // Reset and initialize REAL ConfigurationManager
    (ConfigurationManager as unknown as { instance: unknown }).instance = null;
    ConfigurationManager.getInstance().initialize(config, null);

    // Create REAL WriteFileTool
    tool = new WriteFileTool(config);
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Reset ConfigurationManager
    (ConfigurationManager as unknown as { instance: unknown }).instance = null;
  });

  /**
   * @bug This test would FAIL with the current implementation
   * because WriteFileTool doesn't actually filter emojis
   *
   * @requirement REQ-004.1 - Auto mode filters silently
   */
  it('should filter emojis from file content in auto mode WITHOUT feedback', async () => {
    // Set to auto mode
    ConfigurationManager.getInstance().setSessionOverride('auto');

    const params = {
      file_path: testFile,
      content:
        '# Hello! 🎉 Task ✅ completed! 🚀\n\nThis is a test with emojis 😀',
    };

    // Execute the REAL tool
    const result = await tool.execute(params, new AbortController().signal);

    // Read the ACTUAL file from filesystem
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // The file should have filtered content
    expect(actualContent).toBe(
      '# Hello!  Task [OK] completed! \n\nThis is a test with emojis ',
    );

    // Auto mode should have NO system feedback in llmContent
    expect(result.llmContent).not.toContain('Emojis were detected');

    // Tool should succeed
    expect(result.llmContent).toContain('Successfully');
  });

  /**
   * @requirement REQ-004.2 - Warn mode provides feedback
   */
  it('should filter emojis and provide feedback in warn mode', async () => {
    // Set to warn mode
    ConfigurationManager.getInstance().setSessionOverride('warn');

    const params = {
      file_path: testFile,
      content: '// ✅ TODO: Fix this function 🔧',
    };

    const result = await tool.execute(params, new AbortController().signal);

    // Read actual file
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // Content should be filtered
    expect(actualContent).toBe('// [OK] TODO: Fix this function ');

    // Warn mode SHOULD have feedback in llmContent
    expect(result.llmContent).toContain('Emojis were removed');

    // Tool should succeed
    expect(result.llmContent).toContain('Successfully');
  });

  /**
   * @requirement REQ-004.3 - Error mode blocks execution
   */
  it('should block file write with emojis in error mode', async () => {
    // Set to error mode
    ConfigurationManager.getInstance().setSessionOverride('error');

    const params = {
      file_path: testFile,
      content: 'const SUCCESS = "✅";',
    };

    const result = await tool.execute(params, new AbortController().signal);

    // File should NOT be created
    const fileExists = fs.existsSync(testFile);
    expect(fileExists).toBe(false);

    // Tool should return error
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain('emoji');

    // Should have appropriate error message
    expect(result.llmContent).toContain('emoji');
  });

  /**
   * @requirement REQ-001.1 - Allow emojis in allowed mode
   */
  it('should pass through emojis unchanged in allowed mode', async () => {
    // Set to allowed mode
    ConfigurationManager.getInstance().setSessionOverride('allowed');

    const params = {
      file_path: testFile,
      content: '# Success! 🎉✅🚀\n\nAll emojis preserved! 😀👍',
    };

    const result = await tool.execute(params, new AbortController().signal);

    // Read actual file
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // Content should be unchanged
    expect(actualContent).toBe(params.content);

    // No feedback in allowed mode in llmContent
    expect(result.llmContent).not.toContain('Emojis were detected');

    // Tool should succeed
    expect(result.llmContent).toContain('Successfully');
  });

  /**
   * Test overwriting existing file with emoji content
   */
  it('should filter emojis when overwriting existing file in auto mode', async () => {
    // Create initial file
    fs.writeFileSync(testFile, 'Original content without emojis');

    // Set to auto mode
    ConfigurationManager.getInstance().setSessionOverride('auto');

    const params = {
      file_path: testFile,
      content: 'Updated content with emojis! ✅ Done! 🎉',
    };

    const result = await tool.execute(params, new AbortController().signal);

    // Read actual file
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // Content should be filtered
    expect(actualContent).toBe('Updated content with emojis! [OK] Done! ');

    // No feedback in auto mode in llmContent
    expect(result.llmContent).not.toContain('Emojis were detected');
  });

  /**
   * Test complex nested directory creation with emoji filtering
   */
  it('should create directories and filter emoji content', async () => {
    const nestedPath = path.join(tempDir, 'deep', 'nested', 'dir', 'file.ts');

    ConfigurationManager.getInstance().setSessionOverride('warn');

    const params = {
      file_path: nestedPath,
      content: `// Component with emojis 🎯
export function MyComponent() {
  console.log("✅ Component loaded!");
  return "⚠️ Warning: Check config";
}`,
    };

    const result = await tool.execute(params, new AbortController().signal);

    // File should be created with filtered content
    const actualContent = fs.readFileSync(nestedPath, 'utf8');

    expect(actualContent).toBe(`// Component with emojis 
export function MyComponent() {
  console.log("[OK] Component loaded!");
  return "WARNING: Warning: Check config";
}`);

    // Should have feedback in warn mode in llmContent
    expect(result.llmContent).toContain('Emojis were removed');
  });

  /**
   * Test that configuration changes are respected
   */
  it('should respect configuration changes between executions', async () => {
    const file1 = path.join(tempDir, 'file1.txt');
    const file2 = path.join(tempDir, 'file2.txt');
    const content = 'Test ✅ content';

    // First write in allowed mode
    ConfigurationManager.getInstance().setSessionOverride('allowed');
    await tool.execute(
      { file_path: file1, content },
      new AbortController().signal,
    );

    const content1 = fs.readFileSync(file1, 'utf8');
    expect(content1).toBe(content); // Unchanged

    // Second write in auto mode
    ConfigurationManager.getInstance().setSessionOverride('auto');
    await tool.execute(
      { file_path: file2, content },
      new AbortController().signal,
    );

    const content2 = fs.readFileSync(file2, 'utf8');
    expect(content2).toBe('Test [OK] content'); // Filtered
  });

  /**
   * Test large file with many emojis
   */
  it('should handle large files with many emojis efficiently', async () => {
    ConfigurationManager.getInstance().setSessionOverride('warn');

    // Generate large content with emojis
    const lines = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`Line ${i}: Status ✅, Progress ⚠️, Result 🎉`);
    }
    const largeContent = lines.join('\n');

    const params = {
      file_path: testFile,
      content: largeContent,
    };

    const start = Date.now();
    const result = await tool.execute(params, new AbortController().signal);
    const duration = Date.now() - start;

    // Should complete quickly
    expect(duration).toBeLessThan(1000); // Less than 1 second

    // Verify content is filtered
    const actualContent = fs.readFileSync(testFile, 'utf8');
    expect(actualContent).not.toContain('✅');
    expect(actualContent).not.toContain('⚠️');
    expect(actualContent).not.toContain('🎉');
    expect(actualContent).toContain('[OK]');
    expect(actualContent).toContain('WARNING:');

    // Should have feedback in llmContent
    expect(result.llmContent).toContain('Emojis were removed');
  });

  /**
   * Test edge case: empty content
   */
  it('should handle empty content correctly', async () => {
    ConfigurationManager.getInstance().setSessionOverride('warn');

    const params = {
      file_path: testFile,
      content: '',
    };

    const result = await tool.execute(params, new AbortController().signal);

    const actualContent = fs.readFileSync(testFile, 'utf8');
    expect(actualContent).toBe('');
    expect(result.llmContent).not.toContain('Emojis were detected'); // No emojis to filter
  });

  /**
   * Test edge case: only emojis
   */
  it('should handle content with only emojis', async () => {
    ConfigurationManager.getInstance().setSessionOverride('auto');

    const params = {
      file_path: testFile,
      content: '✅⚠️🎉🚀💯',
    };

    const result = await tool.execute(params, new AbortController().signal);

    const actualContent = fs.readFileSync(testFile, 'utf8');
    expect(actualContent).toBe('[OK]WARNING:'); // Only functional emojis converted
    expect(result.llmContent).not.toContain('Emojis were detected'); // Auto mode is silent
  });
});
