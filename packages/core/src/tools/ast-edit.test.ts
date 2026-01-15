/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  ASTEditTool,
  ASTReadFileTool,
  EnhancedDeclaration,
} from './ast-edit.js';
import { Config } from '../config/config.js';

describe('AST Tools', () => {
  const mockConfig = {
    getWorkspaceContext: () => ({
      isPathWithinWorkspace: () => true,
      getDirectories: () => ['/test'],
    }),
    getTargetDir: () => '/test',
    getFileSystemService: () => ({
      readTextFile: async () => 'test content',
      writeTextFile: async () => {},
    }),
    getApprovalMode: () => 'manual',
    setApprovalMode: () => {},
    getInputService: () => ({}),
  } as unknown as Config;

  it('should instantiate ASTEditTool successfully', () => {
    const tool = new ASTEditTool(mockConfig);
    expect(tool).toBeDefined();
    expect(tool.name).toBe('ast_edit');
    expect(tool.kind).toBe('edit');
    expect(tool.schema).toBeDefined();
  });

  it('should instantiate ASTReadFileTool successfully', () => {
    const tool = new ASTReadFileTool(mockConfig);
    expect(tool).toBeDefined();
    expect(tool.name).toBe('ast_read_file');
    expect(tool.kind).toBe('read');
    expect(tool.schema).toBeDefined();
  });

  it('should return content string when no changes in preview', async () => {
    const tool = new ASTEditTool(mockConfig);
    expect(tool).toBeDefined();

    const invocation = (
      tool as unknown as {
        createInvocation: (params: {
          file_path: string;
          old_string: string;
          new_string: string;
          force?: boolean;
        }) => {
          execute: (signal: AbortSignal) => Promise<{
            returnDisplay: { newContent?: string; originalContent?: string };
          }>;
        };
      }
    ).createInvocation({
      file_path: '/test/sample.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 1;',
      force: false,
    });

    const result = await invocation.execute(new AbortController().signal);
    const display = result.returnDisplay;
    expect(display.newContent).toBe('const x = 1;');
    expect(display.newContent).toBe(display.originalContent);
  });

  describe('AST extraction logic', () => {
    const extractor = (
      new ASTEditTool(mockConfig) as unknown as {
        contextCollector: {
          astExtractor: {
            extractDeclarations: (
              path: string,
              content: string,
            ) => Promise<EnhancedDeclaration[]>;
          };
        };
      }
    ).contextCollector.astExtractor;

    it('should extract TypeScript declarations correctly', async () => {
      const code = `
        import { foo } from "./bar";
        const x: number = 10;
        function hello(name: string): string {
          return "Hello " + name;
        }
        class MyClass {
          constructor() {}
          public method() {}
          private secret = "shh";
        }
      `;
      const results = await extractor.extractDeclarations('test.ts', code);
      expect(results).toMatchSnapshot();
    });

    it('should extract Python declarations correctly', async () => {
      const code = `
        import os
        def my_func():
            pass
        class PythonClass:
            def __init__(self):
                pass
      `;
      const results = await extractor.extractDeclarations('test.py', code);
      expect(results).toMatchSnapshot();
    });

    it('should extract signatures', async () => {
      const code = `function test(a: number): void {}`;
      const results = await extractor.extractDeclarations('test.ts', code);
      expect(results[0].signature).toBe('(a: number): void');
    });
  });

  describe('Freshness Check', () => {
    // TODO: Implement integration test for freshness check behavior.
    // The previous test was removed because it only verified a constant string equality
    // ('file_modified_conflict' === 'file_modified_conflict').
    // A proper test should mock the file system service to return a modified timestamp
    // different from the one passed in params, and verify that the tool returns
    // a ToolErrorType.FILE_MODIFIED_CONFLICT error.
  });
});
