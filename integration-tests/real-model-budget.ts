/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Declared budget for `integration-tests/` runs that use a real provider
 * (issue #2278).
 *
 * A `TestRig` run reaches a real provider if and only if `rig.setup()` was
 * called without `fakeResponsesPath`; otherwise the model turn is replayed from
 * a checked-in fixture through `FakeProvider` and costs nothing. Every
 * real-provider run is recorded to the ledger by `TestRig`, and
 * `scripts/check-e2e-model-budget.ts` checks the ledger against this file, so a
 * new real-provider test fails CI until it is listed here with a justification.
 *
 * `apiRequestsPerRun` is the number of model API requests a single run of that
 * test issues. `runsInE2eCi` records whether `.github/workflows/e2e.yml`
 * actually executes the test: that workflow excludes
 * `integration-tests/run_shell_command.test.ts` from its main invocation and
 * then re-runs only three named cases, so three real-provider cases in that
 * file are never executed in CI and contribute nothing to the CI request count.
 */

export interface RealModelBudgetEntry {
  /** The name passed to `rig.setup()`, which is what the ledger records. */
  readonly testName: string;
  /** Model API requests issued by one run of this test. */
  readonly apiRequestsPerRun: number;
  /** Whether `.github/workflows/e2e.yml` actually executes this test. */
  readonly runsInE2eCi: boolean;
  /** Why this test is allowed to use a real provider. */
  readonly reason: string;
}

/**
 * Model API requests issued per E2E matrix leg before issue #2278: the shell
 * tool-selection canary, its stdin twin, `replace`, `list_directory`, and
 * `session-summary`.
 */
export const BASELINE_REAL_MODEL_API_REQUESTS = 5;

/**
 * Ceiling on model API requests per E2E matrix leg. Issue #2278 requires at
 * least a 50% reduction from the baseline.
 */
export const MAX_REAL_MODEL_API_REQUESTS = 2;

export const REAL_MODEL_RUN_BUDGET: readonly RealModelBudgetEntry[] = [
  {
    testName: 'should be able to run a shell command',
    apiRequestsPerRun: 1,
    runsInE2eCi: true,
    reason:
      'Shell tool-selection canary: only real-model coverage that the model picks run_shell_command from a natural-language prompt',
  },
  {
    testName: 'should be able to replace content in a file',
    apiRequestsPerRun: 1,
    runsInE2eCi: true,
    reason:
      'Text-manipulation canary: only real-model coverage that the model targets the right substring through the replace tool',
  },
  {
    testName: 'should not crash when using mixed prompt inputs',
    apiRequestsPerRun: 0,
    runsInE2eCi: true,
    reason:
      'The CLI rejects piped stdin combined with --prompt-interactive during argument validation, so no model turn occurs; the test asserts readLastApiRequest() is null',
  },
  {
    testName: 'should provide clear error message for mixed input',
    apiRequestsPerRun: 0,
    runsInE2eCi: true,
    reason:
      'Exercises the same argument-validation exit path as the mixed-input crash test, before any provider call',
  },
  {
    testName: 'should exit quickly if stdin stream does not end',
    apiRequestsPerRun: 0,
    runsInE2eCi: true,
    reason:
      'The CLI exits on an unterminated stdin stream before any provider call; a fixture would never be consumed',
  },
  {
    testName: 'should succeed with --yolo mode',
    apiRequestsPerRun: 1,
    runsInE2eCi: false,
    reason:
      'Real-model tool-approval coverage in run_shell_command.test.ts that e2e.yml never selects, so it costs nothing per CI leg',
  },
  {
    testName: 'should allow all with "ShellTool" and other specific tools',
    apiRequestsPerRun: 1,
    runsInE2eCi: false,
    reason:
      'Real-model allowlist coverage in run_shell_command.test.ts that e2e.yml never selects, so it costs nothing per CI leg',
  },
  {
    testName: 'should propagate environment variables',
    apiRequestsPerRun: 1,
    runsInE2eCi: false,
    reason:
      'Real-model child-environment coverage in run_shell_command.test.ts that e2e.yml never selects, so it costs nothing per CI leg',
  },
];
