/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import weights from './journal-test-weights.data.json' with { type: 'json' };

/**
 * Scheduling costs in seconds from core CI run 40195195714 and the providers
 * run saved in tmp/ci-3944b/prov.txt, supplemented by local measurements on
 * 2026-10-25. Interleaved core output is attributed by suite name. Costs sum
 * the per-test timings, including repeated attempts, and round up to seconds.
 *
 * The older providers seed cases failed early. Their successful local sample
 * (118 seconds per 100-seed file) estimates the equal-sized seed files rather
 * than using those failed timings. Local costs are not scaled down to CI.
 * Unmeasured files receive ten seconds instead of the one-second cost of most
 * completed small files. These weights affect assignment only, not budgets.
 */
export const JOURNAL_TEST_WEIGHTS_SECONDS: Readonly<Record<string, number>> =
  weights;

export function journalTestFileWeight(
  repoRoot: string,
  file: string,
): number | undefined {
  const prefix = repoRoot + '/';
  const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file;
  if (
    !relative.startsWith('packages/core/') &&
    !relative.startsWith('packages/providers/')
  )
    return undefined;
  return JOURNAL_TEST_WEIGHTS_SECONDS[relative] ?? 10;
}
