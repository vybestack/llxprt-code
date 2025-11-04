/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for fuzzy matching features in the edit tool.
 * These tests verify that the edit tool can intelligently match
 * old_string patterns even when there are minor formatting differences.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditTool, EditToolParams } from './edit.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ApprovalMode, Config } from '../config/config.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';

describe('EditTool - Fuzzy Matching', () => {
  let tool: EditTool;
  let tempDir: string;
  let rootDir: string;
  let mockConfig: Config;
  let filePath: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-fuzzy-test-'));
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

  describe('LineTrimmed Matching - whitespace flexibility', () => {
    it('should match content with different leading/trailing whitespace per line', async () => {
      const fileContent = `function greet(name) {
  console.log('Hello, ' + name);
    return true;
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // old_string has trimmed lines (no extra spaces)
        old_string: `console.log('Hello, ' + name);
return true;`,
        new_string: `console.log('Greetings, ' + name);
return true;`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain("console.log('Greetings, ' + name);");
    });

    it('should match multi-line blocks ignoring indentation differences', async () => {
      const fileContent = `if (condition) {
  first();
  second();
  third();
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Provide without indentation
        old_string: `first();
second();
third();`,
        new_string: `alpha();
beta();
gamma();`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('alpha();');
      expect(newContent).toContain('beta();');
      expect(newContent).toContain('gamma();');
    });
  });

  describe('BlockAnchor Matching - first/last line anchors', () => {
    it('should match using first and last line as anchors with similar middle content', async () => {
      const fileContent = `function calculate(x, y) {
  const sum = x + y;
  const product = x * y;
  const average = sum / 2;
  return average;
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Slightly different middle lines but same first/last
        old_string: `function calculate(x, y) {
  const sum = x + y;
  const prod = x * y;
  const avg = sum / 2;
  return average;
}`,
        new_string: `function calculate(x, y) {
  const total = x + y;
  return total / 2;
}`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('const total = x + y;');
      expect(newContent).toContain('return total / 2;');
    });

    it('should handle multiple candidates and pick best match based on similarity', async () => {
      const fileContent = `// First block
function foo() {
  doSomething();
  doOtherThing();
  return result;
}

// Second block
function foo() {
  doSomething();
  doCompletelyDifferentThing();
  return result;
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // This should match the first block better
        old_string: `function foo() {
  doSomething();
  doOtherStuff();
  return result;
}`,
        new_string: `function foo() {
  doReplacedThing();
  return result;
}`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      // Should have replaced the first block
      expect(newContent).toContain('doReplacedThing();');
      // Second block should remain unchanged
      expect(newContent).toContain('doCompletelyDifferentThing();');
    });
  });

  describe('WhitespaceNormalized Matching', () => {
    it('should match content with normalized whitespace', async () => {
      const fileContent = `const config = {
  apiKey:    'test-key',
  timeout:   5000
};`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Single space version
        old_string: `apiKey: 'test-key',`,
        new_string: `apiKey: 'production-key',`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain("apiKey: 'production-key',");
    });

    it('should match multi-line content with various whitespace', async () => {
      const fileContent = `function     process(data) {
  return    data.map(item   =>   item.value);
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Normalized whitespace version
        old_string: `function process(data) {
  return data.map(item => item.value);
}`,
        new_string: `function process(data) {
  return data.filter(item => item.active).map(item => item.value);
}`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('filter(item => item.active)');
    });
  });

  describe('IndentationFlexible Matching', () => {
    it('should match content regardless of common indentation level', async () => {
      const fileContent = `  class Example {
    constructor() {
      this.value = 0;
    }
  }`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Provide with no leading indentation
        old_string: `constructor() {
  this.value = 0;
}`,
        new_string: `constructor(initialValue) {
  this.value = initialValue;
}`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('constructor(initialValue)');
      expect(newContent).toContain('this.value = initialValue;');
    });

    it('should preserve relative indentation when matching', async () => {
      const fileContent = `    if (condition) {
      nested1();
        nested2();
      nested3();
    }`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Match with relative indentation but different base
        old_string: `nested1();
  nested2();
nested3();`,
        new_string: `action1();
  action2();
action3();`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('action1();');
      expect(newContent).toContain('action2();');
      expect(newContent).toContain('action3();');
    });
  });

  describe('EscapeNormalized Matching', () => {
    it('should match content with escaped characters normalized', async () => {
      const fileContent = `const message = "Hello\\nWorld";
const path = "C:\\\\Users\\\\test";`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Provide with escaped newline
        old_string: `const message = "Hello\\nWorld";`,
        new_string: `const message = "Greetings\\nEveryone";`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('Greetings\\nEveryone');
    });

    it('should handle tab characters in matching', async () => {
      const fileContent = `function test() {\n\tvar x = 1;\n\treturn x;\n}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Using \\t escape sequence
        old_string: `\tvar x = 1;`,
        new_string: `\tconst x = 1;`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('const x = 1;');
    });
  });

  describe('ContextAware Matching', () => {
    it('should match using context anchors with partial middle content match', async () => {
      const fileContent = `function validate(input) {
  if (!input) {
    throw new Error('Invalid input');
  }
  const trimmed = input.trim();
  const normalized = trimmed.toLowerCase();
  return normalized;
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // First and last lines match, middle lines partially match
        old_string: `function validate(input) {
  if (!input) {
    throw new Error('Bad input');
  }
  const cleaned = input.trim();
  const lower = cleaned.toLowerCase();
  return lower;
}`,
        new_string: `function validate(input) {
  if (!input) {
    return null;
  }
  return input.trim().toLowerCase();
}`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('return null;');
      expect(newContent).toContain('return input.trim().toLowerCase();');
    });

    it('should match even with low similarity when there is only one candidate (single candidate threshold)', async () => {
      const fileContent = `function process() {
  line1();
  line2();
  line3();
  line4();
  return result;
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // First and last match, but middle is too different
        // With only one candidate, BlockAnchorReplacer uses SINGLE_CANDIDATE_SIMILARITY_THRESHOLD (0.0)
        // so it will match even with low similarity
        old_string: `function process() {
  completelyDifferent1();
  completelyDifferent2();
  completelyDifferent3();
  completelyDifferent4();
  return result;
}`,
        new_string: `function process() {
  newLine1();
  return result;
}`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      // Should succeed because with single candidate, threshold is 0.0
      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('newLine1();');
    });
  });

  describe('Fuzzy matching should not break existing features', () => {
    it('should still validate expected_replacements with fuzzy matching', async () => {
      const fileContent = `line old text
another old text
final old text`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'old',
        new_string: 'new',
        expected_replacements: 3,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toBe(
        'line new text\nanother new text\nfinal new text',
      );
    });

    it('should fail if fuzzy match finds multiple occurrences but expected_replacements is 1', async () => {
      const fileContent = `function foo() {
  doSomething();
}

function foo() {
  doSomething();
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        old_string: `function foo() {
  doSomething();
}`,
        new_string: `function foo() {
  doReplacedThing();
}`,
        expected_replacements: 1,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      // Should fail because there are 2 exact matches but we expected 1
      expect(result.llmContent).toMatch(/Expected 1 occurrence but found 2/);
    });

    it('should still respect workspace boundary validation', async () => {
      const outsidePath = path.join(tempDir, 'outside.txt');
      fs.writeFileSync(outsidePath, 'content', 'utf8');

      const params: EditToolParams = {
        file_path: outsidePath,
        old_string: 'content',
        new_string: 'new content',
      };

      expect(() => tool.build(params)).toThrow(
        /File path must be within one of the workspace directories/,
      );
    });

    it('should still apply emoji filtering', async () => {
      const fileContent = 'Hello World';
      fs.writeFileSync(filePath, fileContent, 'utf8');

      // Configure emoji filter to warn mode
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockConfig.getEphemeralSetting as any).mockReturnValue('warn');

      const params: EditToolParams = {
        file_path: filePath,
        old_string: 'World',
        new_string: 'World ', // Contains emoji
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      // Should succeed but may have filtered or warned about emoji
      expect(result.llmContent).toMatch(/Successfully modified file|emoji/i);
    });
  });

  describe('Uniqueness validation with fuzzy matching', () => {
    it('should only apply fuzzy replacement when there is exactly one match', async () => {
      const fileContent = `function test1() {
  console.log('test');
}

function test2() {
  console.log('test');
}`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // This could match both functions with fuzzy matching
        old_string: `console.log('test');`,
        new_string: `console.log('modified');`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      // Should fail because multiple matches exist
      expect(result.llmContent).toMatch(/Expected 1 occurrence but found 2/);
    });

    it('should succeed when fuzzy matching finds unique occurrence', async () => {
      const fileContent = `  if (condition) {
    doAction();
  }`;

      fs.writeFileSync(filePath, fileContent, 'utf8');

      const params: EditToolParams = {
        file_path: filePath,
        // Match without exact indentation
        old_string: `doAction();`,
        new_string: `performAction();`,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toMatch(/Successfully modified file/);
      const newContent = fs.readFileSync(filePath, 'utf8');
      expect(newContent).toContain('performAction();');
    });
  });
});
