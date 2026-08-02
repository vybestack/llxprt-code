# ACP Conformance Gate

## Overview

Issue [#2564](https://github.com/vybestack/llxprt-code/issues/2564) adds a
deterministic CI gate that validates LLxprt's ACP stdio implementation against
the pinned [acplint](https://github.com/rinadelph/acplint) v0.2.0 tool, and
fixes the core session-lifecycle violation found by the baseline run.

The gate runs only deterministic, non-prompting acplint categories:
`initialization`, `session_lifecycle`, and `schema_validation`. Selected-category
Full Conformance is the result of this deterministic gate, **not** full-suite
ACP certification. The full 14-category acplint suite requires live model
inference and is out of scope.

## Lifecycle Triage

### Pre-fix baseline

At LLxprt revision `7731b5de60ba66668c23b182cbc9bfeb6986dad1` and pinned acplint
commit `e2f4e49b3ba825869a4ecab7e10076d4460f4dcd`, the deterministic run
produced **Partial Conformance** (exit 1) with **15 PASS / 1 FAIL**.

The sole failure was `delete_session`:

- acplint creates a session via `session/new`.
- acplint closes it via `session/close`.
- acplint deletes it via `session/delete`.
- The session was never prompted, so no recording materialized on disk.
- `deleteSessionById` returns `SESSION_NOT_FOUND_PREFIX`.
- The lifecycle threw `RequestError.resourceNotFound` (`-32002`).

Initialization passed 5/5, session lifecycle passed 6/7, schema validation
passed 4/4.

### Root cause

In `packages/cli/src/zed-integration/zed-session-lifecycle.ts`, `close()`
calls `disposeLive()` which removes the session from the live `sessions` Map.
The subsequent `delete()` finds neither a live session nor a persisted recording
(because the session was never prompted), so `deleteSessionById` returns
not-found and the lifecycle throws `-32002`.

### Fix (REQ-ACP-002)

The fix adds a connection-scoped `knownClosedSessions: Set<string>` to
`SessionLifecycle`:

- `close()` records the session ID in `knownClosedSessions` when it disposes a
  live session.
- `performDelete()` accepts a not-found result when the ID is in
  `knownClosedSessions`, consuming the marker (deleting from the set).
- Every successful deletion consumes the marker, including when the persisted
  delete succeeds (`result.ok`), so a second delete after success returns
  resource-not-found.
- A missing persisted recording is accepted only for a currently live session or
  a known session closed in this connection.
- Internal storage failure (when `deleteSessionById` throws) preserves the
  marker for retry.
- Existing per-session serialization remains intact.

No public API, storage format, capability advertisement, or transport changed.

### Post-fix result

After the fix, a fresh isolated post-fix run (clean `LLXPRT_CONFIG_HOME`,
`LLXPRT_DATA_HOME`, and `LLXPRT_LOG_HOME`) with an explicit `--cwd` matching the
project root produced **Full Conformance** for the selected categories (acplint
exit 0, validator exit 0) with **all 16 expected rows PASS**, including
`resume_session` and `delete_session`:

| Category          | Result rows |   PASS |
| ----------------- | ----------- | -----: |
| initialization    | 5           |      5 |
| session_lifecycle | 7           |      7 |
| schema_validation | 4           |      4 |
| **Total**         | **16**      | **16** |

The lifecycle sequence `new → close → delete` for an unrecorded session
succeeds. The session is disposed once and is no longer available for prompts.

> **Note:** Selected-category Full Conformance means the three deterministic
> categories all pass. It is **not** full ACP certification — the full
> 14-category acplint suite (streaming, tool-call gating, permissions, terminal,
> plans, etc.) requires live model inference and is deferred.

## CI Gate

### Job: `acp_conformance`

Added to `.github/workflows/ci.yml`. The job:

1. Uses the `./packages/cli/bin/llxprt` launcher with `--experimental-acp`.
2. Installs acplint pinned to immutable commit
   `e2f4e49b3ba825869a4ecab7e10076d4460f4dcd` (v0.2.0).
3. Uses Python 3.11+, Node from `.nvmrc`, Bun from `.bun-version`.
4. Installs dependencies with plain `bun install` (never `--frozen-lockfile`).
5. Builds the project before running acplint.
6. Creates a truthful pre-run diagnostic (`status.txt` = `not-run`,
   `acplint.log` = setup-not-complete) under the runner temporary directory
   before checkout or setup, so a setup failure never leaves the artifact empty
   or with a fabricated numeric acplint result.
7. Isolates `LLXPRT_CONFIG_HOME`, `LLXPRT_DATA_HOME`, and `LLXPRT_LOG_HOME`
   under the runner temporary directory, with file logs written directly into
   the diagnostics tree.
8. Runs acplint with exact non-network placeholder args:

   ```text
   --agent "./packages/cli/bin/llxprt"
   --agent-args "--experimental-acp --provider openai --model gpt-4o --key acplint-ci"
   --categories initialization session_lifecycle schema_validation
   --output json
   --output-file acplint-diagnostics/report.json
   --cwd "${GITHUB_WORKSPACE}"
   ```

   The `--cwd` flag is set explicitly to the GitHub Actions workspace so the
   documented and reproduced behavior matches CI exactly. The non-secret
   placeholder key (`acplint-ci`) initializes the provider; selected categories
   do not prompt a model or perform network inference.

9. Captures the raw acplint exit status before validation.
10. Validates the JSON report with `scripts/validate-acplint-report.ts`.
11. Always uploads the runner-temp diagnostics directory containing status,
    log, JSON, and LLxprt logs — even on failure. The upload uses
    `if-no-files-found: error` so a missing always-created diagnostic file fails
    the job rather than silently uploading nothing.

### Test aggregator wiring

The `acp_conformance` job is wired into the required `Test` aggregator. The
aggregator fails when `acp_conformance` does not succeed (any outcome other than
success), preserving the duplicate-PR skip behavior.

## Report Validator

`scripts/validate-acplint-report.ts` is a single-purpose internal validator for
the pinned v0.2.0 report. It is **not** a generic acplint framework. It uses
the project's Zod schema-first convention to parse and validate the report
structure — no production type assertions.

Usage: `node scripts/validate-acplint-report.ts <report-json-path> <status>`

Exit 0 = valid, exit 1 = invalid.

### Acceptance rules (REQ-ACP-005)

- Status 0 is accepted only with a valid Full report.
- Status 1 is accepted only with a valid Partial report.
- Status 2 and every unexpected status are rejected.
- Missing/malformed JSON, a Non-Conformant level, status/level mismatch, missing
  expected categories/results, duplicate selected category/name rows, unknown or
  malformed result row statuses, or selected `FAIL`/`ERROR` results are rejected.

A valid report must contain all expected result rows:

- `initialization`: `initialize_v1`, `protocol_version_returned`,
  `agent_capabilities_present`, `agent_info_present`,
  `agent_capabilities_schema_valid`
- `session_lifecycle`: `new_session`, `list_sessions`, `load_session`,
  `resume_session`, `close_session`, `delete_session`, `fork_session`
- `schema_validation`: `schema_initialize`, `schema_session_new`,
  `schema_session_list`, `coverage_methods_exercised`

No selected-category row may have `FAIL` or `ERROR` status. Accepted selected-row
statuses are `PASS` and `SKIP`. The pinned v0.2.0 report schema enum is
`PASS|FAIL|SKIP|ERROR`; the validator's Zod schema enforces this enum exactly.
A status-1 (Partial) fixture is internally coherent with one selected row at
`SKIP` and a matching category summary (15/16 passed → Partial Conformance).

## Artifacts

The `acplint-diagnostics` artifact directory contains:

| File / Dir     | Description                                                      |
| -------------- | ---------------------------------------------------------------- |
| `status.txt`   | Raw acplint exit code (or `not-run` if the gate never completed) |
| `acplint.log`  | acplint stdout/stderr (or setup-not-complete message pre-run)    |
| `report.json`  | acplint JSON report (when produced)                              |
| `llxprt-logs/` | LLxprt file logs from `LLXPRT_LOG_HOME` (when produced)          |

A process failure before JSON generation must not fabricate a report. The
artifact upload always runs (`if: always()`) and uses `if-no-files-found: error`
so the always-created pre-run diagnostic files guarantee a non-empty artifact.

## Version-Update Procedure

To update the acplint pin:

1. Identify the new acplint commit SHA.
2. Update the `python -m pip install` line in `.github/workflows/ci.yml`
   (both the job and the `ACPLINT_PIN` assertion in
   `scripts/tests/ci-acplint-workflow.test.ts`).
3. Update the `--version` exact-equality step to match the new version string.
4. Update the expected result rows in `scripts/validate-acplint-report.ts` if
   the report schema changed.
5. Run the full acplint gate locally and confirm the report validates.
6. Update this document with the new pin, version, and post-fix results.

## Limitations

- This is **not** full ACP certification. Only three deterministic, non-prompting
  categories are exercised. The full 14-category acplint suite requires live
  model inference and is deferred.
- acplint is pinned to a specific commit, but its transitive Python dependencies
  are not fully locked. Full Python environment locking is deferred.
- No streaming, tool-call, permissions, file-operations, terminal, plans,
  session-modes, config-options, cancel, or stress categories are exercised.
