/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pre-run reaping of stale orphaned `bun test` processes, extracted from
 * `scripts/run_bun_tests.ts` (which re-exports `reapStaleBunTestProcesses`
 * so its public import surface is unchanged).
 */

/** Basenames the reaper accepts as the bun executable. */
const BUN_BASENAMES: ReadonlySet<string> = new Set(['bun', 'bun.exe']);

/**
 * Whether a path token names the bun binary itself: its basename must be
 * `bun`, or `bun.exe` (the name the bundled runtime ships under).
 */
function isBunToken(token: string): boolean {
  const basename = token.split('/').pop() ?? '';
  return BUN_BASENAMES.has(basename);
}

/**
 * Detects and kills stale orphaned `bun test` processes (PPID=1) before
 * starting a new run. When a parent test runner is killed (e.g. by OOM),
 * child `bun test` processes reparent to PID 1 and keep spinning
 * indefinitely — consuming CPU and memory. This guard prevents that
 * accumulation by reaping orphans at the start of every run.
 *
 * The executable identity comes from two independent `ps` captures,
 * because the argument string alone is not trustworthy: `ps -eo args=`
 * renders argv as a display string without quoting, so a session prompt
 * that mentions a path ending in `/bun` followed by the word `test` is
 * indistinguishable from a real `<bun> test` argv. That exact shape reaped
 * the sandboxed CLI under `podman --init` (PPID 1, argv starting with
 * `node`, the word `test` riding in the prompt) and killed the session
 * mid-task with a silent status-0 exit (#3491). `ps -eo pid=,comm=`
 * reports the binary independently of argv — macOS prints the full
 * executable path, where the llxprt shim shows as `node`; Linux prints
 * the base command name — so no prompt content can forge it.
 *
 * A candidate is reaped only when every check holds:
 *
 * - `ppid === 1` and `pid !== ownPid` (an orphan, never this process)
 * - the basename of that pid's `comm` is `bun` or `bun.exe` — this alone
 *   excludes the CLI shim, whose comm is `node`, no matter what the
 *   prompt says
 * - in `args`, the token immediately after the FIRST token whose basename
 *   is `bun` or `bun.exe` is exactly `test`, the exact argv shape this
 *   runner spawns (`buildSpawnArgs`: `<bun-executable> test [flags...]
 *   <file>`). Anchoring on the bun-basename token rather than token 0
 *   keeps executables whose paths contain spaces reaped, because `ps
 *   args=` renders those unquoted. A path whose interior directory
 *   segment itself ends in `bun` fails to match and is simply not reaped;
 *   failing closed there is correct.
 *
 * Exposed as a standalone function for testability.
 */
function isOrphanedTestProcess(
  ppid: number,
  pid: number,
  args: string,
  executable: string | undefined,
  ownPid: number,
): boolean {
  if (ppid !== 1 || pid === ownPid) return false;
  if (executable === undefined || !isBunToken(executable)) return false;
  const tokens = args.trim().split(/\s+/);
  const bunIndex = tokens.findIndex((token) => isBunToken(token));
  if (bunIndex < 0) return false;
  return tokens[bunIndex + 1] === 'test';
}

export function reapStaleBunTestProcesses(
  spawnSync: (cmd: readonly string[]) => { stdout: string | null },
  kill: (pid: number, signal: string) => void,
  ownPid: number,
  stderr?: (line: string) => void,
): number {
  let commOutput: string;
  let output: string;
  try {
    commOutput = spawnSync(['ps', '-eo', 'pid=,comm=']).stdout ?? '';
    output = spawnSync(['ps', '-eo', 'pid=,ppid=,args=']).stdout ?? '';
  } catch {
    return 0;
  }

  // The comm table maps each pid to its kernel-reported executable. comm
  // is the last field, so a line is a pid followed by the rest of the
  // line; that keeps a macOS full executable path containing spaces
  // intact. Linux reports only the base command name, which the basename
  // check handles identically.
  const executables = new Map<number, string>();
  for (const line of commOutput.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[0] ?? '', 10);
    if (Number.isFinite(pid)) {
      executables.set(pid, parts.slice(1).join(' '));
    }
  }

  let killed = 0;
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[0] ?? '', 10);
    const ppid = parseInt(parts[1] ?? '', 10);
    const args = parts.slice(2).join(' ');
    if (
      Number.isFinite(pid) &&
      Number.isFinite(ppid) &&
      isOrphanedTestProcess(ppid, pid, args, executables.get(pid), ownPid)
    ) {
      try {
        kill(pid, 'SIGTERM');
        killed++;
      } catch {
        // Process may have already exited
      }
    }
  }

  if (killed > 0 && stderr) {
    stderr(
      `[run_bun_tests] Reaped ${killed} stale orphaned test process(es) (PPID=1) before run.`,
    );
  }
  return killed;
}
