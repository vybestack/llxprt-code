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
 * a checked-in fixture through `FakeProvider` and costs nothing. Every such run
 * — `run`, `runInteractive` and `runCommand` — is appended to the ledger by
 * `TestRig`, and `scripts/check-e2e-model-budget.ts` checks the ledger against
 * this file, so a new real-provider test fails CI until it is listed here with a
 * justification.
 *
 * `apiRequestsPerRun` is the number of model API requests one execution of the
 * test issues, MEASURED from the `api_request` events in the run's
 * `telemetry.log` — not the number of CLI invocations. A test that provokes a
 * tool call costs two requests: the turn that emits the tool call, and the
 * continuation turn that reports its result.
 *
 * The ceiling is applied to the DISTINCT tests observed in a leg's ledger, not
 * to the number of recorded runs. `scripts/bun-test-roots.ts` gives the
 * `integration-tests` root `retries: 2` and `scripts/run_bun_tests.ts` re-spawns
 * the whole file on a retry, so a flaky-then-passing leg legitimately produces
 * duplicate records. A retry multiplies real spend, which the report shows, but
 * it is a CI-infrastructure event rather than a budget violation.
 */

export interface RealModelBudgetEntry {
  /** The name passed to `rig.setup()`, which is what the ledger records. */
  readonly testName: string;
  /** Measured model API requests issued by one execution of this test. */
  readonly apiRequestsPerRun: number;
  /** Why this test is allowed to use a real provider. */
  readonly reason: string;
}

/**
 * Measured model API requests per E2E matrix leg before issue #2278: the shell
 * tool-selection canary (2), its stdin twin (2), `replace` (2),
 * `list_directory` (2) and `session-summary` (1).
 */
export const BASELINE_REAL_MODEL_API_REQUESTS = 9;

/**
 * Ceiling on model API requests per E2E matrix leg, applied to the distinct
 * tests recorded in the ledger. Issue #2278 requires at least a 50% reduction
 * from the measured baseline.
 */
export const MAX_REAL_MODEL_API_REQUESTS = 4;

export const REAL_MODEL_RUN_BUDGET: readonly RealModelBudgetEntry[] = [
  {
    testName: 'should be able to run a shell command',
    apiRequestsPerRun: 2,
    reason:
      'Shell tool-selection canary: only real-model coverage that the model picks run_shell_command from a natural-language prompt. Costs a tool-call turn plus a continuation turn',
  },
  {
    testName: 'should be able to replace content in a file',
    apiRequestsPerRun: 2,
    reason:
      'Text-manipulation canary: only real-model coverage that the model targets the right substring through the replace tool. Costs a tool-call turn plus a continuation turn',
  },
  {
    testName: 'should not crash when using mixed prompt inputs',
    apiRequestsPerRun: 0,
    reason:
      'The CLI rejects piped stdin combined with --prompt-interactive during argument validation, so no model turn occurs; the test asserts readLastApiRequest() is null',
  },
  {
    testName: 'should provide clear error message for mixed input',
    apiRequestsPerRun: 0,
    reason:
      'Exercises the same argument-validation exit path as the mixed-input crash test, before any provider call',
  },
  {
    testName: 'should exit quickly if stdin stream does not end',
    apiRequestsPerRun: 0,
    reason:
      'The CLI exits on an unterminated stdin stream before any provider call; a fixture would never be consumed',
  },
  {
    testName: 'extension install test',
    apiRequestsPerRun: 0,
    reason:
      'Drives the `extensions install/list/update` subcommands through runCommand; those subcommands never start a model turn',
  },
  {
    testName: 'should succeed with --yolo mode',
    apiRequestsPerRun: 2,
    reason:
      'Real-model tool-approval coverage in run_shell_command.test.ts. e2e.yml excludes that file from its main invocation and its --testNamePattern does not select this case, so it is not executed in CI',
  },
  {
    testName: 'should allow all with "ShellTool" and other specific tools',
    apiRequestsPerRun: 2,
    reason:
      'Real-model allowlist coverage in run_shell_command.test.ts that e2e.yml does not select, so it is not executed in CI',
  },
  {
    testName: 'should propagate environment variables',
    apiRequestsPerRun: 2,
    reason:
      'Real-model child-environment coverage in run_shell_command.test.ts that e2e.yml does not select, so it is not executed in CI',
  },
  {
    testName: 'codex-image-real',
    apiRequestsPerRun: 2,
    reason:
      'Opt-in Codex image round-trip via runCommand. Skipped whenever CI is set or the real-provider opt-in is absent, so it is not executed in CI',
  },
];
