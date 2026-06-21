/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import { existsSync } from 'node:fs';
import path from 'path';

export type GitLineChangeMarker = 'N' | 'M' | 'D' | '░';

export interface GitLineChangeResult {
  markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>>;
  deletionAfterLines: Set<number>;
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

function findGitRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  let parent = path.dirname(current);
  for (;;) {
    if (existsSync(path.join(current, '.git'))) return current;
    if (parent === current) return undefined;
    current = parent;
    parent = path.dirname(current);
  }
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

/** Parses a git diff hunk header like '@@ -10,3 +12,5 @@' into its components. */
function parseHunkHeader(line: string): {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
} | null {
  // Expected format: @@ -OLD_START[,OLD_COUNT] +NEW_START[,NEW_COUNT] @@
  if (!line.startsWith('@@')) {
    return null;
  }
  const dashIdx = line.indexOf('-');
  const plusIdx = line.indexOf('+', dashIdx);
  const endIdx = line.indexOf('@@', plusIdx);
  if (dashIdx < 0 || plusIdx < 0 || endIdx < 0) {
    return null;
  }
  const oldPart = line.substring(dashIdx + 1, plusIdx).trim();
  const newPart = line.substring(plusIdx + 1, endIdx).trim();
  const [oldStartStr, oldCountStr] = oldPart.split(',');
  const [newStartStr, newCountStr] = newPart.split(',');
  return {
    oldStart: Number(oldStartStr),
    oldCount: oldCountStr ? Number(oldCountStr) : 1,
    newStart: Number(newStartStr),
    newCount: newCountStr ? Number(newCountStr) : 1,
  };
}

function applyHunkToMarkers(
  hunk: {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
  },
  markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>>,
  deletionAfterLines: Set<number>,
): void {
  const { oldStart, oldCount, newStart, newCount } = hunk;

  if (oldCount === 0) {
    for (let i = 0; i < newCount; i++) {
      markersByLine.set(newStart + i, 'N');
    }
    return;
  }

  if (newCount === 0) {
    deletionAfterLines.add(Math.max(0, oldStart - 1));
    return;
  }

  for (let i = 0; i < newCount; i++) {
    markersByLine.set(newStart + i, 'M');
  }
  if (oldCount > newCount) {
    deletionAfterLines.add(newStart + newCount - 1);
  }
}

function parseUnifiedZeroDiff(diffText: string): {
  markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>>;
  deletionAfterLines: Set<number>;
} {
  const markersByLine = new Map<number, Exclude<GitLineChangeMarker, '░'>>();
  const deletionAfterLines = new Set<number>();
  const lines = diffText.split('\n');

  for (const line of lines) {
    const hunk = parseHunkHeader(line);
    if (hunk) {
      applyHunkToMarkers(hunk, markersByLine, deletionAfterLines);
    }
  }

  return { markersByLine, deletionAfterLines };
}

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
    const gitRoot = findGitRoot(fileDir);
    if (!gitRoot) {
      return {
        markersByLine: new Map(),
        deletionAfterLines: new Set(),
        warning: 'Not a git repository',
      };
    }

    const relToGitRoot = path.relative(gitRoot, absolutePath);
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
