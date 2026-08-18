/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-platform memory regression for ast_edit preview/apply (issue #3242).
 *
 * Spawns a child Bun process (ast-edit-3242-memory-child.ts) that executes
 * the REAL ASTEditTool against a generated Git workspace shaped like the
 * incident: the ~5,250-line, 184-declaration Rust target plus 1,500
 * committed dependency files referencing the prioritizable worker symbols,
 * a git-ignored source tree, and one oversized (~2 MiB) source file. The
 * child runs three localized previews (middle, head, tail) and an immediate
 * force=true apply that reuses the preview timestamp, conservatively
 * sampling peak RSS throughout, then samples a post-result quiet window to
 * prove no repository traversal or pending native callback kept allocating
 * after every tool result resolved. The old wiring started five concurrent
 * whole-workspace native findInFiles traversals per preview that ignored
 * .gitignore and could not be cancelled; this test is the permanent
 * conservative memory ceiling and drain gate on every platform.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  generateIssue3242CanaryWorkspace,
  generateIssue3242Workspace,
} from './ast-edit-3242-fixtures.js';

const PEAK_RSS_CEILING_BYTES = 768 * 1024 * 1024; // 768 MiB
/** Post-result tail growth must stay below this margin. */
const POST_RESULT_TAIL_CEILING_BYTES = 64 * 1024 * 1024; // 64 MiB
const CHILD_TIMEOUT_MS = 180_000;

interface MemoryReport {
  readonly ok: boolean;
  readonly previewOk: boolean;
  readonly applyOk: boolean;
  readonly contentApplied: boolean;
  readonly previewBoundedMarker: boolean;
  readonly timestampParsed: boolean;
  readonly peakRssBytes: number;
  readonly finalRssBytes: number;
  readonly postResultRssGrowthBytes: number;
  readonly quietWindowSamples: number;
}

const REPORT_BOOLEAN_FIELDS = [
  'ok',
  'previewOk',
  'applyOk',
  'contentApplied',
  'previewBoundedMarker',
  'timestampParsed',
] as const;
const REPORT_NUMBER_FIELDS = [
  'peakRssBytes',
  'finalRssBytes',
  'postResultRssGrowthBytes',
  'quietWindowSamples',
] as const;

function isMemoryReport(value: unknown): value is MemoryReport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const hasBooleans = REPORT_BOOLEAN_FIELDS.every(
    (key) => typeof record[key] === 'boolean',
  );
  const hasNumbers = REPORT_NUMBER_FIELDS.every(
    (key) => typeof record[key] === 'number',
  );
  return hasBooleans && hasNumbers;
}

function parseReport(stdout: string): MemoryReport {
  const marker = 'AST_EDIT_MEMORY_REPORT ';
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
  new URL('./ast-edit-3242-memory-child.ts', import.meta.url),
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

describe('REQ-3242-4: ast_edit preview/apply memory regression', () => {
  it('keeps peak RSS bounded and drains after real previews and a force apply', () => {
    const workspace = generateIssue3242Workspace();
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
      if (child.status !== 0) {
        throw new Error(describeChildFailure(child));
      }
      // The child must emit both markers, proving every tool result and the
      // quiet window ran.
      expect(child.stdout).toContain('AST_EDIT_TOOL_RESULT');
      expect(child.stdout).toContain('AST_EDIT_APPLY_RESULT');
      expect(child.stdout).toContain('AST_EDIT_QUIET_DONE');
      const report = parseReport(child.stdout);

      expect(report.ok).toBe(true);
      expect(report.previewOk).toBe(true);
      expect(report.applyOk).toBe(true);
      expect(report.contentApplied).toBe(true);
      expect(report.previewBoundedMarker).toBe(true);
      expect(report.timestampParsed).toBe(true);
      expect(report.peakRssBytes).toBeGreaterThan(0);
      expect(report.peakRssBytes).toBeLessThan(PEAK_RSS_CEILING_BYTES);
      expect(report.finalRssBytes).toBeLessThan(PEAK_RSS_CEILING_BYTES);
      // The post-result quiet window proves native traversal drained: RSS
      // growth after all tool results resolved stays below the calibrated
      // ceiling. The old code's abandoned fan-out kept allocating here.
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
// REQ-3242-1: invocation-wiring canary.
//
// ast_edit preview opts out of both repository collection and working-set
// collection, so a real preview followed by a real apply must spawn ZERO
// Git processes — neither the repository relationship phase (remote
// get-url origin, rev-parse HEAD, branch --show-current) nor working-set
// discovery (status/diff/ls-files listings). A PATH shim records every Git
// argv the real tool spawns, so a regression back to either the old
// `collectRepositoryContext: true` wiring or working-set collection is
// detected deterministically — no memory threshold involved.
// ---------------------------------------------------------------------------

describe('REQ-3242-1: ast_edit preview repository wiring canary', () => {
  // Windows resolves `git` through a .cmd shim that Node cannot spawn without
  // a shell, so the PATH interception technique is POSIX-only there.
  it.skipIf(process.platform === 'win32')(
    'spawns no Git commands at all during real preview and apply',
    () => {
      const { spyRoot, workspace } = generateIssue3242CanaryWorkspace();
      const shimDir = mkdtempSync(join(tmpdir(), 'llxprt-3242-shim-'));
      try {
        const resolved = spawnSync('sh', ['-c', 'command -v git'], {
          encoding: 'utf-8',
        });
        const realGit = resolved.stdout.trim();
        if (resolved.status !== 0 || realGit === '') {
          throw new Error(
            `could not resolve real git for the shim (status=${String(
              resolved.status,
            )})`,
          );
        }
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
              PATH: `${shimDir}:${process.env.PATH ?? ''}`,
            },
          },
        );
        if (child.status !== 0) {
          throw new Error(describeChildFailure(child));
        }
        // The child exercised the full preview-then-apply success path where
        // the old wiring would have spawned the repository phase.
        const report = parseReport(child.stdout);
        expect(report.ok).toBe(true);

        const invocations = existsSync(logPath)
          ? readFileSync(logPath, 'utf-8')
              .split('\n')
              .filter((line) => line.length > 0)
              .map((line) => stripGitDirPrefix(line, workspace))
          : [];
        // Zero Git invocations of any kind: preview opts out of repository
        // relationship collection AND working-set discovery, and apply never
        // collects enhanced context, so any logged argv — repository
        // subcommand or working-set listing alike — is a wiring regression.
        expect(invocations).toEqual([]);
      } finally {
        rmSync(spyRoot, { recursive: true, force: true });
        rmSync(shimDir, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
