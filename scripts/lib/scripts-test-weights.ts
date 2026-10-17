/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recorded wall-clock cost, in seconds, of the slow files in the scripts test
 * root (issue #854). The scripts CI legs balance on these weights instead of
 * on file position, because the 8192-row BODY tests run 20 s to 350 s each
 * while the other ~330 files finish in about a second. Durations come from the
 * CI run of 2026-10-11 (the `scripts` shard legs); semantic-purge-production-body
 * is split per provider; its weights are the sum of the case timings from the
 * killed attempt.
 *
 * Only files at or above 20 s are listed. Every other file weighs
 * {@link DEFAULT_TEST_FILE_WEIGHT_SECONDS}. A listed file that no longer
 * exists is rejected by the drift guard in
 * scripts/tests/scripts-test-weights.test.ts.
 */
export const SCRIPTS_TEST_WEIGHTS_SECONDS: Readonly<Record<string, number>> = {
  'scripts/tests/highdensity-disk-body.test.ts': 351,
  'scripts/tests/provider-hardlimit-disk-body.test.ts': 299,
  'scripts/tests/pending-window-disk-body-large-anthropic.test.ts': 212,
  'scripts/tests/client-array-body.test.ts': 209,
  'scripts/tests/pending-window-disk-body-large-gemini.test.ts': 208,
  'scripts/tests/issue-2603-release-install.test.ts': 202,
  'scripts/tests/retained-array-body.test.ts': 195,
  'scripts/tests/provider-fallback-disk-body.test.ts': 178,
  'scripts/tests/oneshot-disk-body.test.ts': 155,
  'scripts/tests/conversation-array-body.test.ts': 155,
  'scripts/tests/provider-binding-bridge-body.test.ts': 153,
  'scripts/tests/checkpoint-save-body.test.ts': 152,
  'scripts/tests/purge-ranking-body.test.ts': 141,
  'scripts/tests/semantic-purge-production-body-large-openai-responses.test.ts': 157,
  'scripts/tests/pending-window-disk-body-large-openai-responses.test.ts': 139,
  'scripts/tests/semantic-purge-production-body-large-anthropic.test.ts': 124,
  'scripts/tests/tool-truncation-body.test.ts': 121,
  'scripts/tests/semantic-purge-production-body-large-gemini.test.ts': 119,
  'scripts/tests/middleout-disk-body.test.ts': 109,
  'scripts/tests/public-default-history-body.test.ts': 104,
  'scripts/tests/provider-curated-body.test.ts': 96,
  'scripts/tests/addbatch-value-body.test.ts': 92,
  'scripts/tests/chat-default-history-body.test.ts': 85,
  'scripts/tests/export-summary-body.test.ts': 82,
  'scripts/tests/density-disk-body.test.ts': 81,
  'scripts/tests/middleout-summary-body.test.ts': 77,
  'scripts/tests/detached-rollback-body.test.ts': 74,
  'scripts/tests/addbatch-stream-body.test.ts': 71,
  'scripts/tests/reinitialize-history-body.test.ts': 67,
  'scripts/tests/agent-carry-body.test.ts': 63,
  'scripts/tests/deferred-transform-body.test.ts': 48,
  'scripts/tests/auto-issue-metadata.test.ts': 45,
  'scripts/tests/fallback-values-body.test.ts': 45,
  'scripts/tests/compression-value-body.test.ts': 42,
  'scripts/tests/truncation-value-highdensity-body.test.ts': 42,
  'scripts/tests/history-removals-body.test.ts': 42,
  'scripts/tests/batch-event-body.test.ts': 40,
  'scripts/tests/transformall-body.test.ts': 40,
  'scripts/tests/assign-workflow-behaviors.test.ts': 33,
  'scripts/tests/oneshot-summary-body.test.ts': 32,
  'scripts/tests/ink-devtools-lifecycle.test.ts': 31,
  'scripts/tests/issue-3161-build-config.test.ts': 27,
  'scripts/tests/check-agents-api-surface.test.ts': 26,
  'scripts/tests/truncation-strategy-body.test.ts': 25,
  'scripts/tests/semantic-purge-production-body.test.ts': 24,
  'scripts/tests/raw-compression-body.test.ts': 24,
  'scripts/tests/publish-integrity.test.ts': 24,
  'scripts/tests/synchronous-ticket-memory.test.ts': 21,
};

/** Mean cost of the unlisted scripts test files (336 s over 318 files). */
export const DEFAULT_TEST_FILE_WEIGHT_SECONDS = 1;

/** Weight of a repo-relative test file path. */
export function scriptsTestWeight(repoRelativePath: string): number {
  return (
    SCRIPTS_TEST_WEIGHTS_SECONDS[repoRelativePath] ??
    DEFAULT_TEST_FILE_WEIGHT_SECONDS
  );
}

/** Weight of an absolute test file path inside the repository at `repoRoot`. */
export function scriptsTestFileWeight(repoRoot: string, file: string): number {
  const prefix = repoRoot + '/';
  return scriptsTestWeight(
    file.startsWith(prefix) ? file.slice(prefix.length) : file,
  );
}
