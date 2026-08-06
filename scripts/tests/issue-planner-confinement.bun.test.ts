/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Bun-native regression tests for the issue-planner filesystem-confinement
// step (issue #2960). The confinement `find` previously did not prune
// symlinks; because a symlink's own mode is always lrwxrwxrwx on Linux (and
// chmod without -h cannot change it), `bun install`-materialized symlinks
// false-positived the writable check and failed every issues-triggered run.
// These run under Bun's native runner via the scripts-tests root (see
// scripts/bun-test-manifest.ts).
//
// The textual suite guards the regression marker on hosts without bash; the
// behavioral suite runs the actual confinement script under a POSIX shell.

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  asString,
  findStep,
  parseWorkflowYaml,
  workflowJob,
} from './typed-test-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_PATH = '.github/workflows/issue-planner.yml';
const CONFINEMENT_STEP = 'Confine filesystem for planner agent';

function loadConfinementScript(): string {
  const source = fs.readFileSync(path.join(ROOT, WORKFLOW_PATH), 'utf8');
  const workflow = parseWorkflowYaml(source);
  const planJob = workflowJob(workflow, 'plan');
  const step = findStep(planJob, CONFINEMENT_STEP);
  if (!step) {
    throw new Error(
      `Confinement step "${CONFINEMENT_STEP}" not found in ${WORKFLOW_PATH}; the step may have been renamed. Update CONFINEMENT_STEP to match.`,
    );
  }
  return asString(step.run);
}

/**
 * Lazily detect a POSIX `bash` with GNU find/chmod. Cached so detection runs
 * at most once per process (not as a bare import-time side effect).
 */
let detectedBash: string | null | undefined;
function detectBash(): string | null {
  if (detectedBash !== undefined) return detectedBash;
  try {
    const result = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
    detectedBash =
      result.status === 0 && result.stdout.trim() === 'ok' ? 'bash' : null;
  } catch {
    detectedBash = null;
  }
  return detectedBash;
}

/**
 * Register a behavioral test that runs only under bash, otherwise skip.
 * Centralizes platform gating so the suite never fails on a missing shell
 * (e.g. Windows). Temp-dir setup/teardown is owned here so every test cleans
 * up via a single finally.
 */
function bashOnly(name: string, fn: (dir: string) => void): void {
  if (!detectBash()) {
    it.skip(`${name} (requires bash)`, () => {});
    return;
  }
  it(name, () => {
    const dir = makeTempDir('planner-confinement-');
    try {
      fn(dir);
    } finally {
      removeTempDir(dir);
    }
  });
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Recursively restore write bits so rmSync can delete a read-only tree. Best
 * effort: a chmod failure is swallowed so one stuck entry never prevents the
 * directory (and its siblings) from being removed.
 */
function restoreWriteBits(root: string): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) restoreWriteBits(target);
    if (!entry.isSymbolicLink()) {
      try {
        fs.chmodSync(target, entry.isDirectory() ? 0o700 : 0o600);
      } catch {
        /* best-effort cleanup; rmSync still runs */
      }
    }
  }
  try {
    fs.chmodSync(root, 0o700);
  } catch {
    /* best-effort cleanup; rmSync still runs */
  }
}

function removeTempDir(dir: string): void {
  try {
    restoreWriteBits(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    // Best-effort cleanup: surface the failure so it is visible, but never
    // re-throw — a cleanup error thrown from `finally` would mask the real
    // assertion failure. rmSync(force) already tolerates a missing path.
    console.warn(`temp cleanup failed for ${dir}:`, error);
  }
}

describe('issue-planner confinement script (textual)', () => {
  const script = loadConfinementScript();

  it('prunes symlinks in the confinement logic', () => {
    // Whitespace-tolerant: counts `type l` occurrences regardless of line
    // breaks, added comments, or spacing. At least two means both the chmod
    // pass and the writable-verification pass exclude symlinks.
    const matches = script.match(/type\s+l/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('still enforces confinement: keeps -prune, remaining_writable, and no suppression', () => {
    expect(script).toContain('-prune');
    expect(script).toContain('remaining_writable');
    expect(script).toContain('chmod u+w planner');
    expect(script).not.toContain('|| true');
    expect(script).not.toContain('2>/dev/null');
  });

  it('still checks for writable real files (symlink prune did not drop detection)', () => {
    // The symlink prune must not remove the writable-bit detection itself.
    expect(script).toContain('-perm -u=w');
    expect(script).toContain('-perm -g=w');
    expect(script).toContain('-perm -o=w');
  });
});

describe('issue-planner confinement script (behavioral)', () => {
  bashOnly(
    'passes when node_modules contains a symlink (regression for #2960)',
    (dir) => {
      fs.mkdirSync(path.join(dir, '.git'));
      fs.mkdirSync(path.join(dir, 'planner'));
      fs.mkdirSync(path.join(dir, 'src', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'nested', 'code.js'), 'code');
      fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', 'real-cli'), 'cli');
      fs.symlinkSync(
        path.join(dir, 'node_modules', 'real-cli'),
        path.join(dir, 'node_modules', '.bin', 'llxprt'),
      );

      const script = loadConfinementScript();
      const result = spawnSync('bash', ['-c', script], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(result.status, String(result.stderr ?? '')).toBe(0);
      // The real source file was made read-only.
      expect(
        fs.statSync(path.join(dir, 'src', 'nested', 'code.js')).mode & 0o222,
      ).toBe(0);
      // planner/ and .git/ remain owner-writable (pruned from the chmod pass).
      expect(fs.statSync(path.join(dir, 'planner')).mode & 0o200).toBe(0o200);
      expect(fs.statSync(path.join(dir, '.git')).mode & 0o200).toBe(0o200);
    },
  );
});
