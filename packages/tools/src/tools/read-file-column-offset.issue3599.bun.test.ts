/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3599: a single text line longer than 2000 characters was clipped with
 * no way to read the remainder, and the truncation note pointed at a next
 * *line* that did not exist. These behavioural tests drive the real tools
 * against real temp files and follow the tool's own recommended calls.
 *
 * Character units are UTF-16 code units (JavaScript string indices), the same
 * unit the existing 2000-character clipping uses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IToolHost } from '../interfaces/index.js';
import { physicalFiles } from '../__tests__/helpers/physical-files.js';
import { processSingleFileContent } from '../utils/fileUtils.js';
import { ReadFileTool, type ReadFileToolParams } from './read-file.js';
import { ReadLineRangeTool } from './read_line_range.js';

const CLIP_MARKER = '... [truncated]';
const CONTENT_MARKER = '--- FILE CONTENT (truncated) ---\n';
const LINE_CAP = 2000;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function createHost(targetDir: string): IToolHost {
  return {
    ...physicalFiles,
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    runSearch: (_directories, operation) => operation(),
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
    readExecutionPolicy: () => ({}),
    getDebugMode: () => false,
  };
}

function isReadFileCall(value: unknown): value is ReadFileToolParams {
  return (
    typeof value === 'object' &&
    value !== null &&
    'absolute_path' in value &&
    typeof value.absolute_path === 'string'
  );
}

/** Every `read_file {json}` continuation the tool recommended, in order. */
function recommendedCalls(output: string): ReadFileToolParams[] {
  const calls: ReadFileToolParams[] = [];
  for (const match of output.matchAll(/read_file (\{[^\n]*\})/g)) {
    const parsed: unknown = JSON.parse(match[1]);
    if (!isReadFileCall(parsed)) {
      throw new Error(`Recommended call is not a read_file call: ${match[1]}`);
    }
    calls.push(parsed);
  }
  return calls;
}

/** The file text shown in a tool result, without notes or the clip marker. */
function shownText(output: string): string {
  const text = shownTextWithMarkers(output);
  return text.endsWith(CLIP_MARKER) ? text.slice(0, -CLIP_MARKER.length) : text;
}

/** The file text of a read_line_range result: everything after the header. */
function rangeText(output: string): string {
  const text = output.slice(output.indexOf('\n\n') + 2);
  return text.endsWith(CLIP_MARKER) ? text.slice(0, -CLIP_MARKER.length) : text;
}

/** Each returned line with its trailing clip marker removed. */
function shownLines(output: string): string[] {
  return shownTextWithMarkers(output)
    .split('\n')
    .map((line) =>
      line.endsWith(CLIP_MARKER) ? line.slice(0, -CLIP_MARKER.length) : line,
    );
}

function shownTextWithMarkers(output: string): string {
  const markerAt = output.indexOf(CONTENT_MARKER);
  return markerAt === -1
    ? output
    : output.slice(markerAt + CONTENT_MARKER.length);
}

function git(cwd: string, args: string[]): void {
  execFileSync(
    'git',
    [
      '-c',
      'user.name=issue3599',
      '-c',
      'user.email=issue3599@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, stdio: 'ignore' },
  );
}

async function run(
  tool: ReadFileTool,
  params: ReadFileToolParams,
): Promise<string> {
  const result = await tool.execute(params);
  expect(result.error).toBeUndefined();
  expect(typeof result.llmContent).toBe('string');
  return String(result.llmContent);
}

/** Follows the tool's own single recommended call until it stops recommending. */
async function readAllWindows(
  tool: ReadFileTool,
  first: ReadFileToolParams,
): Promise<string[]> {
  const windows: string[] = [];
  let params: ReadFileToolParams | undefined = first;
  while (params !== undefined) {
    const output = await run(tool, params);
    windows.push(shownText(output));
    const next: Array<ReadFileToolParams | undefined> =
      recommendedCalls(output);
    expect(next.length).toBeLessThanOrEqual(1);
    params = next[0];
    expect(windows.length).toBeLessThan(50);
  }
  return windows;
}

/** Deterministic text where every position differs from its neighbours. */
function patterned(length: number): string {
  let text = '';
  for (let i = 0; text.length < length; i++) {
    text += `<${i}>`;
  }
  return text.slice(0, length);
}

describe('read_file column_offset (issue #3599)', () => {
  function useTempDir(): () => string {
    let dir = '';
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'issue3599-'));
    });
    afterEach(() => {
      if (dir !== '') {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    return () => dir;
  }

  const tempDir = useTempDir();

  function writeFixture(name: string, content: string): string {
    const filePath = join(tempDir(), name);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  describe('a single line longer than the cap', () => {
    it('discloses the cap and recommends a call that retrieves the tail', async () => {
      const json = `{"summary":"${'a'.repeat(3000)}TAIL_SENTINEL"}`;
      const filePath = writeFixture('one.json', `${json}\n`);
      const tool = new ReadFileTool(createHost(tempDir()));

      const first = await run(tool, { absolute_path: filePath });

      expect(first).not.toContain('TAIL_SENTINEL');
      expect(first).not.toMatch(/use offset: \d+/);
      expect(first).toContain(`${LINE_CAP} characters`);
      expect(first).toContain(`${json.length} characters`);
      expect(first).toContain('Line 1');

      const calls = recommendedCalls(first);
      expect(calls).toStrictEqual([
        {
          absolute_path: filePath,
          offset: 0,
          limit: 1,
          column_offset: LINE_CAP,
        },
      ]);

      const tail = await run(tool, calls[0]);
      expect(shownText(tail)).toBe(json.slice(LINE_CAP));
      expect(tail).toContain('TAIL_SENTINEL');
    });

    it('can be followed across more than two windows to rebuild the original', async () => {
      const line = patterned(5500);
      const filePath = writeFixture('long.txt', `${line}\n`);
      const tool = new ReadFileTool(createHost(tempDir()));

      const windows = await readAllWindows(tool, { absolute_path: filePath });

      expect(windows).toHaveLength(3);
      expect(windows.join('')).toBe(line);
    });

    it('does not split a surrogate pair across windows', async () => {
      const line = `${'x'.repeat(LINE_CAP - 1)}\u{1F600}${'y'.repeat(300)}`;
      const filePath = writeFixture('emoji.txt', `${line}\n`);
      const tool = new ReadFileTool(createHost(tempDir()));

      const windows = await readAllWindows(tool, { absolute_path: filePath });

      expect(windows.length).toBeGreaterThan(1);
      for (const window of windows) {
        expect(window).not.toMatch(LONE_SURROGATE);
      }
      expect(windows.join('')).toBe(line);
    });
  });

  describe('window boundaries', () => {
    for (const [length, expectedWindows] of [
      [1999, 1],
      [2000, 1],
      [2001, 2],
      [4000, 2],
      [4001, 3],
    ] as const) {
      it(`reads a ${length}-character line in ${expectedWindows} window(s) with no empty window`, async () => {
        const line = patterned(length);
        const filePath = writeFixture('edge.txt', `${line}\n`);
        const tool = new ReadFileTool(createHost(tempDir()));

        const windows = await readAllWindows(tool, { absolute_path: filePath });

        expect(windows).toHaveLength(expectedWindows);
        for (const window of windows) {
          expect(window.length).toBeGreaterThan(0);
        }
        expect(windows.join('')).toBe(line);
      });
    }

    it('rejects a negative column_offset', async () => {
      const filePath = writeFixture('a.txt', 'abc\n');
      const tool = new ReadFileTool(createHost(tempDir()));

      expect(() =>
        tool.build({ absolute_path: filePath, column_offset: -1 }),
      ).toThrow(/column_offset/);
    });

    it('rejects a fractional column_offset', async () => {
      const filePath = writeFixture('a.txt', 'abc\n');
      const tool = new ReadFileTool(createHost(tempDir()));

      expect(() =>
        tool.build({ absolute_path: filePath, column_offset: 1.5 }),
      ).toThrow(/column_offset/);
    });

    it('returns an empty window with no continuation at the end of the line', async () => {
      const filePath = writeFixture('short.txt', 'abcdef\nsecond\n');
      const tool = new ReadFileTool(createHost(tempDir()));

      for (const columnOffset of [6, 5000]) {
        const output = await run(tool, {
          absolute_path: filePath,
          offset: 0,
          limit: 1,
          column_offset: columnOffset,
        });

        expect(shownText(output)).toBe('');
        expect(recommendedCalls(output)).toHaveLength(0);
        expect(output).not.toContain('second');
      }
    });

    it('applies the column window to a short line', async () => {
      const filePath = writeFixture('short.txt', 'abcdef\n');
      const tool = new ReadFileTool(createHost(tempDir()));

      const output = await run(tool, {
        absolute_path: filePath,
        column_offset: 2,
      });

      expect(shownText(output)).toBe('cdef');
    });
  });

  describe('line pagination alongside clipped lines', () => {
    const short = (name: string): string => name;
    const long3 = `${patterned(2600)}LONG3_TAIL`;
    const long6 = `${patterned(4500)}LONG6_TAIL`;
    const fileText = [
      short('alpha'),
      short('bravo'),
      long3,
      short('delta'),
      short('echo'),
      long6,
      short('golf'),
      short('hotel'),
    ].join('\n');

    it('uses absolute line numbers for clipped lines and still paginates real lines', async () => {
      const filePath = writeFixture('mixed.txt', `${fileText}\n`);
      const tool = new ReadFileTool(createHost(tempDir()));

      const page = await run(tool, {
        absolute_path: filePath,
        offset: 2,
        limit: 3,
      });

      expect(page).toContain('Showing lines 3-5 of 8 total lines.');
      expect(page).toContain('use offset: 5.');
      const clipCalls = recommendedCalls(page);
      expect(clipCalls).toStrictEqual([
        {
          absolute_path: filePath,
          offset: 2,
          limit: 1,
          column_offset: LINE_CAP,
        },
      ]);

      const tail = await run(tool, clipCalls[0]);
      expect(shownText(tail)).toBe(long3.slice(LINE_CAP));

      const nextPage = await run(tool, {
        absolute_path: filePath,
        offset: 5,
        limit: 3,
      });
      expect(nextPage).toContain('Showing lines 6-8 of 8 total lines.');
      expect(nextPage).not.toMatch(/use offset: \d+/);
      expect(recommendedCalls(nextPage)).toStrictEqual([
        {
          absolute_path: filePath,
          offset: 5,
          limit: 1,
          column_offset: LINE_CAP,
        },
      ]);

      const windows = await readAllWindows(tool, recommendedCalls(nextPage)[0]);
      expect(windows).toHaveLength(2);
      expect(`${long6.slice(0, LINE_CAP)}${windows.join('')}`).toBe(long6);
    });

    it('lists every clipped line in one read without suggesting another page', async () => {
      const filePath = writeFixture('mixed.txt', `${fileText}\n`);
      const tool = new ReadFileTool(createHost(tempDir()));

      const output = await run(tool, { absolute_path: filePath });

      expect(output).not.toMatch(/use offset: \d+/);
      expect(recommendedCalls(output)).toStrictEqual([
        {
          absolute_path: filePath,
          offset: 2,
          limit: 1,
          column_offset: LINE_CAP,
        },
        {
          absolute_path: filePath,
          offset: 5,
          limit: 1,
          column_offset: LINE_CAP,
        },
      ]);
      expect(output).toContain(`${long3.length} characters`);
      expect(output).toContain(`${long6.length} characters`);
    });

    for (const columnOffset of [0, 50]) {
      it(`bounds the clipped-line list at column_offset ${columnOffset} and the omitted lines are recoverable`, async () => {
        // Clipped lines sit on the odd lines 1, 3, ..., 23 with a short line
        // between each, so line numbers differ from clipped-line indices.
        const longLines = Array.from(
          { length: 12 },
          (_, i) => `L${i}:${patterned(2600)}`,
        );
        const fileLines = longLines.flatMap((long, i) => [long, `short${i}`]);
        const filePath = writeFixture('many.txt', `${fileLines.join('\n')}\n`);
        const tool = new ReadFileTool(createHost(tempDir()));
        const nextWindow = columnOffset + LINE_CAP;

        const output = await run(tool, {
          absolute_path: filePath,
          column_offset: columnOffset,
        });

        expect(output).toContain('2 more clipped line(s) not listed');
        const calls = recommendedCalls(output);
        const tailCalls = calls.slice(0, 10);
        expect(tailCalls.map((call) => call.offset)).toStrictEqual([
          0, 2, 4, 6, 8, 10, 12, 14, 16, 18,
        ]);
        const narrowing = calls.slice(10);
        expect(narrowing).toHaveLength(1);

        // The advertised tail calls for the listed lines retrieve the tails.
        for (const [i, call] of tailCalls.entries()) {
          const tail = await run(tool, call);
          expect(shownText(tail)).toBe(longLines[i].slice(nextWindow));
        }

        // Following the suggested narrowing lists exactly the omitted lines.
        const narrowed = await run(tool, narrowing[0]);
        expect(shownLines(narrowed)).toStrictEqual([
          longLines[10].slice(columnOffset, nextWindow),
          'short10'.slice(columnOffset),
          longLines[11].slice(columnOffset, nextWindow),
        ]);
        const omittedCalls = recommendedCalls(narrowed);
        expect(omittedCalls.map((call) => call.offset)).toStrictEqual([20, 22]);
        expect(narrowed).not.toContain('not listed');

        // And the tail calls advertised for the omitted lines retrieve them.
        for (const [i, call] of omittedCalls.entries()) {
          const tail = await run(tool, call);
          expect(shownText(tail)).toBe(longLines[10 + i].slice(nextWindow));
        }
      });
    }

    it('applies a nonzero column window to every selected line', async () => {
      const lineA = `A:${patterned(2800)}`;
      const lineB = `B:${patterned(2300)}`;
      const lineC = `C:${patterned(120)}`;
      const lineD = `D:${patterned(40)}`;
      const filePath = writeFixture(
        'window.txt',
        `${[lineA, lineB, lineC, lineD, 'tail'].join('\n')}\n`,
      );
      const tool = new ReadFileTool(createHost(tempDir()));
      const columnOffset = 100;
      const nextWindow = columnOffset + LINE_CAP;

      const output = await run(tool, {
        absolute_path: filePath,
        offset: 0,
        limit: 4,
        column_offset: columnOffset,
      });

      expect(shownLines(output)).toStrictEqual([
        lineA.slice(columnOffset, nextWindow),
        lineB.slice(columnOffset, nextWindow),
        lineC.slice(columnOffset),
        '',
      ]);
      expect(output).toContain('Showing lines 1-4 of 5 total lines.');
      expect(output).toContain('use offset: 4.');
      const calls = recommendedCalls(output);
      expect(calls).toStrictEqual([
        {
          absolute_path: filePath,
          offset: 0,
          limit: 1,
          column_offset: nextWindow,
        },
        {
          absolute_path: filePath,
          offset: 1,
          limit: 1,
          column_offset: nextWindow,
        },
      ]);

      expect(shownText(await run(tool, calls[0]))).toBe(
        lineA.slice(nextWindow),
      );
      expect(shownText(await run(tool, calls[1]))).toBe(
        lineB.slice(nextWindow),
      );
    });

    it('keeps absolute line numbers in a continuation window', async () => {
      const filePath = writeFixture('mixed.txt', `${fileText}\n`);
      const tool = new ReadFileTool(createHost(tempDir()));

      const output = await run(tool, {
        absolute_path: filePath,
        offset: 5,
        limit: 1,
        column_offset: LINE_CAP,
        showLineNumbers: true,
      });

      expect(shownText(output)).toBe(
        `   6| ${long6.slice(LINE_CAP, 2 * LINE_CAP)}`,
      );
    });
  });

  describe('annotated clipped lines', () => {
    const committedLong = patterned(3000);
    const modifiedLong = `EDIT${committedLong.slice(4)}`;

    function writeGitFixture(): string {
      const dir = tempDir();
      git(dir, ['init']);
      const filePath = join(dir, 'annotated.txt');
      writeFileSync(filePath, `first\n${committedLong}\nlast\n`, 'utf-8');
      git(dir, ['add', 'annotated.txt']);
      git(dir, ['commit', '-m', 'init']);
      writeFileSync(filePath, `first\n${modifiedLong}\nlast\n`, 'utf-8');
      return filePath;
    }

    it('read_file puts the git marker first and the line number after it on clipped and continuation windows', async () => {
      const filePath = writeGitFixture();
      const tool = new ReadFileTool(createHost(tempDir()));

      const head = await run(tool, {
        absolute_path: filePath,
        offset: 0,
        limit: 3,
        showGitChanges: true,
        showLineNumbers: true,
      });
      expect(shownLines(head)).toStrictEqual([
        '░   1| first',
        `M   2| ${modifiedLong.slice(0, LINE_CAP)}`,
        '░   3| last',
      ]);
      expect(shownTextWithMarkers(head).split('\n')[1]).toEndWith(CLIP_MARKER);

      const [call] = recommendedCalls(head);
      const tail = await run(tool, {
        ...call,
        showGitChanges: true,
        showLineNumbers: true,
      });
      expect(shownText(tail)).toBe(`M   2| ${modifiedLong.slice(LINE_CAP)}`);
    });

    it('read_line_range puts the git marker first and the line number after it on a clipped line', async () => {
      const filePath = writeGitFixture();
      const host = createHost(tempDir());
      const rangeTool = new ReadLineRangeTool(host);

      const result = await rangeTool.execute({
        absolute_path: filePath,
        start_line: 1,
        end_line: 3,
        showGitChanges: true,
        showLineNumbers: true,
      });
      const output = String(result.llmContent);

      expect(output).toContain('Git changes legend:');
      expect(output).toContain(
        `\n\n░   1| first\nM   2| ${modifiedLong.slice(0, LINE_CAP)}${CLIP_MARKER}\n░   3| last`,
      );

      const [call] = recommendedCalls(output);
      const tail = await run(new ReadFileTool(host), {
        ...call,
        showGitChanges: true,
        showLineNumbers: true,
      });
      expect(shownText(tail)).toBe(`M   2| ${modifiedLong.slice(LINE_CAP)}`);
    });
  });

  describe('read_line_range', () => {
    it('directs a clipped line to a read_file call that retrieves the tail', async () => {
      const long = `${patterned(3500)}RANGE_TAIL`;
      const filePath = writeFixture('range.txt', `top\nmiddle\n${long}\nend\n`);
      const host = createHost(tempDir());
      const rangeTool = new ReadLineRangeTool(host);

      const result = await rangeTool.execute({
        absolute_path: filePath,
        start_line: 2,
        end_line: 3,
      });
      const output = String(result.llmContent);

      expect(output).not.toContain('RANGE_TAIL');
      expect(output).toContain(`${LINE_CAP} characters`);
      const calls = recommendedCalls(output);
      expect(calls).toStrictEqual([
        {
          absolute_path: filePath,
          offset: 2,
          limit: 1,
          column_offset: LINE_CAP,
        },
      ]);

      const windows = await readAllWindows(new ReadFileTool(host), calls[0]);
      expect(`${long.slice(0, LINE_CAP)}${windows.join('')}`).toBe(long);
      expect(windows.join('')).toContain('RANGE_TAIL');
    });

    it('does not split a surrogate pair across the windows it advertises', async () => {
      const line = `${'x'.repeat(LINE_CAP - 1)}\u{1F600}${'y'.repeat(300)}`;
      const filePath = writeFixture('range-emoji.txt', `top\n${line}\n`);
      const host = createHost(tempDir());
      const rangeTool = new ReadLineRangeTool(host);

      const result = await rangeTool.execute({
        absolute_path: filePath,
        start_line: 2,
        end_line: 2,
      });
      const output = String(result.llmContent);

      const first = rangeText(output);
      expect(first).not.toMatch(LONE_SURROGATE);
      const [call] = recommendedCalls(output);
      const windows = await readAllWindows(new ReadFileTool(host), call);
      for (const window of windows) {
        expect(window).not.toMatch(LONE_SURROGATE);
      }
      expect(`${first}${windows.join('')}`).toBe(line);
    });

    it('adds no clipping note for lines within the cap', async () => {
      const filePath = writeFixture('plain.txt', 'one\ntwo\nthree\n');
      const rangeTool = new ReadLineRangeTool(createHost(tempDir()));

      const result = await rangeTool.execute({
        absolute_path: filePath,
        start_line: 1,
        end_line: 2,
      });

      expect(String(result.llmContent)).not.toContain('read_file');
    });
  });

  describe('unchanged behavior', () => {
    it('returns a small file verbatim', async () => {
      const filePath = writeFixture('small.txt', 'one\ntwo\n');
      const tool = new ReadFileTool(createHost(tempDir()));

      expect(await run(tool, { absolute_path: filePath })).toBe('one\ntwo');
    });

    it('paginates real lines and stops suggesting offsets on the last page', async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
      const filePath = writeFixture('ten.txt', `${lines.join('\n')}\n`);
      const tool = new ReadFileTool(createHost(tempDir()));

      const first = await run(tool, {
        absolute_path: filePath,
        offset: 0,
        limit: 4,
      });
      expect(first).toContain('Showing lines 1-4 of 10 total lines.');
      expect(first).toContain('use offset: 4.');
      expect(shownText(first)).toBe('line1\nline2\nline3\nline4');

      const last = await run(tool, {
        absolute_path: filePath,
        offset: 8,
        limit: 4,
      });
      expect(last).toContain('Showing lines 9-10 of 10 total lines.');
      expect(last).not.toMatch(/use offset: \d+/);
      expect(shownText(last)).toBe('line9\nline10');
    });

    it('keeps line-number formatting for paginated reads', async () => {
      const filePath = writeFixture('nums.txt', 'a\nb\nc\nd\n');
      const tool = new ReadFileTool(createHost(tempDir()));

      const output = await run(tool, {
        absolute_path: filePath,
        offset: 1,
        limit: 2,
        showLineNumbers: true,
      });

      expect(shownText(output)).toBe('   2| b\n   3| c');
    });

    it('keeps the exact baseline clip for helper callers that omit the column offset', async () => {
      const line = `${'x'.repeat(LINE_CAP - 1)}\u{1F600}${'y'.repeat(300)}`;
      const filePath = writeFixture('helper-emoji.txt', `${line}\n`);

      const result = await processSingleFileContent(filePath, tempDir());

      expect(result.llmContent).toBe(
        `${line.substring(0, LINE_CAP)}${CLIP_MARKER}`,
      );
      expect(result.linesShortened).toBe(true);
    });

    it('lets a caller select continuation-aware clipping explicitly with a column offset', async () => {
      const line = `${'x'.repeat(LINE_CAP - 1)}\u{1F600}${'y'.repeat(300)}`;
      const filePath = writeFixture('helper-explicit.txt', `${line}\n`);

      const result = await processSingleFileContent(
        filePath,
        tempDir(),
        undefined,
        undefined,
        undefined,
        undefined,
        0,
      );

      expect(result.llmContent).toBe(
        `${'x'.repeat(LINE_CAP - 1)}${CLIP_MARKER}`,
      );
      expect(result.clippedLines).toStrictEqual([
        {
          lineNumber: 1,
          lineLength: line.length,
          nextColumnOffset: LINE_CAP - 1,
        },
      ]);
    });

    it('keeps the default 2000-character clip for other helper consumers', async () => {
      const line = patterned(3000);
      const filePath = writeFixture('helper.txt', `${line}\n`);

      const result = await processSingleFileContent(filePath, tempDir());

      expect(result.llmContent).toBe(
        `${line.slice(0, LINE_CAP)}${CLIP_MARKER}`,
      );
      expect(result.linesShortened).toBe(true);
    });
  });
});
