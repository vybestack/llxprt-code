/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import {
  MemoryTool,
  setLlxprtMdFilename,
  getCurrentLlxprtMdFilename,
  getAllLlxprtMdFilenames,
  DEFAULT_CONTEXT_FILENAME,
} from './memoryTool.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ToolConfirmationOutcome } from './tools.js';
import { ToolErrorType } from './tool-error.js';

// Mock dependencies
vi.mock(import('fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    mkdir: vi.fn(),
    readFile: vi.fn(),
  };
});

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
}));

vi.mock('os');

const MEMORY_SECTION_HEADER = '## LLxprt Code Added Memories';

// Define a type for our fsAdapter to ensure consistency
interface FsAdapter {
  readFile: (path: string, encoding: 'utf-8') => Promise<string>;
  writeFile: (path: string, data: string, encoding: 'utf-8') => Promise<void>;
  mkdir: (
    path: string,
    options: { recursive: boolean },
  ) => Promise<string | undefined>;
}

describe('MemoryTool', () => {
  const mockAbortSignal = new AbortController().signal;
  const mockWorkingDir = '/mock/project';

  const mockFsAdapter: {
    readFile: Mock<FsAdapter['readFile']>;
    writeFile: Mock<FsAdapter['writeFile']>;
    mkdir: Mock<FsAdapter['mkdir']>;
  } = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue(path.join('/mock', 'home'));
    mockFsAdapter.readFile.mockReset();
    mockFsAdapter.writeFile.mockReset().mockResolvedValue(undefined);
    mockFsAdapter.mkdir
      .mockReset()
      .mockResolvedValue(undefined as string | undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset GEMINI_MD_FILENAME to its original value after each test
    setLlxprtMdFilename(DEFAULT_CONTEXT_FILENAME);
  });

  describe('setLlxprtMdFilename', () => {
    it('should update currentLlxprtMdFilename when a valid new name is provided', () => {
      const newName = 'CUSTOM_CONTEXT.md';
      setLlxprtMdFilename(newName);
      expect(getCurrentLlxprtMdFilename()).toBe(newName);
    });

    it('should not update currentLlxprtMdFilename if the new name is empty or whitespace', () => {
      const initialName = getCurrentLlxprtMdFilename(); // Get current before trying to change
      setLlxprtMdFilename('  ');
      expect(getCurrentLlxprtMdFilename()).toBe(initialName);

      setLlxprtMdFilename('');
      expect(getCurrentLlxprtMdFilename()).toBe(initialName);
    });

    it('should handle an array of filenames', () => {
      const newNames = ['CUSTOM_CONTEXT.md', 'ANOTHER_CONTEXT.md'];
      setLlxprtMdFilename(newNames);
      expect(getCurrentLlxprtMdFilename()).toBe('CUSTOM_CONTEXT.md');
      expect(getAllLlxprtMdFilenames()).toEqual(newNames);
    });
  });

  describe('performAddMemoryEntry (static method)', () => {
    let testFilePath: string;

    beforeEach(() => {
      testFilePath = path.join(
        os.homedir(),
        '.llxprt',
        DEFAULT_CONTEXT_FILENAME,
      );
    });

    it('should create section and save a fact if file does not exist', async () => {
      mockFsAdapter.readFile.mockRejectedValue({ code: 'ENOENT' }); // Simulate file not found
      const fact = 'The sky is blue';
      await MemoryTool.performAddMemoryEntry(fact, testFilePath, mockFsAdapter);

      expect(mockFsAdapter.mkdir).toHaveBeenCalledWith(
        path.dirname(testFilePath),
        {
          recursive: true,
        },
      );
      expect(mockFsAdapter.writeFile).toHaveBeenCalledOnce();
      const writeFileCall = mockFsAdapter.writeFile.mock.calls[0];
      expect(writeFileCall[0]).toBe(testFilePath);
      const expectedContent = `${MEMORY_SECTION_HEADER}\n- ${fact}\n`;
      expect(writeFileCall[1]).toBe(expectedContent);
      expect(writeFileCall[2]).toBe('utf-8');
    });

    it('should create section and save a fact if file is empty', async () => {
      mockFsAdapter.readFile.mockResolvedValue(''); // Simulate empty file
      const fact = 'The sky is blue';
      await MemoryTool.performAddMemoryEntry(fact, testFilePath, mockFsAdapter);
      const writeFileCall = mockFsAdapter.writeFile.mock.calls[0];
      const expectedContent = `${MEMORY_SECTION_HEADER}\n- ${fact}\n`;
      expect(writeFileCall[1]).toBe(expectedContent);
    });

    it('should add a fact to an existing section', async () => {
      const initialContent = `Some preamble.\n\n${MEMORY_SECTION_HEADER}\n- Existing fact 1\n`;
      mockFsAdapter.readFile.mockResolvedValue(initialContent);
      const fact = 'New fact 2';
      await MemoryTool.performAddMemoryEntry(fact, testFilePath, mockFsAdapter);

      expect(mockFsAdapter.writeFile).toHaveBeenCalledOnce();
      const writeFileCall = mockFsAdapter.writeFile.mock.calls[0];
      const expectedContent = `Some preamble.\n\n${MEMORY_SECTION_HEADER}\n- Existing fact 1\n- ${fact}\n`;
      expect(writeFileCall[1]).toBe(expectedContent);
    });

    it('should add a fact to an existing empty section', async () => {
      const initialContent = `Some preamble.\n\n${MEMORY_SECTION_HEADER}\n`; // Empty section
      mockFsAdapter.readFile.mockResolvedValue(initialContent);
      const fact = 'First fact in section';
      await MemoryTool.performAddMemoryEntry(fact, testFilePath, mockFsAdapter);

      expect(mockFsAdapter.writeFile).toHaveBeenCalledOnce();
      const writeFileCall = mockFsAdapter.writeFile.mock.calls[0];
      const expectedContent = `Some preamble.\n\n${MEMORY_SECTION_HEADER}\n- ${fact}\n`;
      expect(writeFileCall[1]).toBe(expectedContent);
    });

    it('should add a fact when other ## sections exist and preserve spacing', async () => {
      const initialContent = `${MEMORY_SECTION_HEADER}\n- Fact 1\n\n## Another Section\nSome other text.`;
      mockFsAdapter.readFile.mockResolvedValue(initialContent);
      const fact = 'Fact 2';
      await MemoryTool.performAddMemoryEntry(fact, testFilePath, mockFsAdapter);

      expect(mockFsAdapter.writeFile).toHaveBeenCalledOnce();
      const writeFileCall = mockFsAdapter.writeFile.mock.calls[0];
      // Note: The implementation ensures a single newline at the end if content exists.
      const expectedContent = `${MEMORY_SECTION_HEADER}\n- Fact 1\n- ${fact}\n\n## Another Section\nSome other text.\n`;
      expect(writeFileCall[1]).toBe(expectedContent);
    });

    it('should correctly trim and add a fact that starts with a dash', async () => {
      mockFsAdapter.readFile.mockResolvedValue(`${MEMORY_SECTION_HEADER}\n`);
      const fact = '- - My fact with dashes';
      await MemoryTool.performAddMemoryEntry(fact, testFilePath, mockFsAdapter);
      const writeFileCall = mockFsAdapter.writeFile.mock.calls[0];
      const expectedContent = `${MEMORY_SECTION_HEADER}\n- My fact with dashes\n`;
      expect(writeFileCall[1]).toBe(expectedContent);
    });

    it('should handle error from fsAdapter.writeFile', async () => {
      mockFsAdapter.readFile.mockResolvedValue('');
      mockFsAdapter.writeFile.mockRejectedValue(new Error('Disk full'));
      const fact = 'This will fail';
      await expect(
        MemoryTool.performAddMemoryEntry(fact, testFilePath, mockFsAdapter),
      ).rejects.toThrow('[MemoryTool] Failed to add memory entry: Disk full');
    });
  });

  describe('execute (instance method)', () => {
    let memoryTool: MemoryTool;
    let performAddMemoryEntrySpy: Mock<typeof MemoryTool.performAddMemoryEntry>;

    beforeEach(() => {
      memoryTool = new MemoryTool();
      // Spy on the static method for these tests
      performAddMemoryEntrySpy = vi
        .spyOn(MemoryTool, 'performAddMemoryEntry')
        .mockResolvedValue(undefined) as Mock<
        typeof MemoryTool.performAddMemoryEntry
      >;
      // Cast needed as spyOn returns MockInstance
    });

    it('should have correct name, displayName, description, and schema', () => {
      expect(memoryTool.name).toBe('save_memory');
      expect(memoryTool.displayName).toBe('SaveMemory');
      expect(memoryTool.description).toContain(
        'Saves a specific piece of information',
      );
      expect(memoryTool.schema).toBeDefined();
      expect(memoryTool.schema.name).toBe('save_memory');
      expect(memoryTool.schema.parametersJsonSchema).toStrictEqual({
        type: 'object',
        properties: {
          fact: {
            type: 'string',
            description:
              'The specific fact or piece of information to remember. Should be a clear, self-contained statement.',
          },
          scope: {
            type: 'string',
            enum: ['global', 'project'],
            description:
              'Where to save the memory: "global" or "project" (default, saves to project-local .llxprt directory)',
            default: 'project',
          },
        },
        required: ['fact'],
      });
    });

    it('should call performAddMemoryEntry with correct parameters and return success', async () => {
      const params = { fact: 'The sky is blue' };
      const invocation = memoryTool.build(params);
      // Without working directory, it should default to global
      const result = await invocation.execute(mockAbortSignal);
      const expectedGlobalPath = path.join(
        os.homedir(),
        '.llxprt',
        getCurrentLlxprtMdFilename(),
      );

      // For this test, we expect the actual fs methods to be passed
      const expectedFsArgument = {
        readFile: fs.readFile,
        writeFile: fs.writeFile,
        mkdir: fs.mkdir,
      };

      expect(performAddMemoryEntrySpy).toHaveBeenCalledWith(
        params.fact,
        expectedGlobalPath,
        expectedFsArgument,
      );
      const successMessage = `Okay, I've remembered that: "${params.fact}"`;
      expect(result.llmContent).toBe(
        JSON.stringify({ success: true, message: successMessage }),
      );
      expect(result.returnDisplay).toBe(successMessage);
    });

    it('should return an error if fact is empty', async () => {
      const params = { fact: ' ' }; // Empty fact
      expect(memoryTool.validateToolParams(params)).toBe(
        'Parameter "fact" must be a non-empty string.',
      );
      expect(() => memoryTool.build(params)).toThrow(
        'Parameter "fact" must be a non-empty string.',
      );
    });

    it('should handle errors from performAddMemoryEntry', async () => {
      const params = { fact: 'This will fail' };
      const underlyingError = new Error(
        '[MemoryTool] Failed to add memory entry: Disk full',
      );
      performAddMemoryEntrySpy.mockRejectedValue(underlyingError);

      const invocation = memoryTool.build(params);
      const result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toBe(
        JSON.stringify({
          success: false,
          error: `Failed to save memory. Detail: ${underlyingError.message}`,
        }),
      );
      expect(result.returnDisplay).toBe(
        `Error saving memory: ${underlyingError.message}`,
      );
      expect(result.error?.type).toBe(
        ToolErrorType.MEMORY_TOOL_EXECUTION_ERROR,
      );
    });
  });

  describe('shouldConfirmExecute', () => {
    let memoryTool: MemoryTool;

    beforeEach(() => {
      memoryTool = new MemoryTool();
      // Clear the allowlist before each test
      const invocation = memoryTool.build({ fact: 'mock-fact' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (invocation.constructor as any).allowlist.clear();
      // Mock fs.readFile to return empty string (file doesn't exist)
      vi.mocked(fs.readFile).mockResolvedValue('');
    });

    it('should return confirmation details when memory file is not allowlisted', async () => {
      const params = { fact: 'Test fact' };
      const invocation = memoryTool.build(params);
      const result = await invocation.shouldConfirmExecute(mockAbortSignal);

      expect(result).toBeDefined();
      expect(result).not.toBe(false);

      // Verify result is an edit confirmation
      expect(result).not.toBe(false);
      if (result === false) {
        throw new Error('Expected result to be a confirmation, not false');
      }

      // Assert type and cast to non-false value
      type EditConfirmation = Exclude<typeof result, false>;
      const editResult = result as EditConfirmation;
      expect(editResult.type).toBe('edit');

      const expectedPath = path.join('~', '.llxprt', 'LLXPRT.md');
      expect(editResult.title).toBe(`Confirm Memory Save: ${expectedPath}`);
      expect(editResult.fileName).toContain(
        path.join('mock', 'home', '.llxprt'),
      );
      expect(editResult.fileName).toContain('LLXPRT.md');
      expect(editResult.fileDiff).toContain('Index: LLXPRT.md');
      expect(editResult.fileDiff).toContain('+## LLxprt Code Added Memories');
      expect(editResult.fileDiff).toContain('+- Test fact');
      expect(editResult.originalContent).toBe('');
      expect(editResult.newContent).toContain('## LLxprt Code Added Memories');
      expect(editResult.newContent).toContain('- Test fact');
    });

    it('should return false when memory file is already allowlisted', async () => {
      const params = { fact: 'Test fact' };
      const memoryFilePath = path.join(
        os.homedir(),
        '.llxprt',
        getCurrentLlxprtMdFilename(),
      );

      const invocation = memoryTool.build(params);
      // Add the memory file to the allowlist
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (invocation.constructor as any).allowlist.add(memoryFilePath);

      const result = await invocation.shouldConfirmExecute(mockAbortSignal);

      expect(result).toBe(false);
    });

    it('should add memory file to allowlist when ProceedAlways is confirmed', async () => {
      const params = { fact: 'Test fact' };
      const memoryFilePath = path.join(
        os.homedir(),
        '.llxprt',
        getCurrentLlxprtMdFilename(),
      );

      const invocation = memoryTool.build(params);
      const result = await invocation.shouldConfirmExecute(mockAbortSignal);

      expect(result).toBeDefined();
      expect(result).not.toBe(false);

      // Verify result is an edit confirmation
      if (result === false) {
        throw new Error('Expected result to be a confirmation, not false');
      }

      type EditResult = Exclude<typeof result, false>;
      const editResult = result as EditResult;
      expect(editResult.type).toBe('edit');

      // Simulate the onConfirm callback
      await editResult.onConfirm(ToolConfirmationOutcome.ProceedAlways);

      // Check that the memory file was added to the allowlist
      expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (invocation.constructor as any).allowlist.has(memoryFilePath),
      ).toBe(true);
    });

    it('should not add memory file to allowlist when other outcomes are confirmed', async () => {
      const params = { fact: 'Test fact' };
      const memoryFilePath = path.join(
        os.homedir(),
        '.llxprt',
        getCurrentLlxprtMdFilename(),
      );

      const invocation = memoryTool.build(params);
      const result = await invocation.shouldConfirmExecute(mockAbortSignal);

      expect(result).toBeDefined();
      expect(result).not.toBe(false);

      // Verify result is an edit confirmation
      if (result === false) {
        throw new Error('Expected result to be a confirmation, not false');
      }

      type EditResult2 = Exclude<typeof result, false>;
      const editResult = result as EditResult2;
      expect(editResult.type).toBe('edit');

      // Simulate the onConfirm callback with different outcomes
      await editResult.onConfirm(ToolConfirmationOutcome.ProceedOnce);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allowlist = (invocation.constructor as any).allowlist;
      expect(allowlist.has(memoryFilePath)).toBe(false);

      await editResult.onConfirm(ToolConfirmationOutcome.Cancel);
      expect(allowlist.has(memoryFilePath)).toBe(false);
    });

    it('should handle existing memory file with content', async () => {
      const params = { fact: 'New fact' };
      const existingContent =
        'Some existing content.\n\n## LLxprt Code Added Memories\n- Old fact\n';

      // Mock fs.readFile to return existing content
      vi.mocked(fs.readFile).mockResolvedValue(existingContent);

      const invocation = memoryTool.build(params);
      const result = await invocation.shouldConfirmExecute(mockAbortSignal);

      expect(result).toBeDefined();
      expect(result).not.toBe(false);

      // Verify result is an edit confirmation
      if (result === false) {
        throw new Error('Expected result to be a confirmation, not false');
      }

      type EditResult3 = Exclude<typeof result, false>;
      const editResult = result as EditResult3;
      expect(editResult.type).toBe('edit');

      const expectedPath = path.join('~', '.llxprt', 'LLXPRT.md');
      expect(editResult.title).toBe(`Confirm Memory Save: ${expectedPath}`);
      expect(editResult.fileDiff).toContain('Index: LLXPRT.md');
      expect(editResult.fileDiff).toContain('+- New fact');
      expect(editResult.originalContent).toBe(existingContent);
      expect(editResult.newContent).toContain('- Old fact');
      expect(editResult.newContent).toContain('- New fact');
    });
  });

  describe('Project-level memory (scope parameter)', () => {
    let memoryTool: MemoryTool;

    beforeEach(() => {
      memoryTool = new MemoryTool();
    });

    it('should accept scope parameter in tool schema', () => {
      const schema = memoryTool.schema;
      expect(schema.parametersJsonSchema).toHaveProperty('properties.scope');
      const scopeProperty = (
        schema.parametersJsonSchema as {
          properties: { scope: unknown };
        }
      ).properties.scope;
      expect(scopeProperty).toEqual({
        type: 'string',
        enum: ['global', 'project'],
        description: expect.stringContaining('Where to save'),
        default: 'project',
      });
    });

    it('should save to project directory when scope is "project"', async () => {
      const performAddMemoryEntrySpy = vi
        .spyOn(MemoryTool, 'performAddMemoryEntry')
        .mockResolvedValue(undefined) as Mock<
        typeof MemoryTool.performAddMemoryEntry
      >;

      const params = {
        fact: 'Project-specific fact',
        scope: 'project' as const,
      };
      const invocation = memoryTool.build(params);

      // Mock the working directory
      invocation.setWorkingDir(mockWorkingDir);

      await invocation.execute(mockAbortSignal);

      const expectedProjectPath = path.join(
        mockWorkingDir,
        '.llxprt',
        getCurrentLlxprtMdFilename(),
      );

      expect(performAddMemoryEntrySpy).toHaveBeenCalledWith(
        params.fact,
        expectedProjectPath,
        expect.anything(),
      );

      performAddMemoryEntrySpy.mockRestore();
    });

    it('should save to project directory by default (when scope is undefined and workingDir is set)', async () => {
      const performAddMemoryEntrySpy = vi
        .spyOn(MemoryTool, 'performAddMemoryEntry')
        .mockResolvedValue(undefined) as Mock<
        typeof MemoryTool.performAddMemoryEntry
      >;

      const params = { fact: 'Project fact by default' };
      const invocation = memoryTool.build(params);
      invocation.setWorkingDir(mockWorkingDir);

      await invocation.execute(mockAbortSignal);

      const expectedProjectPath = path.join(
        mockWorkingDir,
        '.llxprt',
        getCurrentLlxprtMdFilename(),
      );

      expect(performAddMemoryEntrySpy).toHaveBeenCalledWith(
        params.fact,
        expectedProjectPath,
        expect.anything(),
      );

      performAddMemoryEntrySpy.mockRestore();
    });

    it('should save to global directory when scope is explicitly "global"', async () => {
      const performAddMemoryEntrySpy = vi
        .spyOn(MemoryTool, 'performAddMemoryEntry')
        .mockResolvedValue(undefined) as Mock<
        typeof MemoryTool.performAddMemoryEntry
      >;

      const params = { fact: 'Global fact', scope: 'global' as const };
      const invocation = memoryTool.build(params);

      await invocation.execute(mockAbortSignal);

      const expectedGlobalPath = path.join(
        os.homedir(),
        '.llxprt',
        getCurrentLlxprtMdFilename(),
      );

      expect(performAddMemoryEntrySpy).toHaveBeenCalledWith(
        params.fact,
        expectedGlobalPath,
        expect.anything(),
      );

      performAddMemoryEntrySpy.mockRestore();
    });

    it('should fallback to global when scope is "project" but no working directory is set', async () => {
      const performAddMemoryEntrySpy = vi
        .spyOn(MemoryTool, 'performAddMemoryEntry')
        .mockResolvedValue(undefined) as Mock<
        typeof MemoryTool.performAddMemoryEntry
      >;

      const params = { fact: 'Project fact without workdir', scope: 'project' };
      const invocation = memoryTool.build(params);

      await invocation.execute(mockAbortSignal);

      const expectedGlobalPath = path.join(
        os.homedir(),
        '.llxprt',
        getCurrentLlxprtMdFilename(),
      );

      expect(performAddMemoryEntrySpy).toHaveBeenCalledWith(
        params.fact,
        expectedGlobalPath,
        expect.anything(),
      );

      performAddMemoryEntrySpy.mockRestore();
    });

    it('should show correct file path in confirmation for project scope', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('');

      const params = { fact: 'Test fact', scope: 'project' };
      const invocation = memoryTool.build(params);
      invocation.setWorkingDir(mockWorkingDir);

      const result = await invocation.shouldConfirmExecute(mockAbortSignal);

      expect(result).not.toBe(false);
      if (result === false) {
        throw new Error('Expected confirmation details');
      }

      // Normalize paths for cross-platform compatibility (Windows uses backslashes)
      const normalizedTitle = result.title.replace(/\\/g, '/');
      const normalizedFileName = result.fileName.replace(/\\/g, '/');
      expect(normalizedTitle).toContain('.llxprt/LLXPRT.md');
      expect(normalizedFileName).toContain(mockWorkingDir);
      expect(normalizedFileName).toContain('.llxprt');
    });
  });
});
