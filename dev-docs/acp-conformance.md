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

## Agent Identification (REQ-3095-001)

`initializeZedAgent` in `packages/cli/src/zed-integration/zed-initialize.ts`
now includes `agentInfo` in the ACP `initialize` response:

- `name`: `llxprt-code`
- `version`: the value resolved by `getCliVersion()` from
  `packages/cli/src/utils/version.ts`.

No new version-resolution path was added; `agentInfo.version` uses the same
documented `CLI_VERSION`-then-`package.json` resolution as everywhere else, and
falls back to `unknown` when neither is available. `protocolVersion`,
`authMethods`, and `agentCapabilities` are unchanged.

Issue #3095 reproduced the earlier gap directly: the ACP SDK schema marks
`agentInfo` as "in future versions of the protocol, this will be required", and a
raw stdio probe of `./packages/cli/bin/llxprt --experimental-acp` returned
only `protocolVersion`, `authMethods`, and `agentCapabilities`. The validator now
enforces identification (see the findings gate below), so dropping `agentInfo` again
fails CI instead of surfacing as a warning nobody reads.

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

In `packages/zed-acp/src/zed-session-lifecycle.ts`, `close()`
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

9. Captures the raw acplint exit status before validation. The step prints the
   acplint log tail inside a collapsed `::group::` on every run, not only on a
   nonzero exit, so interpreter-shutdown noise is visible in the job log and
   attributable to acplint (issue #3095).
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

### Findings, summary, and agent-info gate (issue #3095)

Every validator run prints a markdown summary before it decides pass or fail, so
failing runs surface the same information a green one would. The summary shows the
raw acplint status, the declared conformance level, agent identification (or
"not reported"), per-category passed/failed/skipped/errored counts, every
finding marked `known` or `UNEXPECTED`, and every result row that carries a
message. The summary goes to stdout always and is appended to the file named by
`GITHUB_STEP_SUMMARY` when that variable is set, never truncating it. When the
report cannot be read or parsed, a short summary states that the report was
unavailable and why, then the validator exits 1.

The validator carries an exact allowlist of the three finding strings the
selected categories cannot avoid producing on pinned acplint v0.2.0:

- `⚠ No agent_thought_chunk notifications received at all`
- `⚠ No available_commands_update notifications received — agent doesn't advertise commands/hooks`
- `⚠ No usage_update notifications received — agent doesn't report usage`

An allowlisted finding is recorded as known. Any finding outside the allowlist
fails the gate and the rejection names the offending finding, so a new
non-allowlisted finding turns the check red instead of hiding in the artifact.

The allowlist buys that at a cost worth stating: the three notification findings
are accepted unconditionally, so this gate cannot detect a regression in the
behaviours they describe. If LLxprt stopped emitting `available_commands_update`
on `session/new`, or stopped emitting `agent_thought_chunk` or `usage_update` on
prompt turns, the selected categories would produce exactly the same three
findings and the check would stay green. Detecting that needs the `streaming`
and `plans` categories, which require live model inference. See Limitations.

Findings two through four from the original issue are category artifacts, not LLxprt
defects. acplint populates `update_types_seen` only inside its `streaming` and
`plans` category handlers (`_assemble_findings` in the pinned `runner.py`),
and neither category is selected by this gate, so every optional update type is
reported as never seen. The same reproduction probed the live agent directly:
`session/new` emitted `available_commands_update`, and LLxprt builds
`usage_update` and emits `agent_thought_chunk` on prompt turns. The fourth
finding, `No agentInfo in initialize response`, was real and is fixed by
REQ-3095-001; it is deliberately not allowlisted, so the gate now enforces
agent identification. The validator also rejects a report whose `agent_info` lacks a
non-empty string `name` or non-empty string `version`; extra agent-provided keys
remain allowed.

### Python traceback noise (issue #3095)

The original issue reported a `RuntimeError: Event loop is closed` traceback in the
job log. It comes from acplint's own transport teardown: `AcpTransport.__aexit__`
terminates the agent subprocess and awaits `wait()`, but never closes the asyncio
subprocess transport. `asyncio.run()` then closes the loop, and when CPython
garbage-collects the transport it retries `close()` on the closed loop and prints
the message as "Exception ignored in" during interpreter shutdown. That path cannot
change acplint's exit status. It is timing dependent and did not reproduce locally on
Python 3.14/macOS. It is expected noise; since issue #3095 the job prints the
acplint log tail on every run, so the traceback is visible inside the logs and
attributable to acplint rather than to LLxprt.

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
6. Re-derive the three allowlisted finding strings from `_assemble_findings` in
   the new acplint revision and update the `ALLOWED_FINDINGS` list in
   `scripts/validate-acplint-report.ts`, matching the strings byte for byte from a
   fresh run. Verify the reported text with a byte dump; do not retype by eye.
7. Update this document with the new pin, version, and post-fix results.

## Limitations

- This is **not** full ACP certification. Only three deterministic, non-prompting
  categories are exercised. The full 14-category acplint suite requires live
  model inference and is deferred.
- acplint is pinned to a specific commit, but its transitive Python dependencies
  are not fully locked. Full Python environment locking is deferred.
- No streaming, tool-call, permissions, file-operations, terminal, plans,
  session-modes, config-options, cancel, or stress categories are exercised.
- The gate cannot detect a regression in `agent_thought_chunk`,
  `available_commands_update`, or `usage_update`. acplint reports all three as
  never seen regardless of what LLxprt emits, because it only records update
  types in the `streaming` and `plans` handlers, so those findings are
  allowlisted and a genuine regression in them would still pass. Covering that
  needs live model inference.
