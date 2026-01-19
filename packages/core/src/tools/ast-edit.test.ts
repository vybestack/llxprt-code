/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs, { promises as fsPromises } from 'fs';
import {
  ASTEditTool,
  ASTReadFileTool,
  EnhancedDeclaration,
} from './ast-edit.js';
import { Config } from '../config/config.js';
import { ToolErrorType } from './tool-error.js';

describe('AST Tools', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const mockConfig = {
    getWorkspaceContext: () => ({
      isPathWithinWorkspace: () => true,
      getDirectories: () => ['/test'],
    }),
    getTargetDir: () => '/test',
    getFileSystemService: () => ({
      readTextFile: async () => 'const x = 1;',
      writeTextFile: async () => {},
      fileExists: async () => true,
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
    it('should return FILE_MODIFIED_CONFLICT when file has been modified', async () => {
      const olderTimestamp = Date.now() - 10000;
      const newerTimestamp = Date.now();

      vi.spyOn(fsPromises, 'stat').mockResolvedValue({
        mtime: new Date(newerTimestamp),
      } as fs.Stats);

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as {
          createInvocation: (params: {
            file_path: string;
            old_string: string;
            new_string: string;
            last_modified?: number;
            force?: boolean;
          }) => {
            execute: (signal: AbortSignal) => Promise<{
              returnDisplay:
                | string
                | { newContent?: string; originalContent?: string };
              error?: { message: string; type: ToolErrorType };
            }>;
          };
        }
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        last_modified: olderTimestamp,
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.FILE_MODIFIED_CONFLICT);
      expect(result.returnDisplay).toContain('Error:');
    });
  });

  describe('Performance Optimization', () => {
    it('should not call buildSymbolIndex when indexing is disabled', async () => {
      const tool = new ASTReadFileTool(mockConfig);
      const collector = (
        tool as unknown as {
          contextCollector: {
            relationshipAnalyzer: { buildSymbolIndex: () => void };
            collectEnhancedContext: (
              p: string,
              c: string,
              w: string,
            ) => Promise<unknown>;
          };
        }
      ).contextCollector;
      const analyzer = collector.relationshipAnalyzer;
      const spy = vi.spyOn(analyzer, 'buildSymbolIndex');

      await collector.collectEnhancedContext(
        '/test/file.ts',
        'const x = 1;',
        '/test',
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('should prioritize important symbols', () => {
      const tool = new ASTReadFileTool(mockConfig);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing internal method for testing
      const collector = (tool as any).contextCollector;
      const decls: EnhancedDeclaration[] = [
        {
          name: 'MyClass',
          type: 'class',
          line: 1,
          column: 1,
          range: {
            start: { line: 1, column: 1 },
            end: { line: 10, column: 1 },
          },
        },
        {
          name: 'myFunc',
          type: 'function',
          line: 11,
          column: 1,
          range: {
            start: { line: 11, column: 1 },
            end: { line: 12, column: 1 },
          },
        },
        {
          name: 'a',
          type: 'variable',
          line: 13,
          column: 1,
          range: {
            start: { line: 13, column: 1 },
            end: { line: 13, column: 2 },
          },
        },
      ];

      const prioritized = collector.prioritizeSymbolsFromDeclarations(decls);
      expect(prioritized).toContain('MyClass');
      expect(prioritized).toContain('myFunc');
      expect(prioritized).not.toContain('a'); // 'a' is too short (length < 3)
    });
  });
});
