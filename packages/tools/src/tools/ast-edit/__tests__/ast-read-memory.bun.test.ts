/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-platform memory regression for ast_read_file (issue #3232).
 *
 * Spawns a child Bun process (ast-read-memory-child.ts) that executes the
 * REAL ASTReadFileTool against a generated Git workspace whose committed
 * dependency files reference every prioritizable target symbol — the fixture
 * shape that previously triggered five concurrent whole-workspace native
 * findInFiles traversals per read. The child conservatively samples peak RSS
 * while one sequential and three parallel reads execute, then samples a
 * post-result quiet window to prove no native traversal or pending callback
 * kept the process alive after all tool results resolved.
 *
 * The old repository fan-out is unobservable from tool output by design, so
 * the distinguishing behavioral evidence lives in the bounded-acquisition
 * suite; this test is the permanent conservative memory ceiling and drain
 * gate on both Windows and non-Windows paths.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { gitCheck, gitInit } from './ast-read-git-fixtures.js';

function textOrEmpty(value: string | null | undefined): string {
  return value ?? '';
}

const PEAK_RSS_CEILING_BYTES = 768 * 1024 * 1024; // 768 MiB
/** Post-result tail growth must stay below this margin. */
const POST_RESULT_TAIL_CEILING_BYTES = 64 * 1024 * 1024; // 64 MiB
/**
 * Fixture size calibrated so the former repository fan-out (five concurrent
 * native findInFiles traversals per read, three parallel reads) exceeds the
 * peak-RSS ceiling by a wide margin — the old wiring measured ~2.5 GiB peak —
 * while the bounded opt-out path stays well under 300 MiB. This gives concrete
 * RED evidence against the old wiring without approaching a destructive
 * multi-gigabyte workload.
 */
const DEP_FILE_COUNT = 1500;
const REFERENCE_LINES_PER_FILE = 60;
const WORKING_SET_MODIFIED_FILES = 30;
const CHILD_TIMEOUT_MS = 180_000;

interface MemoryReport {
  readonly ok: boolean;
  readonly sequentialOk: boolean;
  readonly parallelOk: boolean;
  readonly llmHasWorkingSet: boolean;
  readonly peakRssBytes: number;
  readonly finalRssBytes: number;
  readonly postResultRssGrowthBytes: number;
  readonly quietWindowSamples: number;
}

function isMemoryReport(value: unknown): value is MemoryReport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.ok !== 'boolean' ||
    typeof record.sequentialOk !== 'boolean' ||
    typeof record.parallelOk !== 'boolean'
  ) {
    return false;
  }
  if (
    typeof record.llmHasWorkingSet !== 'boolean' ||
    typeof record.peakRssBytes !== 'number'
  ) {
    return false;
  }
  return (
    typeof record.finalRssBytes === 'number' &&
    typeof record.postResultRssGrowthBytes === 'number' &&
    typeof record.quietWindowSamples === 'number'
  );
}

// The checked Git fixture wrappers come from the shared bun-test-free
// module (gitCheck/gitInit/gitCommitAll): a generation failure fails loudly
// with full status/signal/stderr reporting instead of producing a silently
// broken fixture.

function symbolNames(): string[] {
  return [
    'AlphaService',
    'BetaRegistry',
    'GammaFactory',
    'DeltaHandler',
    'EpsilonStore',
    'ZetaWorker',
  ];
}

function depFileContent(symbols: string[]): string {
  const lines: string[] = [];
  for (let i = 0; i < REFERENCE_LINES_PER_FILE; i++) {
    const symbol = symbols[i % symbols.length];
    lines.push(
      `export const ref${i} = ${symbol}.instance${i} + ${symbol}.counter;`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function targetFileContent(symbols: string[]): string {
  const blocks = symbols.map(
    (symbol, index) =>
      `export class ${symbol} {\n  public static instance${index}: number = ${index};\n  public static counter: number = ${index};\n  public process(input: string): string {\n    return input;\n  }\n}\n`,
  );
  return `// Target fixture for the ast_read_file memory regression.\n${blocks.join('\n')}\nexport function regressionEntry(): void {}\n`;
}

function generateWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-3232-mem-'));
  try {
    gitInit(dir);

    const symbols = symbolNames();
    const depsDir = join(dir, 'deps');
    mkdirSync(depsDir, { recursive: true });
    for (let i = 0; i < DEP_FILE_COUNT; i++) {
      writeFileSync(
        join(depsDir, `dep${String(i).padStart(3, '0')}.ts`),
        depFileContent(symbols),
        'utf-8',
      );
    }
    writeFileSync(join(dir, 'target.ts'), targetFileContent(symbols), 'utf-8');
    gitCheck(dir, ['add', '.']);
    gitCheck(dir, ['commit', '-m', 'fixture']);

    // Working set: unstaged modifications of tracked dependency files, all
    // referencing target symbols, so bounded discovery has real candidates.
    for (let i = 0; i < WORKING_SET_MODIFIED_FILES; i++) {
      const depPath = join(depsDir, `dep${String(i).padStart(3, '0')}.ts`);
      writeFileSync(
        depPath,
        `${depFileContent(symbols)}export const modified${i} = true;\n`,
        'utf-8',
      );
    }
    return dir;
  } catch (error) {
    // A half-generated workspace must never leak into the temp directory.
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function parseReport(stdout: string): MemoryReport {
  const marker = 'AST_READ_MEMORY_REPORT ';
  const line = stdout
    .split('\n')
    .find((candidate) => candidate.startsWith(marker));
  if (!line) {
    throw new Error(`child did not emit a report: ${stdout.slice(-2000)}`);
  }
  const parsed: unknown = JSON.parse(line.slice(marker.length));
  if (!isMemoryReport(parsed)) {
    throw new Error(
      `child report failed schema guard: ${line.slice(marker.length)}`,
    );
  }
  return parsed;
}

const CHILD_SCRIPT_PATH = fileURLToPath(
  new URL('./ast-read-memory-child.ts', import.meta.url),
);

/** Render every failure mode of a memory-child run for loud diagnostics. */
function describeChildFailure(child: SpawnSyncReturns<string>): string {
  const details = [
    `status=${String(child.status)}`,
    `signal=${String(child.signal)}`,
    `error=${child.error instanceof Error ? child.error.message : String(child.error)}`,
    `stderr=${String(child.stderr).slice(0, 2000)}`,
  ];
  return `memory child failed (${details.join('; ')})`;
}

function requireSuccessfulChild(child: SpawnSyncReturns<string>): void {
  if (child.status !== 0) {
    throw new Error(describeChildFailure(child));
  }
}

function resolveGitExecutable(): string {
  const resolved = spawnSync('sh', ['-c', 'command -v git'], {
    encoding: 'utf-8',
  });
  const realGit = resolved.stdout.trim();
  if (resolved.status !== 0 || realGit === '') {
    throw new Error(
      `could not resolve real git for the shim (status=${String(resolved.status)})`,
    );
  }
  return realGit;
}

function readGitInvocations(logPath: string, workspace: string): string[] {
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => stripGitDirPrefix(line, workspace));
}

/**
 * Drop the leading `-C <workspace>` argv pair from a logged Git invocation
 * so the subcommand itself is comparable. The literal known prefix is
 * stripped (rather than splitting on spaces) so a workspace path containing
 * spaces cannot corrupt the remaining subcommand text.
 */
function stripGitDirPrefix(line: string, workspace: string): string {
  const prefix = `-C ${workspace} `;
  return line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

describe('REQ-3232-5: ast_read_file memory regression', () => {
  it('keeps peak RSS bounded and drains after real reads of a fanned-out workspace', () => {
    const workspace = generateWorkspace();
    try {
      const child = spawnSync(
        process.execPath,
        [CHILD_SCRIPT_PATH, workspace],
        {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: CHILD_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      // Report the full spawn outcome before asserting so a failed child is
      // diagnosable from the test log rather than a bare "expected 0".
      requireSuccessfulChild(child);
      // The child must emit both markers, proving the quiet window ran.
      expect(child.stdout).toContain('AST_READ_TOOL_RESULT');
      expect(child.stdout).toContain('AST_READ_QUIET_DONE');
      const report = parseReport(child.stdout);

      expect(report.ok).toBe(true);
      expect(report.sequentialOk).toBe(true);
      expect(report.parallelOk).toBe(true);
      expect(report.llmHasWorkingSet).toBe(true);
      expect(report.peakRssBytes).toBeGreaterThan(0);
      expect(report.peakRssBytes).toBeLessThan(PEAK_RSS_CEILING_BYTES);
      expect(report.finalRssBytes).toBeLessThan(PEAK_RSS_CEILING_BYTES);
      // The post-result quiet window proves native traversal drained: RSS
      // growth after all tool results resolved stays below the calibrated
      // ceiling. The old code's fan-out kept allocating past the result.
      expect(report.quietWindowSamples).toBeGreaterThan(0);
      expect(report.postResultRssGrowthBytes).toBeLessThan(
        POST_RESULT_TAIL_CEILING_BYTES,
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 240_000);
});

// ---------------------------------------------------------------------------
// REQ-3232-5: invocation-wiring canary.
//
// The bounded working-set phase issues `rev-parse --is-inside-work-tree`,
// `rev-parse --verify --quiet HEAD`, `diff`, and `log`. Only the repository
// relationship phase issues `remote get-url origin` and
// `branch --show-current`. A PATH shim records every Git argv the real tool
// spawns during a read, so a regression back to the old
// `collectRepositoryContext: true` wiring is detected deterministically —
// no memory threshold involved.
// ---------------------------------------------------------------------------

describe('REQ-3232-5: ast_read_file repository wiring canary', () => {
  // Windows resolves `git` through a .cmd shim that Node cannot spawn without
  // a shell, so the PATH interception technique is POSIX-only there.

  describe.skipIf(process.platform === 'win32')(
    'POSIX Git invocation interception',
    () => {
      it('spawns no repository-relationship Git commands during a real read', () => {
        const spyRoot = mkdtempSync(join(tmpdir(), 'llxprt-3232-spy-'));
        const shimDir = mkdtempSync(join(tmpdir(), 'llxprt-3232-shim-'));
        // A workspace directory whose name contains spaces exercises the real
        // canary against the path shape that defeats space-splitting parsers.
        const workspace = join(spyRoot, 'work space');
        try {
          mkdirSync(workspace, { recursive: true });
          gitInit(workspace);
          writeFileSync(
            join(workspace, 'dep.ts'),
            'export const ref0 = Alpha.counter;\n',
            'utf-8',
          );
          gitCheck(workspace, ['add', '-A']);
          gitCheck(workspace, ['commit', '-m', 'fixture']);
          writeFileSync(
            join(workspace, 'ws.ts'),
            'export const modified = true;\n',
            'utf-8',
          );
          writeFileSync(
            join(workspace, 'target.ts'),
            'export class Alpha {\n  public static counter: number = 1;\n}\n',
            'utf-8',
          );

          const realGit = resolveGitExecutable();
          const logPath = join(shimDir, 'git-invocations.log');
          writeFileSync(
            join(shimDir, 'git'),
            [
              '#!/bin/sh',
              `printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}`,
              `exec ${JSON.stringify(realGit)} "$@"`,
              '',
            ].join('\n'),
            { mode: 0o755 },
          );

          const child = spawnSync(
            process.execPath,
            [CHILD_SCRIPT_PATH, workspace],
            {
              encoding: 'utf-8',
              stdio: 'pipe',
              timeout: CHILD_TIMEOUT_MS,
              maxBuffer: 16 * 1024 * 1024,
              env: {
                ...process.env,
                PATH: `${shimDir}:${textOrEmpty(process.env.PATH)}`,
              },
            },
          );
          requireSuccessfulChild(child);
          const invocations = readGitInvocations(logPath, workspace);
          // The read genuinely used Git (bounded discovery ran) ...
          expect(invocations.length).toBeGreaterThan(0);
          // ... and the exact `-C <workspace> ` prefix stripped cleanly even
          // with the spaced path: the logged subcommands parse intact.
          expect(
            invocations.some((line) => line.startsWith('rev-parse ')),
          ).toBe(true);
          expect(invocations.some((line) => line.startsWith('diff '))).toBe(
            true,
          );
          // ... but never the repository-relationship subcommands.
          expect(invocations.some((line) => line.startsWith('remote '))).toBe(
            false,
          );
          expect(invocations.some((line) => line.startsWith('branch '))).toBe(
            false,
          );
        } finally {
          rmSync(spyRoot, { recursive: true, force: true });
          rmSync(shimDir, { recursive: true, force: true });
        }
      }, 240_000);
    },
  );
});
