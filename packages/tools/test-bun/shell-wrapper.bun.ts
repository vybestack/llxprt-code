/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import type {
  IShellExecutionService,
  ShellResult,
} from '../src/interfaces/IShellExecutionService.js';
import {
  buildCommandToExecute,
  createShellToolHostFromExecutionService,
  singleQuoteForShell,
} from '../src/tools/shell-helpers.js';

const isWindows = process.platform === 'win32';

interface BashResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Executes a single bash script as one `bash -c` argument. */
function runInBash(script: string, cwd: string): BashResult {
  const result = spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Returns true when `pid` is a live, signalable process. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Sends SIGKILL to exactly one pid, ignoring errors if it already exited. */
function terminatePid(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already reaped; nothing to clean up.
  }
}

/** Parses the numeric pids recorded by a `pgrep` result file. */
function readPgrepPids(file: string): number[] {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * Reads and validates a single numeric PID recorded in `file`. Returns
 * `undefined` when the file is absent or does not contain a valid PID, so a
 * caller's `finally` can recover the exact survivor even if the in-try
 * assignment never completed.
 */
function readExactPid(file: string): number | undefined {
  if (!existsSync(file)) {
    return undefined;
  }
  const parsed = Number(readFileSync(file, 'utf8').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Creates an isolated temp directory for the test body and removes it after. */
async function withTempDir<T>(
  body: (dir: string) => Promise<T> | T,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'issue2980-'));
  try {
    return await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('singleQuoteForShell produces literal bash data', () => {
  it('wraps ordinary text and whitespace in single quotes', () => {
    expect(singleQuoteForShell('hello')).toBe("'hello'");
    expect(singleQuoteForShell('a b c')).toBe("'a b c'");
  });

  it('makes shell metacharacters literal', () => {
    expect(singleQuoteForShell('$(echo X)')).toBe("'$(echo X)'");
    expect(singleQuoteForShell('`echo X`')).toBe("'`echo X`'");
    expect(singleQuoteForShell('$HOME')).toBe("'$HOME'");
  });
});

// Real-bash evidence: quoting must round-trip the exact original value, which
// proves the escaping is correct for apostrophes, consecutive apostrophes, and
// command-substitution syntax alike. Skipped on Windows (no bash).
describe.skipIf(isWindows)('singleQuoteForShell survives real bash', () => {
  it.each([
    'hello',
    'a b c',
    "it's",
    "a''b",
    '$(echo INJECTED)',
    '`echo INJECTED`',
    'path with $var and $(cmd)',
  ])('round-trips %j through bash without interpretation', (value) => {
    const quoted = singleQuoteForShell(value);
    const { status, stdout } = runInBash(`printf %s ${quoted}`, process.cwd());
    expect(status).toBe(0);
    expect(stdout).toBe(value);
  });
});

// REQ-2980-1: the foreground wrapper must keep the user's shell grammar intact.
// The generated command is executed through real bash, not string inspection.
describe.skipIf(isWindows)(
  'buildCommandToExecute preserves shell grammar',
  () => {
    it('runs an escaped terminal ampersand unchanged (regression contract)', async () => {
      await withTempDir(async (dir) => {
        const tempFilePath = join(dir, 'pgrep.tmp');
        const generated = buildCommandToExecute(
          'printf foo\\&',
          false,
          tempFilePath,
        );
        const { status, stdout } = runInBash(generated, dir);
        expect(status).toBe(0);
        expect(stdout).toBe('foo&');
      });
    });

    it('does not let a trailing comment consume wrapper syntax', async () => {
      await withTempDir(async (dir) => {
        const tempFilePath = join(dir, 'pgrep.tmp');
        const generated = buildCommandToExecute(
          'echo hi # a trailing comment',
          false,
          tempFilePath,
        );
        const { status, stdout } = runInBash(generated, dir);
        expect(status).toBe(0);
        expect(stdout.trim()).toBe('hi');
        expect(existsSync(tempFilePath)).toBe(true);
      });
    });

    it('accepts a heredoc and writes the pgrep result file', async () => {
      await withTempDir(async (dir) => {
        const tempFilePath = join(dir, 'pgrep.tmp');
        const generated = buildCommandToExecute(
          'cat <<EOF\nhello\nEOF',
          false,
          tempFilePath,
        );
        const { status, stdout } = runInBash(generated, dir);
        expect(status).toBe(0);
        expect(stdout).toBe('hello\n');
        expect(existsSync(tempFilePath)).toBe(true);
      });
    });

    it('captures the exact surviving background PID via pgrep and cleans it up deterministically', async () => {
      await withTempDir(async (dir) => {
        const pgrepFile = join(dir, 'pgrep.tmp');
        const childPidFile = join(dir, 'child.pid');
        const quotedChildPidFile = singleQuoteForShell(childPidFile);
        // Body truly ends in `&`. The long-lived child is backgrounded first,
        // then the shell writes `$!` (the child's exact PID) to the pid file
        // synchronously in the foreground, before a harmless final background
        // operator (`true &`). Because the pid file is written before the
        // script exits, it is guaranteed to exist before the EXIT trap fires,
        // so the exact surviving PID is independently known for cleanup. All of
        // the child's stdio is detached so it cannot hold the test's pipes open.
        const body = `sleep 30 >/dev/null 2>&1 </dev/null & echo $! > ${quotedChildPidFile}; true &`;
        const generated = buildCommandToExecute(body, false, pgrepFile);
        try {
          // Check the wrapper exit immediately and surface stderr as failure
          // evidence before reading the PID file. stderr is not required to be
          // empty (pgrep/the environment may legitimately write there).
          const launch = runInBash(generated, dir);
          expect(
            launch.status,
            `survivor wrapper should exit 0; got status=${launch.status} stderr=${launch.stderr}`,
          ).toBe(0);
          // The exact PID is guaranteed written before the trap, so read it
          // directly rather than polling for it.
          const childPid = readExactPid(childPidFile);
          if (childPid === undefined) {
            throw new Error(
              `pid file did not record the exact child PID: ${JSON.stringify(
                existsSync(childPidFile)
                  ? readFileSync(childPidFile, 'utf8')
                  : '<missing>',
              )}`,
            );
          }
          expect(childPid).toBeGreaterThan(0);
          // The wrapper's EXIT-trap pgrep must record the exact surviving PID.
          const captured = readPgrepPids(pgrepFile);
          expect(captured).toContain(childPid);
          expect(isAlive(childPid)).toBe(true);
        } finally {
          // Deterministic exact-PID cleanup: recover the exact PID from the
          // file even if an assertion above failed, so no survivor can leak.
          // Never a broad kill pattern.
          const pid = readExactPid(childPidFile);
          if (pid !== undefined) {
            terminatePid(pid);
          }
        }
      });
    });

    it('captures the body exit status before running pgrep', async () => {
      await withTempDir(async (dir) => {
        const cases: Array<{ command: string; exit: number }> = [
          { command: 'echo ok', exit: 0 },
          { command: 'false', exit: 1 },
          { command: 'exit 42', exit: 42 },
          { command: 'set -e; false', exit: 1 },
          { command: 'echo hi;', exit: 0 },
        ];
        for (const { command, exit } of cases) {
          const tempFilePath = join(dir, 'pgrep.tmp');
          const generated = buildCommandToExecute(command, false, tempFilePath);
          const { status } = runInBash(generated, dir);
          expect(status).toBe(exit);
          rmSync(tempFilePath, { force: true });
        }
      });
    });
  },
);

// REQ-2980-2: the pgrep temp-file path must be literal shell data, quoted with
// singleQuoteForShell so command substitution never runs.
describe.skipIf(isWindows)(
  'buildCommandToExecute quotes hostile temp-file paths',
  () => {
    it('creates the exact literal path with spaces, an apostrophe, and $()', async () => {
      await withTempDir(async (dir) => {
        const tempFilePath = join(dir, "hostile's $(echo INJECTED).txt");
        const generated = buildCommandToExecute(
          'echo body',
          false,
          tempFilePath,
        );
        const { status } = runInBash(generated, dir);
        expect(status).toBe(0);
        expect(existsSync(tempFilePath)).toBe(true);
        // Command substitution must not have run, so the expanded name does
        // not exist.
        expect(existsSync(join(dir, "hostile's INJECTED.txt"))).toBe(false);
      });
    });

    it('records the literal quoted path content via the trap redirect', async () => {
      await withTempDir(async (dir) => {
        const tempFilePath = join(dir, 'plain.tmp');
        const generated = buildCommandToExecute(
          'printf data',
          false,
          tempFilePath,
        );
        runInBash(generated, dir);
        // The redirect target is literal; the file exists even though pgrep
        // may write nothing depending on the host process-group layout.
        expect(existsSync(tempFilePath)).toBe(true);
        expect(typeof readFileSync(tempFilePath, 'utf8')).toBe('string');
      });
    });

    it('creates the exact literal path when the temp path contains a literal newline', async () => {
      await withTempDir(async (dir) => {
        const newline = String.fromCharCode(10);
        const tempFilePath = join(dir, `before${newline}after.tmp`);
        const generated = buildCommandToExecute(
          'echo body',
          false,
          tempFilePath,
        );
        const { status } = runInBash(generated, dir);
        expect(status).toBe(0);
        expect(existsSync(tempFilePath)).toBe(true);
      });
    });
  },
);

// REQ-2980-3: the standalone adapter must unwrap the generated form back to the
// trimmed body (including a caller-supplied trailing semicolon and heredoc),
// and must not rewrite anything that is not the generated form.
describe('standalone adapter unwraps the generated wrapper', () => {
  function recordingService(sink: {
    command?: string;
  }): IShellExecutionService {
    return {
      execute: async (command: string): Promise<ShellResult> => {
        sink.command = command;
        return { stdout: '', stderr: '', exitCode: 0, aborted: false };
      },
      isCommandAllowed: () => true,
    };
  }

  async function delegatedCommand(
    command: string,
  ): Promise<string | undefined> {
    const sink: { command?: string } = {};
    const host = createShellToolHostFromExecutionService(
      recordingService(sink),
    );
    await host.executeShellCommand(
      command,
      process.cwd(),
      () => undefined,
      new AbortController().signal,
    );
    return sink.command;
  }

  it('round-trips a plain trimmed body', async () => {
    const wrapped = buildCommandToExecute(
      'echo hi',
      false,
      '/tmp/whatever.tmp',
    );
    expect(await delegatedCommand(wrapped)).toBe('echo hi');
  });

  it('preserves a caller-supplied trailing semicolon', async () => {
    const wrapped = buildCommandToExecute(
      'echo hi;',
      false,
      '/tmp/whatever.tmp',
    );
    expect(await delegatedCommand(wrapped)).toBe('echo hi;');
  });

  it('round-trips a multiline heredoc body verbatim', async () => {
    const body = 'cat <<EOF\nhello\nEOF';
    const wrapped = buildCommandToExecute(body, false, '/tmp/whatever.tmp');
    expect(await delegatedCommand(wrapped)).toBe(body);
  });

  it('unwraps a wrapper whose temp path contains apostrophes, $(), and spaces', async () => {
    const hostilePath = "/tmp/hostile's $(echo INJECTED) dir/x.tmp";
    const wrapped = buildCommandToExecute('echo body', false, hostilePath);
    expect(await delegatedCommand(wrapped)).toBe('echo body');
  });

  it('unwraps a wrapper whose temp path contains a literal newline', async () => {
    const newline = String.fromCharCode(10);
    const newlinePath = `/tmp/before${newline}after.tmp`;
    const wrapped = buildCommandToExecute('echo body', false, newlinePath);
    expect(await delegatedCommand(wrapped)).toBe('echo body');
  });

  it('does not unwrap an arbitrary trap that merely shares the action prefix/suffix', async () => {
    const arbitrary =
      "trap '__code=$?; pgrep -g 0 >FAKE 2>&1; exit $__code' EXIT\nmalicious";
    expect(await delegatedCommand(arbitrary)).toBe(arbitrary);
  });

  it('does not unwrap a trap whose action has extra content after the path token', async () => {
    // Same prefix/suffix and a valid canonical path token as the generated
    // action, but with trailing content the generated form never contains. The
    // path slot must be EXACTLY one canonical token, so this must pass through.
    const actionWithExtra =
      '__code=$?; pgrep -g 0 >' +
      singleQuoteForShell('/tmp/x') +
      ' EVIL 2>&1; exit $__code';
    const malicious = `trap ${singleQuoteForShell(actionWithExtra)} EXIT\nmalicious`;
    expect(await delegatedCommand(malicious)).toBe(malicious);
  });

  it('does not rewrite an input that is not the generated wrapper form', async () => {
    expect(await delegatedCommand('echo plain')).toBe('echo plain');
    expect(await delegatedCommand('trap custom EXIT\necho x')).toBe(
      'trap custom EXIT\necho x',
    );
  });
});

// REQ-2980-3: Windows execution remains a byte-identical pass-through.
describe('buildCommandToExecute Windows pass-through', () => {
  it('returns the command unchanged when isWindows is true', () => {
    const command = "Write-Output 'hello world'";
    expect(buildCommandToExecute(command, true, '/unused')).toBe(command);
  });
});
