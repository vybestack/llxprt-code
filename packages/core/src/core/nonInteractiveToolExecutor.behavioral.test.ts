import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeToolCall } from './nonInteractiveToolExecutor';
import { ConfigurationManager } from '../filters/ConfigurationManager';
import { Config } from '../config/config';
import { ToolRegistry } from '../tools/tool-registry';
import { WriteFileTool } from '../tools/write-file';
import { EditTool } from '../tools/edit';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('nonInteractiveToolExecutor - Emoji Filter Behavioral Tests', () => {
  let configManager: ConfigurationManager;
  let config: Config;
  let toolRegistry: ToolRegistry;
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for file operations
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-behavioral-test-'));

    // Create minimal config mock
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
      getEphemeralSetting: vi.fn(() => 'auto'), // Default to 'auto' for emoji filter
      getToolRegistry: () => null,
      getSessionId: () => 'test-session',
      getUsageStatisticsEnabled: () => true,
      getEphemeralSettings: () => ({}),
      getCoreTools: () => [],
      getExcludeTools: () => [],
      getSummarizeToolOutputConfig: () => ({ enabled: false }),
    };
    config = mockConfig as unknown as Config;

    // Reset ConfigurationManager
    (ConfigurationManager as unknown as { instance: unknown }).instance = null;
    configManager = ConfigurationManager.getInstance();
    configManager.initialize(config, null);
    configManager._resetForTesting();

    // Create tool registry with real tools
    toolRegistry = new ToolRegistry(config);
    toolRegistry.registerTool(new WriteFileTool(config));
    toolRegistry.registerTool(new EditTool(config));
  });

  describe('Edit tool emoji filtering behavior', () => {
    it('should preserve old_string exactly for matching while filtering new_string', async () => {
      // Given: Emoji filter is enabled in auto mode
      configManager.setSessionOverride('auto');

      // And: We have a file with emojis that needs to be edited
      const filePath = path.join(tempDir, 'test.txt');
      const existingContent = 'Hello 🌟 World! This is awesome! 🎉';
      fs.writeFileSync(filePath, existingContent);

      // When: We try to edit this content via executeToolCall
      const result = await executeToolCall(
        config,
        {
          name: 'replace',
          arguments: {
            file_path: filePath,
            old_string: existingContent, // This MUST match exactly what's in the file
            new_string: 'Hello ⭐ World! This is great! 🚀', // This should be filtered
          },
        },
        toolRegistry,
      );

      // Then: The operation should succeed (proving old_string was not filtered)
      expect(result.error).toBeUndefined();

      // And: The file should contain filtered content
      const finalContent = fs.readFileSync(filePath, 'utf-8');
      expect(finalContent).toBe('Hello  World! This is great! ');

      // And: The response should show the filtering happened
      expect(result.output).toContain('Hello  World! This is great!');
    });

    it('should allow Edit operations to find and replace emoji-containing text', async () => {
      // Given: Emoji filter is in auto mode
      configManager.setSessionOverride('auto');

      // And: We have a file with text that contains emojis
      const filePath = path.join(tempDir, 'doc.md');
      const textToReplace = 'Task completed! ✅ Moving to next step 🚀';
      const fileContent = `# Project Status\n\n${textToReplace}\n\nMore content here.`;
      fs.writeFileSync(filePath, fileContent);

      const replacementText = 'Task done! ✔️ Proceeding to next phase 🎯';

      // When: We execute an edit via the tool executor
      const result = await executeToolCall(
        config,
        {
          name: 'replace',
          arguments: {
            file_path: filePath,
            old_string: textToReplace,
            new_string: replacementText,
          },
        },
        toolRegistry,
      );

      // Then: The operation should succeed (old_string matched correctly)
      expect(result.error).toBeUndefined();

      // And: The file should have the filtered replacement
      const finalContent = fs.readFileSync(filePath, 'utf-8');
      expect(finalContent).toContain(
        'Task done! [OK] Proceeding to next phase',
      );
      expect(finalContent).not.toContain('✔️');
      expect(finalContent).not.toContain('🎯');
    });

    it('should handle MultiEdit operations with emoji filtering', async () => {
      // Given: Emoji filter is enabled
      configManager.setSessionOverride('auto');

      // And: We have a file with multiple lines containing emojis
      const filePath = path.join(tempDir, 'code.ts');
      const fileContent = `// TODO: Fix this 🔥
const status = "pending"; // 🚧
console.log("Starting...");`;
      fs.writeFileSync(filePath, fileContent);

      // When: We perform multiple edits with emojis
      const result = await executeToolCall(
        config,
        {
          name: 'replace_multiple',
          arguments: {
            file_path: filePath,
            edits: [
              {
                old_string: '// TODO: Fix this 🔥',
                new_string: '// DONE: Fixed 🎉',
              },
              {
                old_string: 'const status = "pending"; // 🚧',
                new_string: 'const status = "completed"; // ✅',
              },
            ],
          },
        },
        toolRegistry,
      );

      // Then: The operation should succeed
      expect(result.error).toBeUndefined();

      // And: The file should have filtered replacements
      const finalContent = fs.readFileSync(filePath, 'utf-8');
      expect(finalContent).toContain('// DONE: Fixed');
      expect(finalContent).not.toContain('🎉');
      expect(finalContent).toContain('const status = "completed"; // [OK]');
      expect(finalContent).not.toContain('✅');
    });
  });

  describe('Write tool emoji filtering behavior', () => {
    it('should filter emojis from file content in write operations', async () => {
      // Given: Emoji filter is enabled
      configManager.setSessionOverride('auto');

      const filePath = path.join(tempDir, 'readme.md');

      // When: We write content with emojis
      const result = await executeToolCall(
        config,
        {
          name: 'write',
          arguments: {
            file_path: filePath,
            content:
              '# Project 🚀\n\nWelcome! 👋 This project is awesome! ⭐\n\n## Features ✨\n- Fast ⚡\n- Reliable ✅',
          },
        },
        toolRegistry,
      );

      // Then: The operation should succeed
      expect(result.error).toBeUndefined();

      // And: The file should have filtered content
      const finalContent = fs.readFileSync(filePath, 'utf-8');
      expect(finalContent).toBe(
        '# Project \n\nWelcome!  This project is awesome! \n\n## Features \n- Fast \n- Reliable [OK]',
      );
    });
  });

  describe('Error mode behavior', () => {
    it('should return error when emojis are detected in error mode', async () => {
      // Given: Emoji filter is in error mode
      configManager.setSessionOverride('error');

      const filePath = path.join(tempDir, 'test.txt');

      // When: We attempt to write content with emojis
      const result = await executeToolCall(
        config,
        {
          name: 'write',
          arguments: {
            file_path: filePath,
            content: 'Hello 🌍!',
          },
        },
        toolRegistry,
      );

      // Then: The operation should fail with an emoji error
      expect(result.error).toBeDefined();
      expect(result.error?.toString()).toContain('Emoji detected');
      expect(result.error?.toString()).toContain('mode: error');
    });
  });

  describe('Allowed mode behavior', () => {
    it('should not filter any emojis in allowed mode', async () => {
      // Given: Emoji filter is in allowed mode
      configManager.setSessionOverride('allowed');

      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'Hello 🌟 World!');

      // When: We use emojis in tool calls
      const result = await executeToolCall(
        config,
        {
          name: 'replace',
          arguments: {
            file_path: filePath,
            old_string: 'Hello 🌟 World!',
            new_string: 'Hello 🌙 World!',
          },
        },
        toolRegistry,
      );

      // Then: The operation should succeed
      expect(result.error).toBeUndefined();

      // And: Emojis should be preserved
      const finalContent = fs.readFileSync(filePath, 'utf-8');
      expect(finalContent).toBe('Hello 🌙 World!');
    });
  });

  describe('Critical bug demonstration', () => {
    it('DEMONSTRATES BUG: filtering old_string causes edit operations to fail', async () => {
      // Given: A file with emojis exists
      const filePath = path.join(tempDir, 'bug-demo.txt');
      const originalContent = 'Status: Complete ✅';
      fs.writeFileSync(filePath, originalContent);

      // And: Emoji filter is in auto mode
      configManager.setSessionOverride('auto');

      // When: We try to replace the emoji-containing text
      const result = await executeToolCall(
        config,
        {
          name: 'replace',
          arguments: {
            file_path: filePath,
            old_string: originalContent, // This contains ✅
            new_string: 'Status: Done',
          },
        },
        toolRegistry,
      );

      // Then: THIS TEST WILL FAIL due to the bug
      // The bug is that nonInteractiveToolExecutor filters old_string
      // So it tries to find "Status: Complete [OK]" in a file containing "Status: Complete ✅"
      // This causes the edit to fail with "String not found"

      // What SHOULD happen: The operation succeeds
      expect(result.error).toBeUndefined();

      // What ACTUALLY happens due to bug: The operation fails
      // expect(result.error?.toString()).toContain('String not found');
    });
  });
});
