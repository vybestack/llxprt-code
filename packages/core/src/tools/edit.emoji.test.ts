/**
 * REAL behavioral test for EditTool emoji filtering
 * This test would catch bugs where emojis aren't filtered correctly when editing files
 * NO MOCKING of components under test - only mock infrastructure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditTool } from './edit.js';
import { Config } from '../config/config.js';
import { ConfigurationManager } from '../filters/ConfigurationManager.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';

describe('EditTool Emoji Filtering - REAL Behavioral Tests', () => {
  let tool: EditTool;
  let config: Config;
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    // Create real temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-tool-emoji-test-'));
    testFile = path.join(tempDir, 'test.md');

    // Create config mock that works with EditTool
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

    // Create REAL EditTool
    tool = new EditTool(config);
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
   * because EditTool incorrectly filters old_string, but old_string should remain unfiltered
   * since it's used for matching existing content
   *
   * @requirement REQ-004.1 - Auto mode filters silently, but only new_string
   */
  it('should filter emojis from new_string but NOT old_string in auto mode', async () => {
    // Create file with emoji content to edit
    const originalContent = '# Status ✅ Complete\n\nTask finished! 🎉';
    fs.writeFileSync(testFile, originalContent);

    // Set to auto mode
    ConfigurationManager.getInstance().setSessionOverride('auto');

    const params = {
      file_path: testFile,
      old_string: '# Status ✅ Complete', // This should match existing content exactly
      new_string: '# Status 🚀 Updated!', // This should be filtered
    };

    // Execute the REAL tool
    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // Read the ACTUAL file from filesystem
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // The new_string should be filtered, but file should be updated
    // NOTE: This test may currently fail if EditTool incorrectly filters old_string
    expect(actualContent).toBe('# Status  Updated!\n\nTask finished! 🎉');

    // Auto mode should have NO system feedback in llmContent
    expect(result.llmContent).not.toContain('Emojis were detected');

    // Tool should succeed
    expect(result.llmContent).toContain('Successfully');
  });

  /**
   * @requirement REQ-004.2 - Warn mode provides feedback for filtering
   */
  it('should filter emojis from new_string and provide feedback in warn mode', async () => {
    // Create file with content to edit
    const originalContent = 'function calculate() {\n  return 42;\n}';
    fs.writeFileSync(testFile, originalContent);

    // Set to warn mode
    ConfigurationManager.getInstance().setSessionOverride('warn');

    const params = {
      file_path: testFile,
      old_string: 'function calculate() {\n  return 42;\n}',
      new_string:
        'function calculate() {\n  console.log("✅ Starting calculation");\n  return 42 * 🚀;\n}',
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // Read actual file
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // Content should be filtered in new_string
    expect(actualContent).toBe(
      'function calculate() {\n  console.log("[OK] Starting calculation");\n  return 42 * ;\n}',
    );

    // Warn mode SHOULD have feedback in llmContent
    expect(result.llmContent).toContain(
      'Emojis were removed from edit content',
    );

    // Tool should succeed
    expect(result.llmContent).toContain('Successfully');
  });

  /**
   * @requirement REQ-004.3 - Error mode blocks execution when emojis detected
   */
  it('should block edit with emojis in new_string in error mode', async () => {
    // Create file with content to edit
    const originalContent = 'const status = "pending";';
    fs.writeFileSync(testFile, originalContent);

    // Set to error mode
    ConfigurationManager.getInstance().setSessionOverride('error');

    const params = {
      file_path: testFile,
      old_string: 'const status = "pending";',
      new_string: 'const status = "✅ done";',
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // Read actual file - should be unchanged
    const actualContent = fs.readFileSync(testFile, 'utf8');
    expect(actualContent).toBe(originalContent);

    // Tool should return error
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain('Emoji');

    // Should have appropriate error message
    expect(result.llmContent).toContain('Emoji');
  });

  /**
   * @requirement REQ-001.1 - Allow emojis in allowed mode
   */
  it('should pass through emojis unchanged in allowed mode', async () => {
    // Create file with content to edit
    const originalContent = 'let message = "hello";';
    fs.writeFileSync(testFile, originalContent);

    // Set to allowed mode
    ConfigurationManager.getInstance().setSessionOverride('allowed');

    const params = {
      file_path: testFile,
      old_string: 'let message = "hello";',
      new_string: 'let message = "🎉 Hello! ✅ Success! 🚀";',
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // Read actual file
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // Content should be unchanged (emojis preserved)
    expect(actualContent).toBe('let message = "🎉 Hello! ✅ Success! 🚀";');

    // No feedback in allowed mode
    expect(result.llmContent).not.toContain('Emojis were detected');

    // Tool should succeed
    expect(result.llmContent).toContain('Successfully');
  });

  /**
   * Test multiple replacements with emoji filtering
   */
  it('should filter emojis in multiple replacements with expected_replacements', async () => {
    // Create file with multiple similar patterns
    const originalContent = `function test1() { return "✅"; }
function test2() { return "✅"; }
function test3() { return "✅"; }`;
    fs.writeFileSync(testFile, originalContent);

    // Set to auto mode
    ConfigurationManager.getInstance().setSessionOverride('auto');

    const params = {
      file_path: testFile,
      old_string: 'return "✅";',
      new_string: 'return "🎉 success!";',
      expected_replacements: 3,
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // Read actual file
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // All instances should be replaced with filtered content
    expect(actualContent).toBe(`function test1() { return " success!"; }
function test2() { return " success!"; }
function test3() { return " success!"; }`);

    // Tool should succeed
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).toContain('3 replacements');
  });

  /**
   * Test creating new file with emoji content
   */
  it('should filter emojis when creating new file in auto mode', async () => {
    // Set to auto mode
    ConfigurationManager.getInstance().setSessionOverride('auto');

    const params = {
      file_path: testFile,
      old_string: '', // Empty string means create new file
      new_string: '# New File! 🎉\n\nContent with emojis ✅ and more! 🚀',
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // Read actual file
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // Content should be filtered
    expect(actualContent).toBe(
      '# New File! \n\nContent with emojis [OK] and more! ',
    );

    // Auto mode should have NO system feedback
    expect(result.llmContent).not.toContain('Emojis were detected');

    // Tool should succeed
    expect(result.llmContent).toContain('Created new file');
  });

  /**
   * Test editing file with emojis in both old and new strings
   */
  it('should handle emojis in both old_string and new_string correctly', async () => {
    // Create file with emoji content
    const originalContent = 'Status: ✅ Complete\nNext: 🚀 Launch';
    fs.writeFileSync(testFile, originalContent);

    // Set to warn mode
    ConfigurationManager.getInstance().setSessionOverride('warn');

    const params = {
      file_path: testFile,
      old_string: 'Status: ✅ Complete', // Contains emoji - should match existing content
      new_string: 'Status: 🎯 Updated', // Contains emoji - should be filtered
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // Read actual file
    const actualContent = fs.readFileSync(testFile, 'utf8');

    // Should successfully edit with filtered new_string
    expect(actualContent).toBe('Status:  Updated\nNext: 🚀 Launch');

    // Tool should succeed and provide feedback about emoji filtering
    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).toContain(
      'Emojis were removed from edit content',
    );
  });

  /**
   * Test error when emoji in new_string blocks edit in error mode
   */
  it('should block edit and preserve original content when emoji detected in error mode', async () => {
    const originalContent = 'const value = 42;';
    fs.writeFileSync(testFile, originalContent);

    // Set to error mode
    ConfigurationManager.getInstance().setSessionOverride('error');

    const params = {
      file_path: testFile,
      old_string: 'const value = 42;',
      new_string: 'const value = 42; // ✅ Verified',
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // File should remain unchanged
    const actualContent = fs.readFileSync(testFile, 'utf8');
    expect(actualContent).toBe(originalContent);

    // Should have error
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain('Emoji');
  });

  /**
   * Test complex nested content with emojis
   */
  it('should handle complex nested content with emoji filtering', async () => {
    const originalContent = `export class TaskManager {
  private tasks: Task[] = [];
  
  public addTask(task: Task): void {
    this.tasks.push(task);
  }
}`;
    fs.writeFileSync(testFile, originalContent);

    ConfigurationManager.getInstance().setSessionOverride('warn');

    const params = {
      file_path: testFile,
      old_string: `  public addTask(task: Task): void {
    this.tasks.push(task);
  }`,
      new_string: `  public addTask(task: Task): void {
    console.log("✅ Adding task");
    this.tasks.push(task);
    console.log("🎉 Task added successfully!");
  }`,
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // Read actual file
    const actualContent = fs.readFileSync(testFile, 'utf8');

    expect(actualContent).toBe(`export class TaskManager {
  private tasks: Task[] = [];
  
  public addTask(task: Task): void {
    console.log("[OK] Adding task");
    this.tasks.push(task);
    console.log(" Task added successfully!");
  }
}`);

    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).toContain(
      'Emojis were removed from edit content',
    );
  });

  /**
   * Test edge case: empty strings
   */
  it('should handle empty old_string and new_string correctly', async () => {
    ConfigurationManager.getInstance().setSessionOverride('warn');

    const params = {
      file_path: testFile,
      old_string: '',
      new_string: '',
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    const actualContent = fs.readFileSync(testFile, 'utf8');
    expect(actualContent).toBe('');
    expect(result.llmContent).toContain('Created new file'); // Creates empty file
  });

  /**
   * Test edge case: only emojis in new_string
   */
  it('should handle new_string with only emojis', async () => {
    const originalContent = 'placeholder';
    fs.writeFileSync(testFile, originalContent);

    ConfigurationManager.getInstance().setSessionOverride('auto');

    const params = {
      file_path: testFile,
      old_string: 'placeholder',
      new_string: '✅⚠️🎉🚀💯',
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    const actualContent = fs.readFileSync(testFile, 'utf8');
    expect(actualContent).toBe('[OK]WARNING:'); // Only functional emojis converted
    expect(result.llmContent).not.toContain('Emojis were detected'); // Auto mode is silent
  });

  /**
   * Test configuration changes are respected between executions
   */
  it('should respect configuration changes between executions', async () => {
    const file1 = path.join(tempDir, 'file1.txt');
    const file2 = path.join(tempDir, 'file2.txt');

    // Create initial files
    fs.writeFileSync(file1, 'initial content');
    fs.writeFileSync(file2, 'initial content');

    // First edit in allowed mode
    ConfigurationManager.getInstance().setSessionOverride('allowed');
    await tool
      .build({
        file_path: file1,
        old_string: 'initial content',
        new_string: 'updated ✅ content',
      })
      .execute(new AbortController().signal);

    const content1 = fs.readFileSync(file1, 'utf8');
    expect(content1).toBe('updated ✅ content'); // Unchanged in allowed mode

    // Second edit in auto mode
    ConfigurationManager.getInstance().setSessionOverride('auto');
    await tool
      .build({
        file_path: file2,
        old_string: 'initial content',
        new_string: 'updated ✅ content',
      })
      .execute(new AbortController().signal);

    const content2 = fs.readFileSync(file2, 'utf8');
    expect(content2).toBe('updated [OK] content'); // Filtered in auto mode
  });

  /**
   * Test large file with many emoji replacements
   */
  it('should handle large files with many emoji edits efficiently', async () => {
    ConfigurationManager.getInstance().setSessionOverride('warn');

    // Generate large content
    const lines = [];
    for (let i = 0; i < 500; i++) {
      lines.push(`function test${i}() { return false; }`);
    }
    const largeContent = lines.join('\n');
    fs.writeFileSync(testFile, largeContent);

    const params = {
      file_path: testFile,
      old_string: 'return false;',
      new_string: 'return "✅ success!";',
      expected_replacements: 500,
    };

    const start = Date.now();
    const result = await tool
      .build(params)
      .execute(new AbortController().signal);
    const duration = Date.now() - start;

    // Should complete quickly
    expect(duration).toBeLessThan(2000); // Less than 2 seconds

    // Verify content is edited and filtered
    const actualContent = fs.readFileSync(testFile, 'utf8');
    expect(actualContent).not.toContain('return false;');
    expect(actualContent).toContain('return "[OK] success!";');
    expect(actualContent).not.toContain('✅');

    expect(result.llmContent).toContain('Successfully');
    expect(result.llmContent).toContain(
      'Emojis were removed from edit content',
    );
  });

  /**
   * Test that original file is preserved when edit fails due to no matches
   */
  it('should preserve original file when old_string does not match', async () => {
    const originalContent = 'function example() { return true; }';
    fs.writeFileSync(testFile, originalContent);

    ConfigurationManager.getInstance().setSessionOverride('auto');

    const params = {
      file_path: testFile,
      old_string: 'nonexistent string',
      new_string: 'replacement ✅ text',
    };

    const result = await tool
      .build(params)
      .execute(new AbortController().signal);

    // File should remain unchanged
    const actualContent = fs.readFileSync(testFile, 'utf8');
    expect(actualContent).toBe(originalContent);

    // Should have error
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain('0 occurrences found');
  });
});
