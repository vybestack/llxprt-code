/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * Shared loader for the evals vitest config module so the import/normalization
 * is defined once. Both tests below assert different properties of the same
 * loaded config.
 */
async function loadEvalsVitestConfig() {
  const configUrl = pathToFileURL(join(ROOT, 'evals/vitest.config.ts')).href;
  const mod = await import(configUrl);
  return mod.default;
}

/**
 * Issue #2605: When Vitest runs with `--root ./evals` (as package.json's
 * test:all_evals / test:always_passing_evals scripts do), the JSON reporter's
 * outputFile is resolved relative to that root. The config previously pinned
 * `evals/logs/report.json`, which produced `evals/evals/logs/report.json` and
 * left the uploaded `evals/logs` artifact empty.
 *
 * This test loads the real config module, simulates how vitest resolves the
 * outputFile against the evals root, and asserts report.json lands at
 * evals/logs/report.json so it is captured by the uploaded artifact.
 */
describe('evals/vitest.config.ts JSON report path under --root ./evals', () => {
  it('resolves report.json to evals/logs/report.json when run under the evals root', async () => {
    const config = await loadEvalsVitestConfig();

    const outputFile = config?.test?.outputFile?.json;
    expect(
      outputFile,
      'config.test.outputFile.json must be defined',
    ).toBeTruthy();

    // Simulate vitest resolving outputFile relative to the evals root.
    const evalsRoot = join(ROOT, 'evals');
    const resolved = normalize(join(evalsRoot, outputFile));
    const expected = normalize(join(ROOT, 'evals', 'logs', 'report.json'));

    expect(resolved, String(outputFile)).toBe(expected);
  });

  it('keeps the json reporter enabled so report.json is produced', async () => {
    const config = await loadEvalsVitestConfig();

    const reporters = config?.test?.reporters;
    expect(reporters, 'config.test.reporters must be defined').toBeDefined();
    const reporterList = Array.isArray(reporters[0])
      ? reporters.flat()
      : reporters;
    expect(reporterList).toContain('json');
  });
});
