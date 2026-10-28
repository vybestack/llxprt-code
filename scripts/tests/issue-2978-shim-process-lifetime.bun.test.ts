/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3911: the shim fixture must be removable as soon as `runShim`
 * returns. The shim exits only after its Bun child has exited, and no
 * launched process may hold the fixture root as its working directory,
 * because Windows refuses to remove a directory that a terminating process
 * still has open.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  makeLayout,
  placeBundledBun,
  runShim,
  writeSourceEntry,
} from './issue-2978-node-shim-helpers.ts';

interface ChildReport {
  readonly pid: number;
  readonly cwd: string;
}

function isChildReport(value: unknown): value is ChildReport {
  if (typeof value !== 'object' || value === null) return false;
  const { pid, cwd } = value as Record<string, unknown>;
  return typeof pid === 'number' && typeof cwd === 'string';
}

function readChildReport(reportPath: string): ChildReport {
  const report: unknown = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (!isChildReport(report)) {
    throw new Error(`Unexpected child report: ${JSON.stringify(report)}`);
  }
  return report;
}

function isInside(root: string, candidate: string): boolean {
  const relation = path.relative(realpathSync(root), realpathSync(candidate));
  return !relation.startsWith('..') && !path.isAbsolute(relation);
}

describe('packages/cli/bin/llxprt.mjs process lifetime (issue #3911)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'llxprt-shim-lifetime-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns only after the Bun child is gone, with no process working directory inside the fixture', () => {
    const layout = makeLayout(tempDir);
    placeBundledBun(layout.nodeModules);
    const reportPath = path.join(layout.root, 'child-report.json');
    writeSourceEntry(
      layout.pkgRoot,
      'import { writeFileSync } from "node:fs";' +
        `writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));`,
    );

    const result = runShim(layout);

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    const report = readChildReport(reportPath);
    expect(() => process.kill(report.pid, 0)).toThrow();
    expect(isInside(layout.root, report.cwd)).toBe(false);
  });
});
