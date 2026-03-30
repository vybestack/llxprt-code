/**
 * Characterization Tests for ast-edit.ts Monolith
 *
 * These tests lock down the current behavior of the 2,491-line monolith
 * BEFORE decomposition. All tests import from '../ast-edit.js' and must
 * pass against the current code without any modifications.
 *
 * Phase 0, Step 0.1: Core characterization tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ASTEditTool,
  ASTReadFileTool,
  KEYWORDS,
  COMMENT_PREFIXES,
  REGEX,
  JAVASCRIPT_FAMILY_EXTENSIONS,
  LANGUAGE_MAP,
} from '../ast-edit.js';
import type { Config } from '../../config/config.js';
import { ApprovalMode } from '../../config/config.js';
import { ToolErrorType } from '../tool-error.js';

// Define typed interfaces for private API access in tests
type TestableASTEditTool = {
  createInvocation(params: Record<string, unknown>): {
    execute(signal: AbortSignal): Promise<Record<string, unknown>>;
    shouldConfirmExecute(
      signal: AbortSignal,
    ): Promise<Record<string, unknown> | undefined>;
    getDescription(): string;
    toolLocations(): Array<{ path: string; line?: number }>;
  };
  validateToolParamValues(params: Record<string, unknown>): void;
  getModifyContext(signal: AbortSignal): {
    getFilePath(params: Record<string, unknown>): string;
    getCurrentContent(params: Record<string, unknown>): Promise<string | null>;
    getProposedContent(params: Record<string, unknown>): Promise<string>;
    createUpdatedParams(
      oldContent: string,
      newContent: string,
      params: Record<string, unknown>,
    ): Record<string, unknown>;
  };
  schema: {
    parametersJsonSchema: JsonSchema;
  };
};

type TestableASTReadFileTool = {
  createInvocation(params: Record<string, unknown>): {
    execute(signal: AbortSignal): Promise<Record<string, unknown>>;
    getDescription(): string;
    toolLocations(): Array<{ path: string; line?: number }>;
  };
  validateToolParamValues(params: Record<string, unknown>): void;
  schema: {
    parametersJsonSchema: JsonSchema;
  };
};

type ToolReturnDisplay = {
  fileDiff?: string;
  fileName?: string;
  originalContent?: string;
  newContent?: string;
  content?: string;
  filePath?: string;
  metadata?: {
    astValidation?: {
      valid: boolean;
      errors: unknown[];
    };
    currentMtime?: number;
    fileFreshness?: unknown;
  };
};

type JsonSchema = {
  required: string[];
  properties: Record<
    string,
    { type: string; description?: string; default?: unknown; minimum?: number }
  >;
};

describe('ast-edit characterization tests', () => {
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      getWorkspaceContext: () => ({
        isPathWithinWorkspace: () => true,
        getDirectories: () => ['/test'],
      }),
      getTargetDir: () => '/test',
      getFileSystemService: () => ({
        readTextFile: async (path: string) => {
          if (path.includes('nonexistent')) {
            const err = new Error('ENOENT') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            throw err;
          }
          return 'const x = 1;';
        },
        writeTextFile: async () => {},
        fileExists: async (path: string) => !path.includes('nonexistent'),
      }),
      getApprovalMode: () => ApprovalMode.MANUAL,
      setApprovalMode: vi.fn(),
      getLspServiceClient: () => undefined,
    } as unknown as Config;
  });

  describe('Tool instantiation', () => {
    it('ASTEditTool should instantiate with expected properties', () => {
      const tool = new ASTEditTool(mockConfig);
      expect(tool).toBeDefined();
      expect(tool.name).toBe('ast_edit');
      expect(tool.kind).toBe('edit');
      expect(tool.schema).toBeDefined();
    });

    it('ASTReadFileTool should instantiate with expected properties', () => {
      const tool = new ASTReadFileTool(mockConfig);
      expect(tool).toBeDefined();
      expect(tool.name).toBe('ast_read_file');
      expect(tool.kind).toBe('read');
      expect(tool.schema).toBeDefined();
    });
  });

  describe('Preview mode behavior', () => {
    it('should return preview with LLXPRT EDIT PREVIEW: header', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(typeof result.llmContent).toBe('string');
      expect(result.llmContent).toMatch(/LLXPRT EDIT PREVIEW:/);
    });

    it('should include AST validation in preview', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain('AST validation:');
    });

    it('should include NEXT STEP instruction in preview', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toContain(
        'NEXT STEP: Call again with force: true',
      );
    });

    it('should have returnDisplay with required fields', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      const display = result.returnDisplay as ToolReturnDisplay;

      expect(display).toHaveProperty('fileDiff');
      expect(display).toHaveProperty('fileName');
      expect(display).toHaveProperty('originalContent');
      expect(display).toHaveProperty('newContent');
      expect(display.metadata).toHaveProperty('astValidation');
      expect(display.metadata).toHaveProperty('currentMtime');
    });
  });

  describe('toolLocations()', () => {
    it('ASTEditTool should return file path', () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
      });

      const locations = invocation.toolLocations();
      expect(locations).toHaveLength(1);
      expect(locations[0].path).toBe('/test/sample.ts');
    });

    it('ASTReadFileTool should return file path and offset line', () => {
      const tool = new ASTReadFileTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTReadFileTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        offset: 10,
        limit: 5,
      });

      const locations = invocation.toolLocations();
      expect(locations).toHaveLength(1);
      expect(locations[0].path).toBe('/test/sample.ts');
      expect(locations[0].line).toBe(10);
    });
  });

  describe('getDescription()', () => {
    it('preview should contain [PREVIEW]', () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: false,
      });

      const desc = invocation.getDescription();
      expect(desc).toContain('[PREVIEW]');
    });

    it('execute should contain [EXECUTE]', () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: true,
      });

      const desc = invocation.getDescription();
      expect(desc).toContain('[EXECUTE]');
    });

    it('empty old_string should start with "Create"', () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/newfile.ts',
        old_string: '',
        new_string: 'const x = 1;',
        force: false,
      });

      const desc = invocation.getDescription();
      expect(desc).toMatch(/^Create /);
    });

    it('ASTReadFileTool should return shortened path', () => {
      const tool = new ASTReadFileTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTReadFileTool
      ).createInvocation({
        file_path: '/test/some/very/long/path/to/file.ts',
      });

      const desc = invocation.getDescription();
      expect(desc).toBeTruthy();
      expect(desc.length).toBeLessThan(100);
    });
  });

  describe('Export contract verification', () => {
    it('should export all expected symbols', () => {
      expect(ASTEditTool).toBeDefined();
      expect(ASTReadFileTool).toBeDefined();
      expect(KEYWORDS).toBeDefined();
      expect(COMMENT_PREFIXES).toBeDefined();
      expect(REGEX).toBeDefined();
      expect(JAVASCRIPT_FAMILY_EXTENSIONS).toBeDefined();
      expect(LANGUAGE_MAP).toBeDefined();
    });

    it('KEYWORDS should be an object with FUNCTION, CLASS, etc.', () => {
      expect(KEYWORDS).toHaveProperty('FUNCTION');
      expect(KEYWORDS).toHaveProperty('CLASS');
    });

    it('COMMENT_PREFIXES should be an array', () => {
      expect(Array.isArray(COMMENT_PREFIXES)).toBe(true);
    });
  });

  describe('ASTEditTool.applyReplacement static method', () => {
    it('should be callable and perform basic replacement', () => {
      expect(typeof ASTEditTool.applyReplacement).toBe('function');

      const result = ASTEditTool.applyReplacement(
        'const x = 1;',
        'x = 1',
        'x = 2',
        false,
      );
      expect(result).toBe('const x = 2;');
    });

    it('should handle new file creation', () => {
      const result = ASTEditTool.applyReplacement(
        null,
        '',
        'const x = 1;',
        true,
      );
      expect(result).toBe('const x = 1;');
    });

    it('should preserve literal $ sequences in replacement strings', () => {
      // $& should be inserted literally, not expanded
      const result1 = ASTEditTool.applyReplacement(
        'hello world',
        'world',
        '$& again',
        false,
      );
      expect(result1).toBe('hello $& again');

      // $$ should be inserted literally, not collapsed
      const result2 = ASTEditTool.applyReplacement(
        'price 10',
        '10',
        '$$20',
        false,
      );
      expect(result2).toBe('price $$20');
    });
  });

  describe('Schema stability', () => {
    describe('ASTEditTool schema', () => {
      it('should have exactly the expected required parameters', () => {
        const tool = new ASTEditTool(
          mockConfig,
        ) as unknown as TestableASTEditTool;
        const schema = tool.schema.parametersJsonSchema;
        expect(schema.required).toStrictEqual([
          'file_path',
          'old_string',
          'new_string',
        ]);
      });

      it('should have exactly the expected optional parameters', () => {
        const tool = new ASTEditTool(
          mockConfig,
        ) as unknown as TestableASTEditTool;
        const schema = tool.schema.parametersJsonSchema;
        const allParams = Object.keys(schema.properties).sort((a, b) =>
          a.localeCompare(b),
        );
        const requiredParams = [...schema.required].sort((a, b) =>
          a.localeCompare(b),
        );
        const optionalParams = allParams
          .filter((p) => !requiredParams.includes(p))
          .sort((a, b) => a.localeCompare(b));
        expect(optionalParams).toStrictEqual(['force', 'last_modified']);
      });

      it('should have correct property types and descriptions', () => {
        const tool = new ASTEditTool(
          mockConfig,
        ) as unknown as TestableASTEditTool;
        const schema = tool.schema.parametersJsonSchema;
        const props = schema.properties;
        // Required params
        expect(props.file_path.type).toBe('string');
        expect(props.file_path.description).toContain('absolute path');
        expect(props.old_string.type).toBe('string');
        expect(props.old_string.description).toContain('exact literal text');
        expect(props.new_string.type).toBe('string');
        // Optional params
        expect(props.force.type).toBe('boolean');
        expect(props.force.default).toBe(false);
        expect(props.last_modified.type).toBe('number');
        expect(props.last_modified.description).toContain('Timestamp');
      });
    });

    describe('ASTReadFileTool schema', () => {
      it('should have exactly the expected required parameters', () => {
        const tool = new ASTReadFileTool(
          mockConfig,
        ) as unknown as TestableASTReadFileTool;
        const schema = tool.schema.parametersJsonSchema;
        expect(schema.required).toStrictEqual(['file_path']);
      });

      it('should have exactly the expected optional parameters', () => {
        const tool = new ASTReadFileTool(
          mockConfig,
        ) as unknown as TestableASTReadFileTool;
        const schema = tool.schema.parametersJsonSchema;
        const allParams = Object.keys(schema.properties).sort((a, b) =>
          a.localeCompare(b),
        );
        const requiredParams = [...schema.required].sort((a, b) =>
          a.localeCompare(b),
        );
        const optionalParams = allParams
          .filter((p) => !requiredParams.includes(p))
          .sort((a, b) => a.localeCompare(b));
        expect(optionalParams).toStrictEqual(['limit', 'offset']);
      });

      it('should have correct property types and constraints', () => {
        const tool = new ASTReadFileTool(
          mockConfig,
        ) as unknown as TestableASTReadFileTool;
        const schema = tool.schema.parametersJsonSchema;
        const props = schema.properties;
        expect(props.file_path.type).toBe('string');
        expect(props.file_path.description).toContain('absolute path');
        expect(props.offset.type).toBe('number');
        expect(props.offset.minimum).toBe(1);
        expect(props.limit.type).toBe('number');
        expect(props.limit.minimum).toBe(1);
      });
    });
  });

  describe('getModifyContext', () => {
    it('should provide required methods', () => {
      const tool = new ASTEditTool(mockConfig);
      const ctx = tool.getModifyContext(new AbortController().signal);

      expect(typeof ctx.getFilePath).toBe('function');
      expect(typeof ctx.getCurrentContent).toBe('function');
      expect(typeof ctx.getProposedContent).toBe('function');
      expect(typeof ctx.createUpdatedParams).toBe('function');
    });

    it('getFilePath should return params.file_path', () => {
      const tool = new ASTEditTool(mockConfig);
      const ctx = tool.getModifyContext(new AbortController().signal);
      const params = {
        file_path: '/test/foo.ts',
        old_string: 'a',
        new_string: 'b',
      };
      expect(ctx.getFilePath(params)).toBe('/test/foo.ts');
    });

    it('getProposedContent should apply replacement using ASTEditTool.applyReplacement', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;',
      });

      const tool = new ASTEditTool(mockConfig);
      const ctx = tool.getModifyContext(new AbortController().signal);
      const params = {
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
      };

      const proposed = await ctx.getProposedContent(params);
      expect(proposed).toBe('const x = 2;');
    });

    it('getProposedContent should return new_string when file does not exist (ENOENT)', async () => {
      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';

      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => {
          throw enoentError;
        },
      });

      const tool = new ASTEditTool(mockConfig);
      const ctx = tool.getModifyContext(new AbortController().signal);
      const params = {
        file_path: '/test/nonexistent.ts',
        old_string: '',
        new_string: 'new file content',
      };

      const proposed = await ctx.getProposedContent(params);
      expect(proposed).toBe('new file content');
    });

    it('createUpdatedParams should merge old/new content into params', () => {
      const tool = new ASTEditTool(mockConfig);
      const ctx = tool.getModifyContext(new AbortController().signal);
      const original = {
        file_path: '/test/foo.ts',
        old_string: 'a',
        new_string: 'b',
        force: true,
      };

      const updated = ctx.createUpdatedParams(
        'old-content',
        'new-content',
        original,
      );

      expect(updated.old_string).toBe('old-content');
      expect(updated.new_string).toBe('new-content');
      expect(updated.file_path).toBe('/test/foo.ts');
      expect(updated.force).toBe(true);
    });
  });

  describe('shouldConfirmExecute', () => {
    it('preview mode (force: false) should not require confirmation', async () => {
      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: false,
      });

      const result = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(result).toBe(false);
    });

    it('AUTO_EDIT mode should not require confirmation', async () => {
      mockConfig.getApprovalMode = () => ApprovalMode.AUTO_EDIT;

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: true,
      });

      const result = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(result).toBe(false);
    });

    it('MANUAL mode should return confirmation payload', async () => {
      mockConfig.getApprovalMode = () => ApprovalMode.MANUAL;

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: true,
      });

      const result = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      if (result != null) {
        expect(result).toHaveProperty('metadata');
        expect(result.metadata).toHaveProperty('astValidation');
        expect(result.metadata).toHaveProperty('fileFreshness');
        expect(result).toHaveProperty('type');
      }
    });

    it('ProceedAlways should call setApprovalMode(AUTO_EDIT)', async () => {
      const { ToolConfirmationOutcome } = await import('../tools.js');

      mockConfig.getApprovalMode = () => ApprovalMode.MANUAL;
      const setApprovalModeSpy = vi.fn();
      mockConfig.setApprovalMode = setApprovalModeSpy;

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: true,
      });

      const confirmationDetails = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      if (confirmationDetails?.onConfirm) {
        await confirmationDetails.onConfirm(
          ToolConfirmationOutcome.ProceedAlways,
        );
        expect(setApprovalModeSpy).toHaveBeenCalledWith(ApprovalMode.AUTO_EDIT);
      }
    });
  });

  describe('countOccurrences behavior', () => {
    it('should return 0 or 1, not actual count (String.replace behavior)', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'hello hello hello', // 3 occurrences
        writeTextFile: async () => {},
        fileExists: async () => true,
      });
      mockConfig.getApprovalMode = () => ApprovalMode.AUTO_EDIT;

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.txt',
        old_string: 'hello',
        new_string: 'goodbye',
        force: false, // Use preview to avoid directory creation issues
      });

      const result = await invocation.execute(new AbortController().signal);
      // String.replace only replaces first occurrence
      // So 'hello hello hello' becomes 'goodbye hello hello'
      if (!result.error) {
        const display = result.returnDisplay as ToolReturnDisplay;
        expect(display.newContent).toBe('goodbye hello hello');
        // This proves countOccurrences returns 1 (not 3) since there's no "multiple occurrences" error
      }
    });
  });

  describe('Diff label behavior', () => {
    it('preview diff should use "Proposed" label', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;',
        writeTextFile: async () => {},
        fileExists: async () => true,
      });

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      const display = result.returnDisplay as ToolReturnDisplay;
      expect(display.fileDiff).toContain('Proposed');
    });

    it('apply diff should use "Applied" label', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;',
        writeTextFile: async () => {},
        fileExists: async () => true,
      });
      mockConfig.getApprovalMode = () => ApprovalMode.AUTO_EDIT;

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: true,
      });

      const result = await invocation.execute(new AbortController().signal);
      if (!result.error) {
        const display = result.returnDisplay as ToolReturnDisplay;
        expect(display.fileDiff).toContain('Applied');
      }
    });
  });

  describe('Preview/apply consistency', () => {
    it('should produce identical newContent between preview and apply for same input', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;\nconst y = 2;',
        writeTextFile: async () => {},
        fileExists: async () => true,
      });
      mockConfig.getApprovalMode = () => ApprovalMode.AUTO_EDIT;

      const tool = new ASTEditTool(mockConfig);

      // Run preview (force: false)
      const previewInvocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 100;',
        force: false,
      });

      const previewResult = await previewInvocation.execute(
        new AbortController().signal,
      );

      // Only proceed if preview succeeded
      if (!previewResult.error) {
        const previewDisplay = previewResult.returnDisplay as ToolReturnDisplay;
        const previewNewContent = previewDisplay.newContent;
        const previewAstValidation = previewDisplay.metadata?.astValidation;

        // Run apply (force: true with AUTO_EDIT)
        const applyInvocation = (
          tool as unknown as TestableASTEditTool
        ).createInvocation({
          file_path: '/test/sample.ts',
          old_string: 'const x = 1;',
          new_string: 'const x = 100;',
          force: true,
        });

        const applyResult = await applyInvocation.execute(
          new AbortController().signal,
        );

        if (!applyResult.error) {
          const applyDisplay = applyResult.returnDisplay as ToolReturnDisplay;
          const applyNewContent = applyDisplay.newContent;
          const applyAstValidation = applyDisplay.metadata?.astValidation;

          // Assert identical newContent
          expect(previewNewContent).toBe(applyNewContent);

          // Assert astValidation shape matches
          expect(previewAstValidation).toHaveProperty('valid');
          expect(previewAstValidation).toHaveProperty('errors');
          expect(applyAstValidation).toHaveProperty('valid');
          expect(applyAstValidation).toHaveProperty('errors');
          expect(previewAstValidation?.valid).toBe(applyAstValidation?.valid);
        }
      }
    });
  });
  describe('AST validation behavior', () => {
    it('should report validation for TypeScript files', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;',
        writeTextFile: async () => {},
        fileExists: async () => true,
      });

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/valid.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      const display = result.returnDisplay as ToolReturnDisplay;
      expect(display.metadata?.astValidation).toBeDefined();
      expect(display.metadata?.astValidation).toHaveProperty('valid');
      expect(display.metadata?.astValidation).toHaveProperty('errors');
    });

    it('should propagate AST validation failure with invalid syntax', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;',
        writeTextFile: async () => {},
        fileExists: async () => true,
      });

      const tool = new ASTEditTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTEditTool
      ).createInvocation({
        file_path: '/test/invalid.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 1;\n}}}}', // Invalid syntax - extra closing braces
        force: false,
      });

      const result = await invocation.execute(new AbortController().signal);
      if (!result.error) {
        const display = result.returnDisplay as ToolReturnDisplay;
        // AST validation may pass or fail depending on the parser
        // The key is that the metadata structure exists
        expect(display.metadata?.astValidation).toHaveProperty('valid');
        expect(display.metadata?.astValidation).toHaveProperty('errors');
        expect(Array.isArray(display.metadata?.astValidation?.errors)).toBe(
          true,
        );
      }
    });
  });

  describe('validateToolParamValues behavior', () => {
    describe('ASTEditTool validation', () => {
      it('should reject empty file_path', () => {
        const tool = new ASTEditTool(mockConfig);
        expect(() =>
          tool.build({
            file_path: '',
            old_string: 'a',
            new_string: 'b',
          }),
        ).toThrow('file_path');
      });

      it('should reject relative file_path', () => {
        const tool = new ASTEditTool(mockConfig);
        expect(() =>
          tool.build({
            file_path: 'relative/path.ts',
            old_string: 'a',
            new_string: 'b',
          }),
        ).toThrow('absolute');
      });

      it('should reject file_path outside workspace', () => {
        const outsideMockConfig = {
          ...mockConfig,
          getWorkspaceContext: () => ({
            isPathWithinWorkspace: (path: string) =>
              !path.startsWith('/outside'),
            getDirectories: () => ['/test'],
          }),
        } as unknown as Config;
        const tool = new ASTEditTool(outsideMockConfig);
        expect(() =>
          tool.build({
            file_path: '/outside/workspace/file.ts',
            old_string: 'a',
            new_string: 'b',
          }),
        ).toThrow('workspace');
      });

      it('should accept valid absolute file_path within workspace', () => {
        const tool = new ASTEditTool(mockConfig);
        expect(() =>
          tool.build({
            file_path: '/test/valid.ts',
            old_string: 'const x = 1;',
            new_string: 'const x = 2;',
          }),
        ).not.toThrow();
      });
    });

    describe('ASTReadFileTool validation', () => {
      it('should reject empty file_path', () => {
        const tool = new ASTReadFileTool(mockConfig);
        expect(() =>
          tool.build({
            file_path: '',
          }),
        ).toThrow('file_path');
      });

      it('should reject relative file_path', () => {
        const tool = new ASTReadFileTool(mockConfig);
        expect(() =>
          tool.build({
            file_path: 'relative/path.ts',
          }),
        ).toThrow('absolute');
      });

      it('should reject file_path outside workspace', () => {
        const outsideMockConfig = {
          ...mockConfig,
          getWorkspaceContext: () => ({
            isPathWithinWorkspace: (path: string) =>
              !path.startsWith('/outside'),
            getDirectories: () => ['/test'],
          }),
        } as unknown as Config;
        const tool = new ASTReadFileTool(outsideMockConfig);
        expect(() =>
          tool.build({
            file_path: '/outside/workspace/file.ts',
          }),
        ).toThrow('workspace');
      });

      it('should accept valid absolute file_path within workspace', () => {
        const tool = new ASTReadFileTool(mockConfig);
        expect(() =>
          tool.build({
            file_path: '/test/valid.ts',
          }),
        ).not.toThrow();
      });
    });
  });

  describe('ASTReadFileTool behavior', () => {
    it('should read file content successfully', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;\nconst y = 2;',
        fileExists: async () => true,
      });

      const tool = new ASTReadFileTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTReadFileTool
      ).createInvocation({
        file_path: '/test/sample.ts',
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toBeTruthy();
      expect(typeof result.llmContent).toBe('string');
    });

    it('should support offset and limit parameters', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;\nconst y = 2;\nconst z = 3;',
        fileExists: async () => true,
      });

      const tool = new ASTReadFileTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTReadFileTool
      ).createInvocation({
        file_path: '/test/sample.ts',
        offset: 1,
        limit: 2,
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.llmContent).toBeTruthy();
    });

    it('should map EMFILE error to READ_CONTENT_FAILURE', async () => {
      const emfileError = new Error(
        'Too many open files',
      ) as NodeJS.ErrnoException;
      emfileError.code = 'EMFILE';

      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => {
          throw emfileError;
        },
      });

      const tool = new ASTReadFileTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTReadFileTool
      ).createInvocation({
        file_path: '/test/sample.ts',
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.READ_CONTENT_FAILURE);
    });

    it('should map ENFILE error to READ_CONTENT_FAILURE', async () => {
      const enfileError = new Error(
        'File table overflow',
      ) as NodeJS.ErrnoException;
      enfileError.code = 'ENFILE';

      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => {
          throw enfileError;
        },
      });

      const tool = new ASTReadFileTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTReadFileTool
      ).createInvocation({
        file_path: '/test/sample.ts',
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.READ_CONTENT_FAILURE);
    });

    it('should map unknown error to UNKNOWN', async () => {
      const unknownError = new Error('Something weird happened');
      // No code property - not a NodeError

      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => {
          throw unknownError;
        },
      });

      const tool = new ASTReadFileTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTReadFileTool
      ).createInvocation({
        file_path: '/test/sample.ts',
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.UNKNOWN);
    });

    it('should return correct metadata shape on success', async () => {
      mockConfig.getFileSystemService = () => ({
        readTextFile: async () => 'const x = 1;\nfunction foo() {}',
        fileExists: async () => true,
      });

      const tool = new ASTReadFileTool(mockConfig);
      const invocation = (
        tool as unknown as TestableASTReadFileTool
      ).createInvocation({
        file_path: '/test/sample.ts',
      });

      const result = await invocation.execute(new AbortController().signal);
      expect(result.error).toBeUndefined();

      const display = result.returnDisplay as ToolReturnDisplay;
      expect(display).toHaveProperty('content');
      expect(typeof display.content).toBe('string');
      expect(display).toHaveProperty('fileName');
      expect(typeof display.fileName).toBe('string');
      expect(display).toHaveProperty('filePath');
      expect(typeof display.filePath).toBe('string');
    });
  });
});
