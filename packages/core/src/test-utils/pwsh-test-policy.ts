/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for how PowerShell grammar tests react to a missing
 * tree-sitter-pwsh install (#3309).
 *
 * Locally the PowerShell describes are skipped with one stderr note so a developer
 * with an incomplete install sees skips instead of opaque file failures. In CI the
 * grammar is required, so the same condition fails loudly at module scope with an
 * actionable message.
 */

const PWSH_SKIP_REASON =
  'Skipping PowerShell tests: the tree-sitter-pwsh grammar is not available. ' +
  'Install it from the repository root with `bun install` or `npm install`.';

const PWSH_CI_FAILURE =
  'CI requires the tree-sitter-pwsh grammar, but it failed to load. ' +
  'Install it from the repository root with `bun install` or `npm install`.';

export interface PwshTestPolicy {
  /** True when the PowerShell describes should be skipped (local, no CI). */
  skip: boolean;
  /** Human-readable reason to print once to stderr when skipping. */
  skipReason: string | null;
  /** Module-scope error message to throw in CI when the grammar is missing. */
  failureMessage: string | null;
}

/**
 * True when the caller runs under a real CI pipeline (e.g. GitHub Actions,
 * which sets process.env.CI = 'true'). Any non-empty string counts as CI; the
 * empty string does not.
 */
function isCiEnv(ci: string | undefined): boolean {
  return typeof ci === 'string' && ci.length > 0;
}

/**
 * Decide how the PowerShell describes should behave given grammar availability
 * and the CI environment variable. Any non-empty `ci` string counts as CI; the
 * empty string does not.
 */
export function resolvePwshTestPolicy(input: {
  available: boolean;
  ci: string | undefined;
}): PwshTestPolicy {
  if (input.available) {
    return { skip: false, skipReason: null, failureMessage: null };
  }
  if (isCiEnv(input.ci)) {
    return { skip: false, skipReason: null, failureMessage: PWSH_CI_FAILURE };
  }
  return { skip: true, skipReason: PWSH_SKIP_REASON, failureMessage: null };
}

/**
 * Env-aware wrapper for test modules. The core workspace test preload
 * (bun-preload.ts) force-sets process.env.CI = 'true' as a browser-launch
 * safety override for every bun test run, so CI alone cannot distinguish a
 * real CI runner from a local run. The preload stashes the runner's original
 * value in CI_BEFORE_TEST_PRELOAD (empty string when CI was unset); prefer it
 * and fall back to process.env.CI for runs without that preload.
 */
export function resolvePwshTestPolicyFromEnv(
  available: boolean,
): PwshTestPolicy {
  return resolvePwshTestPolicy({
    available,
    ci: process.env.CI_BEFORE_TEST_PRELOAD ?? process.env.CI,
  });
}
