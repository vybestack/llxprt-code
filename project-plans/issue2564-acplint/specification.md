# Feature Specification: Deterministic ACP Conformance Gate

Plan ID: PLAN-20260801-ACP-CONFORMANCE
Issue: https://github.com/vybestack/llxprt-code/issues/2564

## Purpose

Validate LLxprt's ACP stdio implementation in CI with pinned acplint v0.2.0, fix the core session-lifecycle violation found by the baseline, and retain structured diagnostics without claiming certification for categories that cannot run deterministically in required CI.

## Architectural Decisions

- Use the supported `./packages/cli/bin/llxprt` launcher and existing `--experimental-acp` mode; do not add another ACP entry point.
- Run only deterministic, non-prompting acplint categories: `initialization`, `session_lifecycle`, and `schema_validation`.
- Pin acplint's v0.2.0 implementation to immutable commit `e2f4e49b3ba825869a4ecab7e10076d4460f4dcd`, because PyPI currently publishes only v0.1.0.
- Validate both acplint's raw process status and the JSON report with a single-purpose internal TypeScript script.
- Treat selected-category Full/Partial output only as the result of this deterministic gate, not full-suite ACP certification.
- Keep lifecycle knowledge connection-scoped inside the existing `SessionLifecycle`; do not add a public abstraction, persistence format, or subsystem.

## Integration Points

### Existing Code Used

- `packages/cli/bin/llxprt`: real child-process launcher.
- `packages/cli/src/zed-integration/runZedIntegration.ts`: SDK NDJSON transport.
- `packages/cli/src/zed-integration/zedIntegration.ts`: ACP agent and session creation.
- `packages/cli/src/zed-integration/zed-session-lifecycle.ts`: close/delete behavior.
- `.github/workflows/ci.yml`: required CI graph and artifact conventions.

### Existing Code Replaced

No component is replaced. The incorrect delete boundary in `SessionLifecycle` is corrected minimally.

### User Access

The ACP interface remains available through `llxprt --experimental-acp`. The new validation is a required CI check and an internal report validator, not a new public command/API.

### Migration

None. No session storage or configuration format changes are accepted.

## Formal Requirements

### REQ-ACP-001: Real deterministic invocation

CI launches the real LLxprt command through acplint with:

```text
--experimental-acp --provider openai --model gpt-4o --key acplint-ci
```

The non-secret placeholder key is used only to initialize the provider; selected categories must not prompt a model or perform network inference. CI isolates `LLXPRT_CONFIG_HOME`, `LLXPRT_DATA_HOME`, and `LLXPRT_LOG_HOME` under the runner temporary directory.

### REQ-ACP-002: Known closed/unrecorded deletion

Given a session created in the current ACP connection has no persisted recording, `close` followed by `delete` succeeds. The session is disposed once and is no longer available for prompts.

- Only a close that found a live session records that the ID was known.
- A missing persisted recording is accepted only for a currently live session or a known session closed in this connection.
- Successful delete consumes the known-closed marker.
- Internal storage failure preserves the marker for retry.
- Existing per-session serialization remains intact.

### REQ-ACP-003: Unknown-ID boundaries

- `delete(unknown)` returns ACP resource-not-found (`-32002`).
- `close(unknown)` remains idempotently successful and does not make a later delete succeed.
- A second delete after successful deletion returns resource-not-found.
- Existing persisted deletion and live-unrecorded deletion behavior remain successful.

### REQ-ACP-004: Pinned tool provenance

CI uses Python 3.11 or newer and installs:

```text
acplint @ git+https://github.com/rinadelph/acplint.git@e2f4e49b3ba825869a4ecab7e10076d4460f4dcd
```

The job verifies the installed tool reports v0.2.0. This pins acplint itself, not its unbounded transitive Python dependencies; full Python environment locking is deferred.

### REQ-ACP-005: Fail-closed status and report validation

The workflow records acplint's raw process status before validation.

- Status 0 is accepted only with a valid Full report for the selected gate.
- Status 1 is accepted only with a valid Partial report for the selected gate.
- Status 2 and every unexpected status are rejected.
- Missing/malformed JSON, a Non-Conformant report, status/level mismatch, missing expected categories/results, or selected `FAIL`/`ERROR` results are rejected.
- The validator supports the exact pinned v0.2.0 report and selected category set; it is not a generic acplint framework.

Expected result rows:

- initialization: `initialize_v1`, `protocol_version_returned`, `agent_capabilities_present`, `agent_info_present`, `agent_capabilities_schema_valid`
- session_lifecycle: `new_session`, `list_sessions`, `load_session`, `resume_session`, `close_session`, `delete_session`, `fork_session`
- schema_validation: `schema_initialize`, `schema_session_new`, `schema_session_list`, `coverage_methods_exercised`

### REQ-ACP-006: Diagnostics

CI always uploads an artifact directory containing the raw status and acplint log, plus JSON and LLxprt logs when produced. A process failure before JSON generation must not fabricate a report. Artifact upload uses the repository's pinned action convention and fails when the always-created diagnostic files are absent.

### REQ-ACP-007: Required CI integration

Add an `acp_conformance` job to `.github/workflows/ci.yml` using pinned actions, least-privilege contents access, bounded timeout, repository-pinned Node/Bun versions, Python 3.11+, plain `bun install`, build, real acplint invocation, semantic validation, and always-run artifact upload. Wire it into the existing required `Test` aggregator so every outcome other than success fails outside the existing duplicate-PR skip path.

### REQ-ACP-008: Durable baseline documentation

Document the exact revisions, command, selected categories, pre-fix and post-fix results, lifecycle triage, CI gate/artifact policy, version-update procedure, and limitations in `dev-docs/acp-conformance.md`.

## Baseline Evidence

At LLxprt revision `7731b5de60ba66668c23b182cbc9bfeb6986dad1` and pinned acplint commit `e2f4e49b3ba825869a4ecab7e10076d4460f4dcd`, the deterministic run produced Partial Conformance with 15 PASS and 1 FAIL. Initialization passed 5/5, session lifecycle passed 6/7, and schema validation passed 4/4. The sole failure was `delete_session` returning `-32002 Resource not found` after acplint created and closed an unprompted session whose recording had not materialized.

## Behavioral Evidence

- Existing real `ZedAgent` lifecycle tests prove close/delete success and unknown-ID boundaries.
- Validator process tests prove all accepted and rejected status/report combinations against temporary files.
- Workflow semantic tests prove the pinned dependency, exact command/categories, isolated homes, status capture, artifact upload, and required-check graph.
- A real post-fix pinned acplint child-process run proves all expected selected rows pass.
- Full repository test, lint, typecheck, format, and build gates pass on the candidate head.

## Explicitly Deferred

- Required full/default 14-category acplint execution.
- Streaming/tool-call gating that requires deterministic prompt/model behavior.
- Provider credentials, live network inference, stress prompts, terminal/file mutations, or a new mock provider solely for CI.
- Optional/manual conformance jobs, dashboards, annotations, trend storage, Docker images, or generalized report frameworks.
- ACP capability-advertisement changes without independent protocol evidence.
- Full transitive Python dependency locking.
- Unrelated ACP cleanup, refactors, or public API changes.

## Constraints

- Follow RED → GREEN TDD with behavioral tests and no mock theater.
- Do not weaken lint, complexity, source-size, safety, coverage, cross-platform, or CI requirements.
- Do not add lint/type suppressions, ignores, severity downgrades, or complexity threshold increases.
- Prefer fail-fast validation over fallback or fabricated diagnostics.
