/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import path from 'path';

import { findGitRoot, isGitRepository } from './gitUtils.js';

export type GitLineChangeMarker = 'N' | 'M' | 'D' | '░';

export interface GitLineChangeResult {
  /**
   * 1-based line number in the *working tree* file -> marker.
   *
   * Only includes lines that have a non-default marker (N/M/D). Lines not present in the map
   * should be treated as unchanged.
   */
  markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>>;

  /**
   * 1-based line numbers after which there is a deletion block (relative to HEAD).
   *
   * Special case: 0 means "before the first line" (deletions at file start).
   */
  deletionAfterLines: Set<number>;

  /**
   * When present, indicates why git changes could not be computed.
   */
  warning?: string;
}

const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 30_000;

function runGit(
  args: string[],
  cwd: string,
  options?: { timeoutMs?: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
    });

    const timeoutMs = options?.timeoutMs ?? DEFAULT_GIT_COMMAND_TIMEOUT_MS;

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      fn();
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } finally {
        settle(() =>
          reject(
            new Error(
              `git command timed out after ${timeoutMs}ms: git ${args.join(' ')}`,
            ),
          ),
        );
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (err) =>
      settle(() => reject(new Error(`Failed to start git: ${err.message}`))),
    );

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (code === 0) {
        settle(() => resolve(stdout));
        return;
      }

      settle(() => reject(new Error(stderr || `git exited with code ${code}`)));
    });
  });
}

async function fileExistsInHead(
  relToGitRoot: string,
  gitRoot: string,
): Promise<boolean> {
  try {
    await runGit(['cat-file', '-e', `HEAD:${relToGitRoot}`], gitRoot);
    return true;
  } catch {
    return false;
  }
}

interface HunkHeader {
  oldStart: number;
  oldCount?: number;
  newStart: number;
  newCount?: number;
}

/**
 * Parses a git diff hunk header line (`@@ -oldStart,oldCount +newStart,newCount @@`)
 * using string operations instead of a regex.
 */
function parseHunkHeader(line: string): HunkHeader | null {
  const prefix = '@@';
  if (!line.startsWith(prefix)) {
    return null;
  }
  let pos = prefix.length;
  // Skip whitespace
  while (pos < line.length && line[pos] === ' ') {
    pos++;
  }
  // Expect "-oldStart[,oldCount]"
  if (line[pos] !== '-') {
    return null;
  }
  pos++;
  const oldPart = readHunkRange(line, pos);
  if (oldPart === null) {
    return null;
  }
  pos = oldPart.next;
  // Skip whitespace
  while (pos < line.length && line[pos] === ' ') {
    pos++;
  }
  // Expect "+newStart[,newCount]"
  if (line[pos] !== '+') {
    return null;
  }
  pos++;
  const newPart = readHunkRange(line, pos);
  if (newPart === null) {
    return null;
  }
  // Skip trailing whitespace and @@
  return {
    oldStart: oldPart.start,
    oldCount: oldPart.count,
    newStart: newPart.start,
    newCount: newPart.count,
  };
}

function readHunkRange(
  line: string,
  start: number,
): { start: number; count?: number; next: number } | null {
  let pos = start;
  let numStr = '';
  while (pos < line.length && line[pos] >= '0' && line[pos] <= '9') {
    numStr += line[pos];
    pos++;
  }
  if (numStr.length === 0) {
    return null;
  }
  const startNum = Number(numStr);
  if (line[pos] === ',') {
    pos++;
    let countStr = '';
    while (pos < line.length && line[pos] >= '0' && line[pos] <= '9') {
      countStr += line[pos];
      pos++;
    }
    if (countStr.length === 0) {
      return null;
    }
    return { start: startNum, count: Number(countStr), next: pos };
  }
  return { start: startNum, next: pos };
}

function parseUnifiedZeroDiff(diffText: string): {
  markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>>;
  deletionAfterLines: Set<number>;
} {
  const markersByLine = new Map<number, Exclude<GitLineChangeMarker, '░'>>();
  const deletionAfterLines = new Set<number>();

  const lines = diffText.split(/\r?\n/);

  for (const line of lines) {
    const m = parseHunkHeader(line);
    if (m) {
      processHunkForMarkers(m, markersByLine, deletionAfterLines);
    }
  }

  return { markersByLine, deletionAfterLines };
}

function processHunkForMarkers(
  m: HunkHeader,
  markersByLine: Map<number, string>,
  deletionAfterLines: Set<number>,
): void {
  const oldCount = m.oldCount ?? 1;
  const newStart = m.newStart;
  const newCount = m.newCount ?? 1;

  if (oldCount === 0) {
    for (let i = 0; i < newCount; i++) {
      markersByLine.set(newStart + i, 'N');
    }
    return;
  }

  if (newCount === 0 && oldCount > 0) {
    const oldStart = m.oldStart;
    deletionAfterLines.add(Math.max(0, oldStart - 1));
    return;
  }

  if (oldCount > 0 && newCount > 0) {
    for (let i = 0; i < newCount; i++) {
      markersByLine.set(newStart + i, 'M');
    }
    if (oldCount > newCount) {
      deletionAfterLines.add(newStart + newCount - 1);
    }
  }
}

/**
 * Computes per-line change markers for a file relative to HEAD.
 *
 * Notes:
 * - Uses `git diff HEAD --unified=0` to include both staged and unstaged changes.
 * - For files not in a git repo / git unavailable / errors: returns empty markers and a warning.
 */
function buildUntrackedFileResult(
  relToGitRoot: string,
  gitRoot: string,
): Promise<GitLineChangeResult> {
  return runGit(['show', `:${relToGitRoot}`], gitRoot)
    .catch(() => '')
    .then((content) => {
      if (content === '') {
        return {
          markersByLine: new Map(),
          deletionAfterLines: new Set(),
          warning:
            'File is not present in HEAD (untracked), but failed to read its content from git index',
        };
      }

      const normalizedContent = content.replace(/\r?\n$/, '');
      const lineCount =
        normalizedContent === '' ? 0 : normalizedContent.split(/\r?\n/).length;
      const markersByLine = new Map<
        number,
        Exclude<GitLineChangeMarker, '░'>
      >();
      for (let i = 1; i <= lineCount; i++) {
        markersByLine.set(i, 'N');
      }

      return {
        markersByLine,
        deletionAfterLines: new Set(),
        warning:
          'File is not present in HEAD (untracked); marked all lines as new',
      };
    });
}

export async function getGitLineChanges(
  absolutePath: string,
): Promise<GitLineChangeResult> {
  try {
    if (!path.isAbsolute(absolutePath)) {
      return {
        markersByLine: new Map(),
        deletionAfterLines: new Set(),
        warning: `Path is not absolute: ${absolutePath}`,
      };
    }

    const fileDir = path.dirname(absolutePath);
    if (!isGitRepository(fileDir)) {
      return {
        markersByLine: new Map(),
        deletionAfterLines: new Set(),
        warning: 'Not a git repository',
      };
    }

    const gitRoot = findGitRoot(fileDir);
    if (!gitRoot) {
      return {
        markersByLine: new Map(),
        deletionAfterLines: new Set(),
        warning: 'Failed to locate git root',
      };
    }

    // Always use a path relative to the git root.
    const relToGitRoot = path.relative(gitRoot, absolutePath);

    // `git diff HEAD -- <file>` gives changes in index+working tree vs HEAD.
    // `--no-color` keeps parsing predictable.
    const diffText = await runGit(
      ['diff', '--no-color', '--unified=0', 'HEAD', '--', relToGitRoot],
      gitRoot,
    );

    if (diffText.trim() === '') {
      const existsInHead = await fileExistsInHead(relToGitRoot, gitRoot);
      if (!existsInHead) {
        return await buildUntrackedFileResult(relToGitRoot, gitRoot);
      }
    }

    const parsed = parseUnifiedZeroDiff(diffText);
    return {
      markersByLine: parsed.markersByLine,
      deletionAfterLines: parsed.deletionAfterLines,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      markersByLine: new Map(),
      deletionAfterLines: new Set(),
      warning: msg,
    };
  }
}
