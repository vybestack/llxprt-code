/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bun-test-free checked Git fixture helpers for the ast_read_file suites.
 *
 * This module deliberately imports nothing from `bun:test` so that child
 * processes (for example the memory-regression fixture generator) can reuse
 * the exact same checked wrapper instead of a weaker duplicate.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { Buffer } from 'node:buffer';

/** Bounded fixture Git timeout and output allowance. */
export const GIT_FIXTURE_TIMEOUT_MS = 30_000;
export const GIT_FIXTURE_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Fixture repositories are synthetic, so the machine's system and user Git
 * configuration must not leak in. Git for Windows ships `core.autocrlf=true`
 * in its system config, which makes every fixture file go through LF to CRLF
 * conversion and a per-file warning.
 *
 * GIT_CONFIG_GLOBAL points at an empty regular file rather than the null
 * device: Git on Windows cannot open `\\.\nul` as a config file and aborts
 * with "unable to access". The file lives outside every fixture repository so
 * `git add -A` never stages it, and it is created once per process.
 */
let isolatedGitConfigEnv: Record<string, string> | undefined;

function getIsolatedGitConfigEnv(): Record<string, string> {
  if (isolatedGitConfigEnv === undefined) {
    const configDir = mkdtempSync(join(tmpdir(), 'ast-read-git-config-'));
    const emptyGlobalConfig = join(configDir, 'empty-gitconfig');
    writeFileSync(emptyGlobalConfig, '');
    process.once('exit', () => {
      rmSync(configDir, { recursive: true, force: true });
    });
    isolatedGitConfigEnv = {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: emptyGlobalConfig,
    };
  }
  return isolatedGitConfigEnv;
}

/** Render every failure mode of a checked fixture Git run. */
function describeGitFailure(
  args: readonly string[],
  result: SpawnSyncReturns<string>,
): string {
  const details = [
    `status=${String(result.status)}`,
    `signal=${String(result.signal)}`,
    `error=${result.error instanceof Error ? result.error.message : String(result.error)}`,
    `stderr=${String(result.stderr).trim().slice(0, 2000)}`,
  ];
  return `git ${args.join(' ')} failed (${details.join('; ')})`;
}

/**
 * The single shared checked Git fixture helper. Fails fixture setup loudly on
 * any nonzero status, signal death, or spawn error so a broken fixture can
 * never masquerade as behavior. The timeout and maxBuffer are explicit: a
 * large fixture (thousands of long paths) otherwise exceeds the runtime's
 * small default buffer allowance and is killed mid-write.
 * Returns captured stdout for callers that need fixture data back. `input`
 * is written to the command's stdin.
 */
export function gitCheck(dir: string, args: string[], input?: Buffer): string {
  if (!isAbsolute(dir)) {
    throw new Error(`fixture git dir must be absolute, got: ${dir}`);
  }
  const result = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf-8',
    stdio: 'pipe',
    env: { ...process.env, ...getIsolatedGitConfigEnv() },
    timeout: GIT_FIXTURE_TIMEOUT_MS,
    maxBuffer: GIT_FIXTURE_MAX_BUFFER,
    input,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(describeGitFailure(args, result));
  }
  return result.stdout;
}

/** Initializes a real Git repository with a stable identity. */
export function gitInit(dir: string): void {
  gitCheck(dir, ['init']);
  gitCheck(dir, ['config', 'user.email', 'test@example.com']);
  gitCheck(dir, ['config', 'user.name', 'Test']);
  // Some fixtures deliberately generate very long relative paths to force Git
  // to emit more stdout than a single pipe chunk. Those paths exceed Windows'
  // 260-character MAX_PATH, and Git refuses them with
  // "Filename too long", failing the commit rather than the assertion under
  // test. core.longpaths opts this fixture repository into Git's long-path
  // support so the byte volume the fixture needs is reachable on Windows too.
  // It is a no-op on POSIX, so the setting is applied unconditionally rather
  // than behind a platform branch.
  gitCheck(dir, ['config', 'core.longpaths', 'true']);
  // Fixture content is committed byte-for-byte: no line-ending conversion, and
  // no durability work (fsync per object, background gc) for throwaway trees.
  gitCheck(dir, ['config', 'core.autocrlf', 'false']);
  gitCheck(dir, ['config', 'core.safecrlf', 'false']);
  gitCheck(dir, ['config', 'core.fsync', 'none']);
  gitCheck(dir, ['config', 'gc.auto', '0']);
}

/** Stages and commits every fixture change; returns the resulting commit SHA. */
export function gitCommitAll(dir: string, message: string): string {
  gitCheck(dir, ['add', '-A']);
  gitCheck(dir, ['commit', '-m', message]);
  return gitCheck(dir, ['rev-parse', 'HEAD']).trim();
}

/** Fast-import `data` block: exact byte length, payload, terminating LF. */
function fastImportData(payload: Buffer): Buffer[] {
  return [Buffer.from(`data ${payload.length}\n`), payload, Buffer.from('\n')];
}

/** Fast-import `M` command for one regular worktree file. */
function fastImportFileCommand(dir: string, path: string): Buffer[] | null {
  if (path.includes('\n') || path.startsWith('"')) {
    throw new Error(`fixture path needs fast-import quoting: ${path}`);
  }
  const absolute = join(dir, path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null; // tracked file deleted from the worktree, as `add -A` sees it
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new Error(`fixture path is not a regular file: ${path}`);
  }
  // Windows has no executable bit; Git there records new files as 100644.
  const executable = process.platform !== 'win32' && (stat.mode & 0o111) !== 0;
  const mode = executable ? '100755' : '100644';
  return [
    Buffer.from(`M ${mode} inline ${path}\n`),
    ...fastImportData(readFileSync(absolute)),
  ];
}

/**
 * Bulk equivalent of {@link gitCommitAll} for fixtures with thousands of
 * files. `git add -A` stats, filters, deflates, and writes one loose object
 * per file, which exceeds the bounded Git timeout on Windows NTFS. This
 * streams every non-ignored worktree file into a single `git fast-import`
 * process, which writes one packfile, then makes the index match the new
 * HEAD. Same tree as `add -A` for regular files with no attribute filters
 * (the fixture repositories use none): the same non-ignored paths, content,
 * and 100644/100755 modes. Returns the resulting commit SHA.
 */
export function gitCommitAllBulk(dir: string, message: string): string {
  const paths = new Set(
    gitCheck(dir, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ])
      .split('\0')
      .filter((path) => path !== ''),
  );
  const branchRef = gitCheck(dir, ['symbolic-ref', 'HEAD']).trim();
  const author = gitCheck(dir, ['var', 'GIT_AUTHOR_IDENT']).trim();
  const committer = gitCheck(dir, ['var', 'GIT_COMMITTER_IDENT']).trim();

  // An unborn branch has no tip; for-each-ref prints nothing for it.
  const hasParent =
    gitCheck(dir, [
      'for-each-ref',
      '--format=%(objectname)',
      branchRef,
    ]).trim() !== '';

  // `deleteall` makes the commit's tree exactly the listed files.
  const stream: Buffer[] = [
    Buffer.from(
      `commit ${branchRef}\nauthor ${author}\ncommitter ${committer}\n`,
    ),
    ...fastImportData(Buffer.from(`${message}\n`)),
    ...(hasParent ? [Buffer.from(`from ${branchRef}^0\n`)] : []),
    Buffer.from('deleteall\n'),
  ];
  for (const path of paths) {
    const command = fastImportFileCommand(dir, path);
    if (command !== null) {
      stream.push(...command);
    }
  }
  stream.push(Buffer.from('done\n'));
  gitCheck(dir, ['fast-import', '--quiet', '--done'], Buffer.concat(stream));

  // Rebuild the index from HEAD, then refresh its stat data once so later
  // `git diff`/`status` calls compare stat info instead of rehashing every
  // file against a zeroed index.
  gitCheck(dir, ['read-tree', 'HEAD']);
  gitCheck(dir, ['update-index', '--refresh', '-q']);
  return gitCheck(dir, ['rev-parse', 'HEAD']).trim();
}
