/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test helper for issue #4001: a `gh` shim that behaves like real `gh` with
 * respect to its working directory.
 *
 * The shim records the directory it was started in, then runs a real `git`
 * command. When the inherited directory has been deleted that command dies
 * with "Unable to read current working directory", and the shim reports it
 * the way gh does ("failed to run git: ..."), so a deleted cwd fails here
 * for the same reason it fails in production. Any other git outcome (for
 * example "not a git repository" in a neutral directory) is ignored,
 * matching `gh pr create --repo/--head/--base`, which needs a readable cwd
 * but not a repository.
 *
 * The shim is a POSIX shell script; suites using it skip on Windows.
 *
 * @issue 4001
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Marker recorded when the shim cannot read its own working directory. */
const CWD_UNREADABLE = '(unreadable)';

export const PR_URL = 'https://github.com/owner/name/pull/7';
const ISSUE_URL = 'https://github.com/owner/name/issues/1';

export interface CwdShim {
  /** Directory to prepend to PATH. */
  readonly binDir: string;
  /** Working directory of every gh invocation, in order (physical paths). */
  readonly readCwds: () => Promise<string[]>;
  /** Removes everything the shim created. */
  readonly cleanup: () => Promise<void>;
}

export interface CwdShimOptions {
  /** When set, every invocation fails with this stderr after recording. */
  readonly failWith?: string;
}

/** Single-quotes a value for safe interpolation into the shell script. */
function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function replyJson(value: unknown): string {
  return shq(JSON.stringify(value));
}

function shimScript(capturePath: string, options: CwdShimOptions): string {
  const lines = [
    '#!/bin/sh',
    'cwd=$(pwd -P 2>/dev/null)',
    `[ -n "$cwd" ] || cwd=${shq(CWD_UNREADABLE)}`,
    `printf '%s\\n' "$cwd" >> ${shq(capturePath)}`,
    'out=$(git rev-parse --show-toplevel 2>&1)',
    'case "$out" in',
    '  *"Unable to read current working directory"*)',
    '    echo "failed to run git: $out" >&2',
    '    exit 1 ;;',
    'esac',
  ];
  if (options.failWith !== undefined) {
    lines.push(`echo ${shq(options.failWith)} >&2`, 'exit 1');
  }
  lines.push(
    'case "$*" in',
    `  *"pr create"*) echo ${shq(PR_URL)} ;;`,
    `  *"issue edit"*|*"issue comment"*) echo ${shq(ISSUE_URL)} ;;`,
    `  *issueTypes*) printf '%s' ${replyJson({
      data: {
        repository: {
          issueTypes: { nodes: [{ id: 'IT_BUG_4001', name: 'Bug' }] },
        },
      },
    })} ;;`,
    `  *"issue(number"*) printf '%s' ${replyJson({
      data: { repository: { issue: { id: 'I_ISSUE_4001' } } },
    })} ;;`,
    `  *updateIssue*) printf '%s' ${replyJson({
      data: { updateIssue: { issue: { number: 1 } } },
    })} ;;`,
    '  *) echo "gh shim: unexpected argv: $*" >&2; exit 1 ;;',
    'esac',
  );
  return `${lines.join('\n')}\n`;
}

/** Builds the shim in a fresh temp dir; call `cleanup` when done. */
export async function makeCwdShim(
  options: CwdShimOptions = {},
): Promise<CwdShim> {
  const base = await mkdtemp(join(tmpdir(), 'gh4001-shim-'));
  const binDir = join(base, 'bin');
  await mkdir(binDir, { recursive: true });
  const capturePath = join(base, 'cwd.log');
  await writeFile(join(binDir, 'gh'), shimScript(capturePath, options), {
    mode: 0o755,
  });
  return {
    binDir,
    readCwds: async () => {
      try {
        const text = await readFile(capturePath, 'utf8');
        return text.split('\n').filter((line) => line !== '');
      } catch {
        return [];
      }
    },
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

/** PATH value with the shim's bin dir first. */
export function pathWithShim(binDir: string): string {
  const existing = process.env.PATH;
  return existing !== undefined ? `${binDir}:${existing}` : binDir;
}

/**
 * Runs `fn` with the shim first on PATH. The broker copies PATH from
 * process.env into the gh child env at call time.
 */
export async function withGhOnPath<T>(
  binDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = process.env.PATH;
  process.env.PATH = pathWithShim(binDir);
  try {
    return await fn();
  } finally {
    process.env.PATH = saved;
  }
}
