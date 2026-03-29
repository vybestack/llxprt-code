/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs, { promises as fsPromises } from 'fs';
import * as AstEditModule from './ast-edit.js';
import {
  ASTEditTool,
  ASTReadFileTool,
  type EnhancedDeclaration,
} from './ast-edit.js';
import type { Config } from '../config/config.js';
import { ToolErrorType } from './tool-error.js';
import { prioritizeSymbolsFromDeclarations } from './ast-edit/context-collector.js';

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

      const prioritized = prioritizeSymbolsFromDeclarations(decls);
      expect(prioritized).toContain('MyClass');
      expect(prioritized).toContain('myFunc');
      expect(prioritized).not.toContain('a'); // 'a' is too short (length < 3)
    });
  });

  describe('Export-surface test (Phase 0, Step 0.4)', () => {
    it('should export exactly the expected symbols', () => {
      // NOTE: This test checks runtime exports only (using Object.keys).
      // Type-only exports (EnhancedDeclaration, ASTEditToolParams, ASTReadFileToolParams)
      // are erased at runtime and correctly excluded from this check. Their compile-time
      // correctness is verified by TypeScript's type checker during `npm run typecheck`.
      const actualExports = Object.keys(AstEditModule).sort();
      const expectedExports = [
        'ASTEditTool',
        'ASTReadFileTool',
        'COMMENT_PREFIXES',
        'JAVASCRIPT_FAMILY_EXTENSIONS',
        'KEYWORDS',
        'LANGUAGE_MAP',
        'REGEX',
      ].sort();

      expect(actualExports).toEqual(expectedExports);
    });
  });

  describe('Static method test (Phase 0, Step 0.4)', () => {
    it('ASTEditTool.applyReplacement should be callable', () => {
      expect(typeof ASTEditTool.applyReplacement).toBe('function');

      const result = ASTEditTool.applyReplacement(
        'const x = 1;',
        'x = 1',
        'x = 2',
        false,
      );
      expect(result).toBe('const x = 2;');
    });
  });

  describe('Dependency-direction test (Phase 0, Step 0.4)', () => {
    it('should enforce no upward imports from ast-edit/ submodules', async () => {
      // This test will fail during decomposition if any submodule imports from ../ast-edit.js
      // Currently it's a placeholder since ast-edit/ doesn't exist yet
      // When ast-edit/ directory is created in Phase 1+, this test will validate import hygiene

      const path = await import('path');

      const astEditDir = path.join(
        process.cwd(),
        'packages/core/src/tools/ast-edit',
      );

      try {
        await fsPromises.access(astEditDir);
        // If we get here, the directory exists - check for upward imports
        const files = await fsPromises.readdir(astEditDir, {
          withFileTypes: true,
        });
        const tsFiles = files
          .filter(
            (f) =>
              f.isFile() && (f.name.endsWith('.ts') || f.name.endsWith('.js')),
          )
          .map((f) => f.name);

        for (const fileName of tsFiles) {
          const content = await fsPromises.readFile(
            path.join(astEditDir, fileName),
            'utf-8',
          );
          const hasUpwardImport =
            content.includes("from '../ast-edit.js'") ||
            content.includes('from "../ast-edit.js"');
          expect(hasUpwardImport).toBe(false);
        }
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          // Directory doesn't exist yet - test passes
          expect(true).toBe(true);
        } else {
          throw err;
        }
      }
    });
  });

  describe('Cycle detection test (Phase 0, Step 0.4)', () => {
    it('should detect no import cycles in ast-edit/ siblings', async () => {
      // Three-color DFS cycle detection on the ast-edit/ import graph
      // WHITE = 0, GRAY = 1, BLACK = 2

      const path = await import('path');

      const astEditDir = path.join(
        process.cwd(),
        'packages/core/src/tools/ast-edit',
      );

      try {
        await fsPromises.access(astEditDir);

        // Build import graph
        const files = await fsPromises.readdir(astEditDir, {
          withFileTypes: true,
        });
        const tsFiles = files
          .filter(
            (f) =>
              f.isFile() && (f.name.endsWith('.ts') || f.name.endsWith('.js')),
          )
          .filter(
            (f) => !f.name.endsWith('.test.ts') && !f.name.endsWith('.test.js'),
          );

        const graph = new Map<string, string[]>();
        const moduleNames = new Set(tsFiles.map((f) => f.name));

        for (const file of tsFiles) {
          const filePath = path.join(astEditDir, file.name);
          const content = await fsPromises.readFile(filePath, 'utf-8');

          const imports: string[] = [];
          // Match all local sibling references:
          // - import ... from './foo.js'
          // - import './foo.js' (side-effect)
          // - export ... from './foo.js'
          const localRefRegex =
            /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]\.\/([^'"]+)['"]/g;
          let match;
          while ((match = localRefRegex.exec(content)) !== null) {
            const specifier = match[1];
            const moduleName = specifier.replace(/\.(ts|js)$/, '') + '.ts';
            if (moduleNames.has(moduleName)) {
              imports.push(moduleName);
            }
          }

          graph.set(file.name, imports);
        }

        // Three-color DFS
        const color = new Map<string, number>();
        for (const node of graph.keys()) {
          color.set(node, 0); // WHITE
        }

        function dfs(node: string, path: string[]): boolean {
          if (color.get(node) === 1) {
            // GRAY - cycle detected!
            throw new Error(
              `Import cycle detected: ${path.join(' → ')} → ${node}`,
            );
          }
          if (color.get(node) === 2) {
            // BLACK - already processed
            return false;
          }

          color.set(node, 1); // GRAY
          path.push(node);

          const neighbors = graph.get(node) || [];
          for (const neighbor of neighbors) {
            if (graph.has(neighbor)) {
              dfs(neighbor, [...path]);
            }
          }

          color.set(node, 2); // BLACK
          return false;
        }

        for (const node of graph.keys()) {
          if (color.get(node) === 0) {
            dfs(node, []);
          }
        }

        // If we got here, no cycles
        expect(true).toBe(true);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          // Directory doesn't exist yet - test passes
          expect(true).toBe(true);
        } else {
          throw err;
        }
      }
    });
  });
});
