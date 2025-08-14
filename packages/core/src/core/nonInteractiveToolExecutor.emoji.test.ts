/**
 * REAL integration tests for nonInteractiveToolExecutor emoji filtering
 * Tests that the executor correctly filters tool arguments BEFORE passing to tools
 * Uses REAL tools, REAL ConfigurationManager, NO mocking of components under test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeToolCall } from './nonInteractiveToolExecutor.js';
import { Config } from '../config/config.js';
import { ConfigurationManager } from '../filters/ConfigurationManager.js';
import { ToolCallRequestInfo, ToolRegistry, ToolErrorType } from '../index.js';
import { WriteFileTool } from '../tools/write-file.js';
import { EditTool } from '../tools/edit.js';
import { GrepTool } from '../tools/grep.js';
import { ShellTool } from '../tools/shell.js';
import { LSTool } from '../tools/ls.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('nonInteractiveToolExecutor Emoji Filtering - REAL Integration Tests', () => {
  let config: Config;
  let toolRegistry: ToolRegistry;
  let tempDir: string;

  beforeEach(async () => {
    // Create real temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-emoji-test-'));

    // Create minimal config mock that works with tools
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
      getSessionId: () => 'test-session',
      getUsageStatisticsEnabled: () => true,
      getEphemeralSettings: () => ({}),
      getCoreTools: () => [],
      getExcludeTools: () => [],
      getSummarizeToolOutputConfig: () => ({ enabled: false }),
    };
    config = mockConfig as unknown as Config;

    // Reset and initialize REAL ConfigurationManager
    (ConfigurationManager as unknown as { instance: unknown }).instance = null;
    ConfigurationManager.getInstance().initialize(config, null);

    // Create REAL tool registry with REAL tools
    toolRegistry = new ToolRegistry(config);
    toolRegistry.registerTool(new WriteFileTool(config));
    toolRegistry.registerTool(new EditTool(config));
    toolRegistry.registerTool(new GrepTool(config));
    toolRegistry.registerTool(new ShellTool(config));
    toolRegistry.registerTool(new LSTool(config));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Reset ConfigurationManager
    (ConfigurationManager as unknown as { instance: unknown }).instance = null;
  });

  describe('File Modification Tools - Filtering Behavior', () => {
    /**
     * @requirement REQ-004.1 - Auto mode filters silently
     */
    it('should filter emojis from write_file content in auto mode WITHOUT feedback', async () => {
      // Set to auto mode
      ConfigurationManager.getInstance().setSessionOverride('auto');

      const testFile = path.join(tempDir, 'test.md');
      const request: ToolCallRequestInfo = {
        callId: 'call1',
        name: 'write_file',
        args: {
          file_path: testFile,
          content:
            '# Hello! 🎉 Task ✅ completed! 🚀\n\nThis is a test with emojis 😀',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      };

      // Execute through nonInteractiveToolExecutor
      const response = await executeToolCall(config, request, toolRegistry);

      // Verify tool execution succeeded
      expect(response.error).toBeUndefined();

      // Read the ACTUAL file content to verify filtering occurred
      const actualContent = fs.readFileSync(testFile, 'utf8');
      expect(actualContent).toBe(
        '# Hello!  Task [OK] completed! \n\nThis is a test with emojis ',
      );

      // Auto mode should have NO system feedback
      expect(
        response.responseParts.functionResponse.response.output,
      ).not.toContain('Emojis were detected');
    });

    /**
     * @requirement REQ-004.2 - Warn mode provides feedback
     */
    it('should filter emojis from edit tool and provide feedback in warn mode', async () => {
      // Create initial file
      const testFile = path.join(tempDir, 'edit-test.ts');
      fs.writeFileSync(testFile, 'const status = "pending";');

      // Set to warn mode
      ConfigurationManager.getInstance().setSessionOverride('warn');

      const request: ToolCallRequestInfo = {
        callId: 'call2',
        name: 'replace',
        args: {
          file_path: testFile,
          old_string: 'const status = "pending";',
          new_string: 'const status = "✅ completed";',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-2',
      };

      // Execute through nonInteractiveToolExecutor
      const response = await executeToolCall(config, request, toolRegistry);

      // Verify tool execution succeeded
      expect(response.error).toBeUndefined();

      // Read the ACTUAL file content to verify filtering occurred
      const actualContent = fs.readFileSync(testFile, 'utf8');
      expect(actualContent).toBe('const status = "[OK] completed";');

      // Warn mode SHOULD have feedback
      expect(response.responseParts.functionResponse.response.output).toContain(
        'Emojis were removed',
      );
    });

    /**
     * @requirement REQ-004.3 - Error mode blocks execution
     */
    it('should block write_file execution with emojis in error mode', async () => {
      // Set to error mode
      ConfigurationManager.getInstance().setSessionOverride('error');

      const testFile = path.join(tempDir, 'blocked.js');
      const request: ToolCallRequestInfo = {
        callId: 'call3',
        name: 'write_file',
        args: {
          file_path: testFile,
          content: 'const SUCCESS = "✅";',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-3',
      };

      // Execute through nonInteractiveToolExecutor
      const response = await executeToolCall(config, request, toolRegistry);

      // Tool execution should be blocked
      expect(response.error).toBeDefined();
      expect(response.errorType).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(response.error?.message).toContain('emoji');

      // File should NOT be created
      expect(fs.existsSync(testFile)).toBe(false);

      // Response should indicate blocking
      expect(response.responseParts.functionResponse.response.error).toContain(
        'emoji',
      );
    });

    /**
     * @requirement REQ-001.1 - Allow emojis in allowed mode
     */
    it('should pass through emojis unchanged in allowed mode', async () => {
      // Set to allowed mode
      ConfigurationManager.getInstance().setSessionOverride('allowed');

      const testFile = path.join(tempDir, 'allowed.md');
      const originalContent = '# Success! 🎉✅🚀\n\nAll emojis preserved! 😀👍';
      const request: ToolCallRequestInfo = {
        callId: 'call4',
        name: 'write_file',
        args: {
          file_path: testFile,
          content: originalContent,
        },
        isClientInitiated: false,
        prompt_id: 'prompt-4',
      };

      // Execute through nonInteractiveToolExecutor
      const response = await executeToolCall(config, request, toolRegistry);

      // Verify tool execution succeeded
      expect(response.error).toBeUndefined();

      // Read the ACTUAL file content - should be unchanged
      const actualContent = fs.readFileSync(testFile, 'utf8');
      expect(actualContent).toBe(originalContent);

      // No feedback in allowed mode
      expect(
        response.responseParts.functionResponse.response.output,
      ).not.toContain('Emojis were detected');
    });

    /**
     * Test complex edit operations with emoji filtering
     */
    it('should filter emojis from both old_string and new_string in edit operations', async () => {
      // Create initial file with emojis
      const testFile = path.join(tempDir, 'complex-edit.js');
      fs.writeFileSync(
        testFile,
        '// TODO: Fix this bug\nconsole.log("Working on it 🔧");',
      );

      // Set to auto mode
      ConfigurationManager.getInstance().setSessionOverride('auto');

      const request: ToolCallRequestInfo = {
        callId: 'call5',
        name: 'replace',
        args: {
          file_path: testFile,
          old_string: '// TODO: Fix this bug',
          new_string: '// DONE: Fixed the issue ✅',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-5',
      };

      // Execute through nonInteractiveToolExecutor
      const response = await executeToolCall(config, request, toolRegistry);

      // Verify tool execution succeeded
      expect(response.error).toBeUndefined();

      // Read the ACTUAL file content - new string should be filtered, emoji in rest of file should remain
      const actualContent = fs.readFileSync(testFile, 'utf8');
      expect(actualContent).toBe(
        '// DONE: Fixed the issue [OK]\nconsole.log("Working on it 🔧");',
      );

      // Auto mode should be silent
      expect(
        response.responseParts.functionResponse.response.output,
      ).not.toContain('Emojis were detected');
    });
  });

  describe('Search Tools - NO Filtering Behavior', () => {
    /**
     * @requirement Search tools should NOT filter arguments to allow searching for emojis
     */
    it('should NOT filter emoji patterns in grep searches', async () => {
      // Create file with emojis
      const testFile = path.join(tempDir, 'search-target.md');
      fs.writeFileSync(
        testFile,
        'Status: ✅ Complete\nProgress: 🚀 Fast\nIssue: 🐛 Bug found',
      );

      // Set to error mode (most restrictive)
      ConfigurationManager.getInstance().setSessionOverride('error');

      const request: ToolCallRequestInfo = {
        callId: 'call6',
        name: 'search_file_content',
        args: {
          pattern: '✅|🚀',
          path: tempDir,
        },
        isClientInitiated: false,
        prompt_id: 'prompt-6',
      };

      // Execute through nonInteractiveToolExecutor
      const response = await executeToolCall(config, request, toolRegistry);

      // Grep should succeed even in error mode when searching for emojis
      expect(response.error).toBeUndefined();

      // Should find the emojis in the file
      const output = response.responseParts.functionResponse.response
        .output as string;
      expect(output).toContain('✅');
      expect(output).toContain('🚀');
    });

    /**
     * Test that shell commands with emojis are not filtered
     */
    it('should NOT filter emoji arguments to shell commands', async () => {
      // Set to error mode (most restrictive)
      ConfigurationManager.getInstance().setSessionOverride('error');

      const request: ToolCallRequestInfo = {
        callId: 'call7',
        name: 'run_shell_command',
        args: {
          command: 'echo "Status: ✅ Complete"',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-7',
      };

      // Execute through nonInteractiveToolExecutor
      const response = await executeToolCall(config, request, toolRegistry);

      // Shell command should succeed with emojis
      expect(response.error).toBeUndefined();

      // Should preserve emojis in output
      const output = response.responseParts.functionResponse.response
        .output as string;
      expect(output).toContain('✅');
    });

    /**
     * Test that ls tool is not filtered
     */
    it('should NOT filter ls tool arguments (search/listing tool)', async () => {
      // Set to error mode (most restrictive)
      ConfigurationManager.getInstance().setSessionOverride('error');

      const request: ToolCallRequestInfo = {
        callId: 'call8',
        name: 'list_directory',
        args: {
          path: tempDir,
        },
        isClientInitiated: false,
        prompt_id: 'prompt-8',
      };

      // Execute through nonInteractiveToolExecutor
      const response = await executeToolCall(config, request, toolRegistry);

      // ls should succeed even in error mode
      expect(response.error).toBeUndefined();
      expect(response.resultDisplay).toBeDefined();
    });
  });

  describe('Configuration Respect', () => {
    /**
     * Test that configuration changes are immediately effective
     */
    it('should respect configuration changes between tool calls', async () => {
      const testFile1 = path.join(tempDir, 'config-test-1.txt');
      const testFile2 = path.join(tempDir, 'config-test-2.txt');
      const emojiContent = 'Status: ✅ Done';

      // First call in allowed mode
      ConfigurationManager.getInstance().setSessionOverride('allowed');

      const request1: ToolCallRequestInfo = {
        callId: 'call9',
        name: 'write_file',
        args: {
          file_path: testFile1,
          content: emojiContent,
        },
        isClientInitiated: false,
        prompt_id: 'prompt-9',
      };

      const response1 = await executeToolCall(config, request1, toolRegistry);
      expect(response1.error).toBeUndefined();

      const content1 = fs.readFileSync(testFile1, 'utf8');
      expect(content1).toBe(emojiContent); // Unchanged in allowed mode

      // Second call in auto mode
      ConfigurationManager.getInstance().setSessionOverride('auto');

      const request2: ToolCallRequestInfo = {
        callId: 'call10',
        name: 'write_file',
        args: {
          file_path: testFile2,
          content: emojiContent,
        },
        isClientInitiated: false,
        prompt_id: 'prompt-10',
      };

      const response2 = await executeToolCall(config, request2, toolRegistry);
      expect(response2.error).toBeUndefined();

      const content2 = fs.readFileSync(testFile2, 'utf8');
      expect(content2).toBe('Status: [OK] Done'); // Filtered in auto mode
    });

    /**
     * Test that filter creation picks up current configuration
     */
    it('should create fresh filter instance that respects current configuration', async () => {
      const testFile = path.join(tempDir, 'fresh-filter.txt');

      // Change configuration multiple times to ensure fresh filter creation
      ConfigurationManager.getInstance().setSessionOverride('allowed');
      ConfigurationManager.getInstance().setSessionOverride('warn');
      ConfigurationManager.getInstance().setSessionOverride('auto');

      const request: ToolCallRequestInfo = {
        callId: 'call11',
        name: 'write_file',
        args: {
          file_path: testFile,
          content: 'Test ✅ content',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-11',
      };

      const response = await executeToolCall(config, request, toolRegistry);
      expect(response.error).toBeUndefined();

      // Should use auto mode (current setting)
      const actualContent = fs.readFileSync(testFile, 'utf8');
      expect(actualContent).toBe('Test [OK] content');

      // Auto mode should be silent
      expect(
        response.responseParts.functionResponse.response.output,
      ).not.toContain('Emojis were detected');
    });
  });

  describe('Error Handling', () => {
    /**
     * Test that filtering errors are properly propagated
     */
    it('should propagate filtering errors with proper error types', async () => {
      // Set to error mode
      ConfigurationManager.getInstance().setSessionOverride('error');

      const request: ToolCallRequestInfo = {
        callId: 'call12',
        name: 'write_file',
        args: {
          file_path: path.join(tempDir, 'error-test.txt'),
          content: 'Contains emojis 🎉 that should be blocked',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-12',
      };

      const response = await executeToolCall(config, request, toolRegistry);

      // Should have proper error type for blocked execution
      expect(response.error).toBeDefined();
      expect(response.errorType).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(response.error?.message).toContain('emoji');

      // Response should have error in function response
      expect(response.responseParts.functionResponse.response.error).toContain(
        'emoji',
      );
    });

    /**
     * Test edge case: tools with non-standard argument structures
     */
    it('should handle tools with complex argument structures', async () => {
      // Set to auto mode
      ConfigurationManager.getInstance().setSessionOverride('auto');

      // Create initial file for editing
      const testFile = path.join(tempDir, 'complex-args.txt');
      fs.writeFileSync(testFile, 'original content');

      const request: ToolCallRequestInfo = {
        callId: 'call13',
        name: 'replace',
        args: {
          file_path: testFile,
          old_string: 'original content',
          new_string: 'new content with ✅ emoji',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-13',
      };

      const response = await executeToolCall(config, request, toolRegistry);

      // Should handle complex args and filter appropriately
      expect(response.error).toBeUndefined();

      const actualContent = fs.readFileSync(testFile, 'utf8');
      expect(actualContent).toBe('new content with [OK] emoji');
    });
  });

  describe('Performance and Efficiency', () => {
    /**
     * Test that filtering doesn't significantly impact performance
     */
    it('should perform filtering efficiently for large content', async () => {
      // Set to warn mode
      ConfigurationManager.getInstance().setSessionOverride('warn');

      // Generate large content with emojis
      const lines = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`Line ${i}: Status ✅, Progress ⚠️, Result 🎉`);
      }
      const largeContent = lines.join('\n');

      const testFile = path.join(tempDir, 'performance-test.txt');
      const request: ToolCallRequestInfo = {
        callId: 'call14',
        name: 'write_file',
        args: {
          file_path: testFile,
          content: largeContent,
        },
        isClientInitiated: false,
        prompt_id: 'prompt-14',
      };

      const start = Date.now();
      const response = await executeToolCall(config, request, toolRegistry);
      const duration = Date.now() - start;

      // Should complete quickly
      expect(duration).toBeLessThan(1000); // Less than 1 second
      expect(response.error).toBeUndefined();

      // Verify content is properly filtered
      const actualContent = fs.readFileSync(testFile, 'utf8');
      expect(actualContent).not.toContain('✅');
      expect(actualContent).not.toContain('⚠️');
      expect(actualContent).not.toContain('🎉');
      expect(actualContent).toContain('[OK]');
      expect(actualContent).toContain('WARNING:');

      // Should have feedback in warn mode
      expect(response.responseParts.functionResponse.response.output).toContain(
        'Emojis were removed',
      );
    });
  });

  describe('System Feedback Integration', () => {
    /**
     * Test that system feedback is properly appended to llmContent in warn mode
     */
    it('should append system feedback to tool output in warn mode', async () => {
      // Set to warn mode
      ConfigurationManager.getInstance().setSessionOverride('warn');

      const testFile = path.join(tempDir, 'feedback-test.md');
      const request: ToolCallRequestInfo = {
        callId: 'call15',
        name: 'write_file',
        args: {
          file_path: testFile,
          content: '# Document with emojis 📝✨',
        },
        isClientInitiated: false,
        prompt_id: 'prompt-15',
      };

      const response = await executeToolCall(config, request, toolRegistry);

      expect(response.error).toBeUndefined();

      // The response should contain both tool output AND system feedback
      const output = response.responseParts.functionResponse.response
        .output as string;

      // Should contain original tool success message
      expect(output).toContain('Successfully');

      // Should contain system feedback section
      expect(output).toContain('<system-reminder>');
      expect(output).toContain('Emojis were removed');
      expect(output).toContain('</system-reminder>');

      // Verify actual file was filtered
      const actualContent = fs.readFileSync(testFile, 'utf8');
      expect(actualContent).toBe('# Document with emojis ');
    });
  });
});
