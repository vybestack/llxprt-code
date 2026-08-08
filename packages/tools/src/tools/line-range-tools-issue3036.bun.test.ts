/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3036: range-editor tools treat `content.split('\n')` as "the lines of
 * the file", but a newline-terminated file yields a phantom trailing '' element
 * which is the final newline, not a line. These behavioural tests pin the
 * accepted behaviour (AB1-AB5) with real temp files and byte-exact assertions.
 *
 * @plan issue3036
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApprovalMode, IToolHost } from '../interfaces/index.js';
import { ToolErrorType } from '../types/tool-error.js';
import type {
  ToolCallConfirmationDetails,
  ToolEditConfirmationDetails,
  ToolResult,
} from './tools.js';
import { DeleteLineRangeTool } from './delete_line_range.js';
import { InsertAtLineTool } from './insert_at_line.js';
import { ReadLineRangeTool } from './read_line_range.js';

/**
 * Registers a per-describe temp dir lifecycle and returns a lazy accessor.
 * One line of shared setup per describe block (RULES.md test structure).
 */
function useTempDir(): () => string {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'issue3036-'));
  });
  afterEach(() => {
    if (dir !== '') {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  return () => dir;
}

function createHost(
  targetDir: string,
  approvalMode: ApprovalMode = 'auto',
): IToolHost {
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => approvalMode,
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({}),
    getDebugMode: () => false,
  };
}

interface DeleteParams {
  readonly file_path: string;
  readonly start_line: number;
  readonly end_line: number;
}

interface InsertParams {
  readonly file_path: string;
  readonly line_number: number;
  readonly content: string;
}

interface ReadParams {
  readonly file_path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly showLineNumbers?: boolean;
  readonly showGitChanges?: boolean;
}

async function runDelete(
  targetDir: string,
  params: DeleteParams,
): Promise<ToolResult> {
  return new DeleteLineRangeTool(createHost(targetDir))
    .build(params)
    .execute(new AbortController().signal);
}

async function runInsert(
  targetDir: string,
  params: InsertParams,
): Promise<ToolResult> {
  return new InsertAtLineTool(createHost(targetDir))
    .build(params)
    .execute(new AbortController().signal);
}

async function runRead(
  targetDir: string,
  params: ReadParams,
): Promise<ToolResult> {
  return new ReadLineRangeTool(createHost(targetDir))
    .build(params)
    .execute(new AbortController().signal);
}

async function runDeleteConfirmation(
  targetDir: string,
  params: DeleteParams,
): Promise<ToolCallConfirmationDetails | false> {
  return new DeleteLineRangeTool(createHost(targetDir, 'default'))
    .build(params)
    .shouldConfirmExecute(new AbortController().signal);
}

async function runInsertConfirmation(
  targetDir: string,
  params: InsertParams,
): Promise<ToolCallConfirmationDetails | false> {
  return new InsertAtLineTool(createHost(targetDir, 'default'))
    .build(params)
    .shouldConfirmExecute(new AbortController().signal);
}

function editConfirmation(
  details: ToolCallConfirmationDetails,
): ToolEditConfirmationDetails {
  expect(details.type).toBe('edit');
  if (details.type !== 'edit') {
    throw new Error('expected edit confirmation');
  }
  return details;
}

/**
 * Narrows a ToolResult's llmContent to a string without a type assertion.
 * Throws when the content is non-text so the failure is explicit.
 */
function contentOf(result: ToolResult): string {
  if (typeof result.llmContent !== 'string') {
    throw new Error('expected string llmContent');
  }
  return result.llmContent;
}

const NEWLINE = String.fromCharCode(10);
const HEADER_SEPARATOR = NEWLINE + NEWLINE;

function bodyAfterHeader(content: string): string {
  return content.slice(
    content.indexOf(HEADER_SEPARATOR) + HEADER_SEPARATOR.length,
  );
}

function joinLines(...parts: readonly string[]): string {
  return parts.join(NEWLINE);
}

describe('AB1: delete_line_range preserves trailing-newline state', () => {
  const tempDir = useTempDir();

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly file: string;
    readonly start: number;
    readonly end: number;
    readonly expected: string;
  }> = [
    {
      name: 'newline-terminated delete(3,3) keeps final newline',
      file: 'aaa\nbbb\nccc\n',
      start: 3,
      end: 3,
      expected: 'aaa\nbbb\n',
    },
    {
      name: 'newline-terminated delete(3,999) keeps final newline',
      file: 'aaa\nbbb\nccc\n',
      start: 3,
      end: 999,
      expected: 'aaa\nbbb\n',
    },
    {
      name: 'no-trailing-newline delete(3,3) stays newline-free',
      file: 'aaa\nbbb\nccc',
      start: 3,
      end: 3,
      expected: 'aaa\nbbb',
    },
    {
      name: 'no-trailing-newline delete(3,999) stays newline-free',
      file: 'aaa\nbbb\nccc',
      start: 3,
      end: 999,
      expected: 'aaa\nbbb',
    },
    {
      name: 'delete(1,999) empties the file with no stray newline',
      file: 'aaa\nbbb\nccc\n',
      start: 1,
      end: 999,
      expected: '',
    },
    {
      name: 'delete(2,2) keeps surrounding lines and final newline',
      file: 'aaa\nbbb\nccc\n',
      start: 2,
      end: 2,
      expected: 'aaa\nccc\n',
    },
  ];

  it.each(cases)('$name', async (c: (typeof cases)[number]) => {
    const filePath = join(tempDir(), `ab1-${c.name}.txt`);
    writeFileSync(filePath, c.file, 'utf-8');

    await runDelete(tempDir(), {
      file_path: filePath,
      start_line: c.start,
      end_line: c.end,
    });

    expect(readFileSync(filePath, 'utf-8')).toBe(c.expected);
  });

  it('echoes exactly the real deleted lines with no phantom blank', async () => {
    const filePath = join(tempDir(), 'ab1-echo.txt');
    writeFileSync(filePath, 'aaa\nbbb\nccc\n', 'utf-8');

    // delete(3, 999) exercises the overshoot path where the phantom trailing ''
    // element was previously consumed into the deleted-content echo.
    const result = await runDelete(tempDir(), {
      file_path: filePath,
      start_line: 3,
      end_line: 999,
    });

    expect(result.error).toBeUndefined();
    const content = contentOf(result);
    // The echo is the body after the status header; it must be exactly 'ccc'.
    expect(bodyAfterHeader(content)).toBe('ccc');
  });

  it('reports the effective clamped range, not the raw over-shoot', async () => {
    const filePath = join(tempDir(), 'ab1-clamp.txt');
    writeFileSync(filePath, 'aaa\nbbb\nccc\n', 'utf-8');

    const result = await runDelete(tempDir(), {
      file_path: filePath,
      start_line: 3,
      end_line: 999,
    });

    expect(result.llmContent).toContain('lines 3-3');
    expect(result.llmContent).not.toContain('3-999');
    expect(result.returnDisplay).toContain('Deleted 1 lines (3-3)');
    expect(result.returnDisplay).not.toContain('997');
  });

  it('confirm preview is byte-identical to the bytes execute writes', async () => {
    const filePath = join(tempDir(), 'ab1-confirm.txt');
    const original = 'aaa\nbbb\nccc\n';
    writeFileSync(filePath, original, 'utf-8');

    const confirmation = await runDeleteConfirmation(tempDir(), {
      file_path: filePath,
      start_line: 3,
      end_line: 999,
    });
    expect(confirmation).not.toBe(false);
    if (confirmation === false) return;
    const preview = editConfirmation(confirmation).newContent;

    // Run execute against a fresh copy so the on-disk result is comparable.
    const execPath = join(tempDir(), 'ab1-confirm-exec.txt');
    writeFileSync(execPath, original, 'utf-8');
    await runDelete(tempDir(), {
      file_path: execPath,
      start_line: 3,
      end_line: 999,
    });

    // The preview must equal the correct bytes (with the final newline
    // preserved), and those must be byte-identical to what execute writes.
    expect(preview).toBe('aaa\nbbb\n');
    expect(preview).toBe(readFileSync(execPath, 'utf-8'));
  });
});

describe('AB2: user-facing line counts exclude the phantom line', () => {
  const tempDir = useTempDir();

  it('insert_at_line error reports real length (7) on a 7-line file', async () => {
    const filePath = join(tempDir(), 'ab2-insert.txt');
    writeFileSync(filePath, 'l1\nl2\nl3\nl4\nl5\nl6\nl7\n', 'utf-8');

    const result = await runInsert(tempDir(), {
      file_path: filePath,
      line_number: 999,
      content: 'x\n',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('(7)');
    expect(result.error?.message).toContain('<= 8 to append');
  });

  it('delete_line_range error reports real length (8) on an 8-line file', async () => {
    const filePath = join(tempDir(), 'ab2-delete.txt');
    writeFileSync(filePath, 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n', 'utf-8');

    const result = await runDelete(tempDir(), {
      file_path: filePath,
      start_line: 100,
      end_line: 100,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('(8)');
  });

  it('an empty file has 0 lines: delete(1,1) is out-of-bounds', async () => {
    const filePath = join(tempDir(), 'ab2-empty.txt');
    writeFileSync(filePath, '', 'utf-8');

    const result = await runDelete(tempDir(), {
      file_path: filePath,
      start_line: 1,
      end_line: 1,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
  });

  it("a single '\\n' file has 1 (empty) line: delete(1,1) empties it", async () => {
    const filePath = join(tempDir(), 'ab2-newline.txt');
    writeFileSync(filePath, '\n', 'utf-8');

    const result = await runDelete(tempDir(), {
      file_path: filePath,
      start_line: 1,
      end_line: 1,
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('');
  });

  it("a single '\\n' file reports length 1: delete(2,2) is out-of-bounds", async () => {
    const filePath = join(tempDir(), 'ab2-newline-count.txt');
    writeFileSync(filePath, '\n', 'utf-8');

    const result = await runDelete(tempDir(), {
      file_path: filePath,
      start_line: 2,
      end_line: 2,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.error?.message).toBe('start_line 2 exceeds file length (1)');
  });

  it('insert error.message carries actionable append guidance', async () => {
    const filePath = join(tempDir(), 'ab2-guidance.txt');
    writeFileSync(filePath, 'l1\nl2\nl3\nl4\nl5\nl6\nl7\n', 'utf-8');

    const result = await runInsert(tempDir(), {
      file_path: filePath,
      line_number: 999,
      content: 'x\n',
    });

    expect(result.error?.message).toBe(
      'line_number 999 exceeds file length (7); use line_number <= 8 to append',
    );
  });
});

describe('AB3: insert_at_line append boundary matches the description', () => {
  const tempDir = useTempDir();

  it('appends at line totalLines + 1 byte-exact, preserving the newline', async () => {
    const filePath = join(tempDir(), 'ab3-append.txt');
    writeFileSync(filePath, 'aaa\nbbb\nccc\n', 'utf-8');

    const result = await runInsert(tempDir(), {
      file_path: filePath,
      line_number: 4,
      content: 'ddd\n',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('aaa\nbbb\nccc\nddd\n');
  });

  it('rejects line totalLines + 2 instead of inserting a spurious blank', async () => {
    const filePath = join(tempDir(), 'ab3-reject.txt');
    writeFileSync(filePath, 'aaa\nbbb\nccc\n', 'utf-8');

    const before = readFileSync(filePath, 'utf-8');
    const result = await runInsert(tempDir(), {
      file_path: filePath,
      line_number: 5,
      content: 'ddd\n',
    });

    expect(result.error).toBeDefined();
    // File must be untouched.
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('tool description states the valid range and drops the append promise', () => {
    const tool = new InsertAtLineTool(createHost(tempDir()));
    expect(tool.description).not.toContain('appended to the end of the file');
    expect(tool.description).toContain('totalLines + 1');
  });

  it('the prompt-config mirror matches the tool description', () => {
    const mirrorPath = fileURLToPath(
      new URL(
        '../../../core/src/prompt-config/defaults/tools/insert-at-line.md',
        import.meta.url,
      ),
    );
    const mirror = readFileSync(mirrorPath, 'utf-8');
    expect(mirror).not.toContain('appended to the end of the file');
    expect(mirror).toContain('totalLines + 1');
  });
});

describe('AB4: read_line_range plain status vs genuine line shortening', () => {
  const tempDir = useTempDir();

  it('ordinary partial read shows a plain status, not a truncation banner', async () => {
    const filePath = join(tempDir(), 'ab4-plain.txt');
    writeFileSync(
      filePath,
      'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\nl13\nl14\n',
      'utf-8',
    );

    const result = await runRead(tempDir(), {
      file_path: filePath,
      start_line: 1,
      end_line: 5,
    });
    expect(typeof result.llmContent).toBe('string');
    const content = contentOf(result);

    expect(content).toContain('Status: Showing lines 1-5 of 14 total lines.');
    expect(content).not.toContain('has been truncated');
    expect(content).not.toContain('(truncated)');
    expect(content).not.toContain('Action: To read more');
    // The body after the status header must be exactly the requested bytes.
    expect(bodyAfterHeader(content)).toBe(
      joinLines('l1', 'l2', 'l3', 'l4', 'l5'),
    );
  });

  it('a range whose end exceeds EOF reports the clamped range plainly', async () => {
    const filePath = join(tempDir(), 'ab4-past-eof-range.txt');
    writeFileSync(
      filePath,
      'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\nl13\nl14\n',
      'utf-8',
    );

    const result = await runRead(tempDir(), {
      file_path: filePath,
      start_line: 10,
      end_line: 30,
    });
    expect(typeof result.llmContent).toBe('string');
    const content = contentOf(result);

    expect(content).toContain('Status: Showing lines 10-14 of 14 total lines.');
    expect(content).not.toContain('has been truncated');
    expect(content).not.toContain('Action: To read more');
    // The body must be exactly the clamped bytes.
    expect(bodyAfterHeader(content)).toBe(
      joinLines('l10', 'l11', 'l12', 'l13', 'l14'),
    );
  });

  it('genuine per-line shortening is still flagged explicitly', async () => {
    const filePath = join(tempDir(), 'ab4-shortened.txt');
    const longLine = 'x'.repeat(2100);
    writeFileSync(filePath, `${longLine}\nshort\nl3\nl4\n`, 'utf-8');

    const result = await runRead(tempDir(), {
      file_path: filePath,
      start_line: 1,
      end_line: 1,
    });
    expect(typeof result.llmContent).toBe('string');
    const content = contentOf(result);

    expect(content).toContain('Status: Showing lines 1-1 of 4 total lines.');
    expect(content.toLowerCase()).toContain('shortened');
    // The long line must actually be clipped to the max length and still carry
    // the existing truncation marker.
    expect(bodyAfterHeader(content)).toBe('x'.repeat(2000) + '... [truncated]');
  });

  it('showLineNumbers formatting is preserved in the plain format', async () => {
    const filePath = join(tempDir(), 'ab4-linenumbers.txt');
    writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5\n', 'utf-8');

    const result = await runRead(tempDir(), {
      file_path: filePath,
      start_line: 1,
      end_line: 2,
      showLineNumbers: true,
    });
    expect(typeof result.llmContent).toBe('string');
    const content = contentOf(result);

    expect(content).toContain('| line1');
    expect(content).toContain('Status: Showing lines 1-2 of 5 total lines.');
    expect(content).not.toContain('has been truncated');
  });

  it('showGitChanges legend and marker column are preserved', async () => {
    const filePath = join(tempDir(), 'ab4-gitchanges.txt');
    writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5\n', 'utf-8');

    const result = await runRead(tempDir(), {
      file_path: filePath,
      start_line: 1,
      end_line: 2,
      showGitChanges: true,
    });
    expect(typeof result.llmContent).toBe('string');
    const content = contentOf(result);

    expect(content).toContain('Git changes legend:');
    expect(content).toContain('Status: Showing lines 1-2 of 5 total lines.');
    expect(content).not.toContain('has been truncated');
    // Unchanged lines carry the unchanged marker column.
    expect(content).toContain('░');
  });
});

describe('AB5: reads starting past EOF error instead of an inverted range', () => {
  const tempDir = useTempDir();

  function fourteenLineFile(): string {
    return 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\nl13\nl14\n';
  }

  it('start_line past EOF returns an INVALID_TOOL_PARAMS error', async () => {
    const filePath = join(tempDir(), 'ab5-past-eof.txt');
    writeFileSync(filePath, fourteenLineFile(), 'utf-8');

    const result = await runRead(tempDir(), {
      file_path: filePath,
      start_line: 20,
      end_line: 30,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.error?.message).toBe(
      'start_line 20 is beyond end of file (14 lines)',
    );
    // Never emit the inverted range.
    expect(result.llmContent).not.toContain('Showing lines 15-14');
  });

  it('start_line == totalLines with end_line past EOF still succeeds', async () => {
    const filePath = join(tempDir(), 'ab5-last-line.txt');
    writeFileSync(filePath, fourteenLineFile(), 'utf-8');

    const result = await runRead(tempDir(), {
      file_path: filePath,
      start_line: 14,
      end_line: 30,
    });

    expect(result.error).toBeUndefined();
    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toContain('l14');
  });

  it('a single-line file uses the singular form in the EOF message', async () => {
    const filePath = join(tempDir(), 'ab5-singular.txt');
    writeFileSync(filePath, NEWLINE, 'utf-8');

    const result = await runRead(tempDir(), {
      file_path: filePath,
      start_line: 2,
      end_line: 2,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.error?.message).toBe(
      'start_line 2 is beyond end of file (1 line)',
    );
  });
});

describe('regression: insert_at_line preserves newline state across content/file combinations', () => {
  const tempDir = useTempDir();

  // The file's own trailing-newline state must be preserved regardless of
  // whether the inserted content ends in a newline.
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly fileTrailingNewline: boolean;
    readonly contentTrailingNewline: boolean;
    readonly expectedTrailingNewline: boolean;
  }> = [
    {
      name: 'newline-terminated file keeps its trailing newline (content with newline)',
      fileTrailingNewline: true,
      contentTrailingNewline: true,
      expectedTrailingNewline: true,
    },
    {
      name: 'newline-terminated file keeps its trailing newline (content without newline)',
      fileTrailingNewline: true,
      contentTrailingNewline: false,
      expectedTrailingNewline: true,
    },
    {
      name: 'newline-free file stays newline-free (content with newline)',
      fileTrailingNewline: false,
      contentTrailingNewline: true,
      expectedTrailingNewline: false,
    },
    {
      name: 'newline-free file stays newline-free (content without newline)',
      fileTrailingNewline: false,
      contentTrailingNewline: false,
      expectedTrailingNewline: false,
    },
  ];

  it.each(cases)('$name', async (c: (typeof cases)[number]) => {
    const filePath = join(tempDir(), `regress-newline-${c.name}.txt`);
    const fileContent =
      joinLines('aaa', 'bbb', 'ccc') + (c.fileTrailingNewline ? NEWLINE : '');
    writeFileSync(filePath, fileContent, 'utf-8');

    const insertContent = 'xxx' + (c.contentTrailingNewline ? NEWLINE : '');
    const result = await runInsert(tempDir(), {
      file_path: filePath,
      line_number: 2,
      content: insertContent,
    });

    expect(result.error).toBeUndefined();
    const expected =
      joinLines('aaa', 'xxx', 'bbb', 'ccc') +
      (c.expectedTrailingNewline ? NEWLINE : '');
    expect(readFileSync(filePath, 'utf-8')).toBe(expected);
  });

  it('appends at totalLines + 1 to a file with no final newline', async () => {
    const filePath = join(tempDir(), 'regress-append-no-newline.txt');
    writeFileSync(filePath, joinLines('aaa', 'bbb', 'ccc'), 'utf-8');

    const result = await runInsert(tempDir(), {
      file_path: filePath,
      line_number: 4,
      content: 'ddd' + NEWLINE,
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe(
      joinLines('aaa', 'bbb', 'ccc', 'ddd'),
    );
  });
});

describe('regression: insert_at_line newline-terminates a zero-line file', () => {
  const tempDir = useTempDir();

  it('creating a non-existent file with content "foo\\n" writes exactly "foo\\n"', async () => {
    const filePath = join(tempDir(), 'ab6-new-trailing.txt');

    const result = await runInsert(tempDir(), {
      file_path: filePath,
      line_number: 1,
      content: 'foo\n',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('foo\n');
  });

  it('creating a non-existent file with content "foo" writes exactly "foo\\n"', async () => {
    const filePath = join(tempDir(), 'ab6-new-notrailing.txt');

    const result = await runInsert(tempDir(), {
      file_path: filePath,
      line_number: 1,
      content: 'foo',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('foo\n');
  });

  it('inserting at line 1 of an existing 0-byte file writes exactly "foo\\n"', async () => {
    const filePath = join(tempDir(), 'ab6-empty.txt');
    writeFileSync(filePath, '', 'utf-8');

    const result = await runInsert(tempDir(), {
      file_path: filePath,
      line_number: 1,
      content: 'foo\n',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('foo\n');
  });

  it('confirm preview equals the bytes execute writes for the create-a-new-file case', async () => {
    const previewPath = join(tempDir(), 'ab6-confirm-preview.txt');
    const execPath = join(tempDir(), 'ab6-confirm-exec.txt');

    const confirmation = await runInsertConfirmation(tempDir(), {
      file_path: previewPath,
      line_number: 1,
      content: 'foo\n',
    });
    expect(confirmation).not.toBe(false);
    if (confirmation === false) return;
    const preview = editConfirmation(confirmation).newContent;

    // Run execute against a fresh path so the on-disk result is comparable.
    await runInsert(tempDir(), {
      file_path: execPath,
      line_number: 1,
      content: 'foo\n',
    });

    // The preview must be newline-terminated and byte-identical to execute.
    expect(preview).toBe('foo\n');
    expect(preview).toBe(readFileSync(execPath, 'utf-8'));
  });
});
