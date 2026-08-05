/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

interface RootPackageJson {
  readonly scripts: Record<string, string>;
}

function rootScripts(): Record<string, string> {
  const raw = readFileSync(join(ROOT, 'package.json'), 'utf8');
  return (JSON.parse(raw) as RootPackageJson).scripts;
}

const EVAL_SCRIPTS = ['test:always_passing_evals', 'test:all_evals'] as const;

function jsonReportPath(command: string): string {
  const match = /--json-report\s+(\S+)/.exec(command);
  expect(match, `expected --json-report in: ${command}`).not.toBeNull();
  return match![1];
}

/**
 * Issue #2605: the uploaded artifact directory is `evals/logs`. The report path
 * is resolved by `scripts/run_bun_tests.ts` against the directory the command
 * is invoked from — the repository root — so it must be repo-root relative.
 * A path relative to the `evals` root (as the old Vitest config used) would
 * land at `evals/evals/logs/report.json` and escape the artifact.
 */
describe('eval JSON report path', () => {
  for (const scriptName of EVAL_SCRIPTS) {
    it(`resolves report.json to evals/logs/report.json for ${scriptName}`, () => {
      const command = rootScripts()[scriptName];
      expect(command, `${scriptName} must exist`).toBeDefined();

      const configured = jsonReportPath(command);
      expect(isAbsolute(configured), `${configured} must be relative`).toBe(
        false,
      );

      // Simulate the runner resolving the path against its invocation dir.
      const resolved = normalize(join(ROOT, configured));
      expect(resolved).toBe(
        normalize(join(ROOT, 'evals', 'logs', 'report.json')),
      );
    });

    it(`runs the evals root under the Bun-native runner for ${scriptName}`, () => {
      const command = rootScripts()[scriptName];
      expect(command).toContain('run_bun_tests.ts');
      expect(command).toContain('--root evals');
    });
  }
});
