/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test for issue #473: Tab characters escaped to literal \t in edit tool
 * This test should reproduce the bug where actual tab characters get converted
 * to literal "\t" strings when using fuzzy matching fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ApprovalMode, Config } from '../config/config.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { EditTool, EditToolParams } from './edit.js';

describe('EditTool - Issue 473 Tab Characters Bug', () => {
  let tool: EditTool;
  let tempDir: string;
  let rootDir: string;
  let mockConfig: Config;
  let filePath: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'edit-tabs-issue473-test-'),
    );
    rootDir = path.join(tempDir, 'root');
    fs.mkdirSync(rootDir);
    filePath = path.join(rootDir, 'test.txt');

    mockConfig = {
      getTargetDir: () => rootDir,
      getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.AUTO_EDIT),
      setApprovalMode: vi.fn(),
      getWorkspaceContext: () => createMockWorkspaceContext(rootDir),
      getFileSystemService: () => new StandardFileSystemService(),
      getIdeClient: () => undefined,
      getIdeMode: () => false,
      getApiKey: () => 'test-api-key',
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
      getEphemeralSetting: vi.fn(() => 'auto'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getToolRegistry: () => ({}) as any,
      getGeminiClient: vi.fn(),
    } as unknown as Config;

    tool = new EditTool(mockConfig);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Tab character handling in fuzzy matching', () => {
    it('should preserve actual tab characters when using fuzzy matching fallback', async () => {
      // Create a file with actual tab characters
      const fileContentWithTabs = `function example() {
${'\t'}console.log('Hello');
${'\t'}return true;
}`;

      fs.writeFileSync(filePath, fileContentWithTabs, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Use fuzzy matching - different indentation that should trigger fallback
        old_string: `function example() {
  console.log('Hello');
  return true;
}`,
        new_string: `function example() {
  console.log('Goodbye');
  return false;
}`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');

      // Should have successfully replaced the content, preserving the original tab indentation
      // The exact match may differ due to fuzzy matching, but it should preserve actual tabs
      expect(newContent).toContain("console.log('Goodbye');");
      expect(newContent).toContain('return false;');

      // Ensure we don't have the literal string "\t" which indicates the bug
      expect(newContent).not.toContain('\\t');
    });

    it('should handle mixed indentation with tabs preserved when fuzzy matching', async () => {
      const fileContentWithTabs = `const config = {
${'\t'}${'\t'}nested: 'value',
${'\t'}other: 'test'
};`;

      fs.writeFileSync(filePath, fileContentWithTabs, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        old_string: `const config = {
    nested: 'value',
    other: 'test'
};`,
        new_string: `const config = {
    nested: 'changed',
    other: 'test'
};`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');

      // Should have successfully replaced the content
      expect(newContent).toContain("nested: 'changed',");

      // Should not have escaped tab literals
      expect(newContent).not.toContain('\\t');
    });

    it('should reproduce the bug: tabs get converted to literal \\t when EscapeNormalizedReplacer is used', async () => {
      // Create a file that will force the system to use EscapeNormalizedReplacer
      const fileContentWithTabs = `function test() {
${'\t'}var x = 1;
${'\t'}return x;
}`;

      fs.writeFileSync(filePath, fileContentWithTabs, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Force fuzzy matching by using escaped sequences
        old_string: `function test() {
\\tvar x = 1;
\\treturn x;
}`,
        new_string: `function test() {
\\tconst x = 1;
\\treturn x;
}`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');

      // FIXED: Should now properly handle escape sequences - tabs should be unescaped
      expect(newContent).not.toMatch(/\\t/); // Should not contain ANY literal \t sequences
      expect(newContent).toContain('\tconst x = 1;'); // Should contain actual tab characters
      expect(newContent).toContain('\treturn x;'); // Should contain actual tab characters
    });

    it('should handle dollar sign escape sequences properly', async () => {
      const fileContent = "const template = 'value: $var';";

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        old_string: "const template = 'value: \\$var';",
        new_string: "const template = 'changed: \\$var';",
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');

      // Should have properly escaped and replaced the content
      expect(newContent).toContain('changed: $var'); // Should contain actual dollar sign
      expect(newContent).not.toContain('\\$'); // Should not contain escaped dollar sign
    });

    it('should preserve tab indentation when replacing content with escape sequences', async () => {
      const fileContent = `function example() {
${'\t'}console.log('original');
${'\t'}return true;
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        old_string: `function example() {
\\tconsole.log('original');
\\treturn true;
}`,
        new_string: `function example() {
\\tconsole.log('modified');
\\treturn false;
}`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');

      // FIXED: Should now properly unescape replacement - tabs should be actual characters
      expect(newContent).toContain("\tconsole.log('modified');"); // Actual tab
      expect(newContent).toContain('\treturn false;'); // Actual tab
      expect(newContent).not.toMatch(/\\t/); // No literal \t sequences
    });
  });
});
