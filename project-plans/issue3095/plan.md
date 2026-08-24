# Issue #3095 implementation plan

Read `specification.md` first. Requirement IDs below refer to it.

## Ordering

Tests are written before the behaviour they describe. Each phase ends with the
new tests failing for the right reason, then passing after the change.

## Phase 1: agentInfo (REQ-3095-001)

Files:

- `packages/cli/src/zed-integration/zed-initialize.ts`
- new behavioural tests in the zed-integration test suite

Behaviour: `initializeZedAgent(config)` resolves an `InitializeResponse` whose
`agentInfo` is `{ name: 'llxprt-code', version: <getCliVersion()> }`.

Tests must assert observable output of the real function, not that a mock was
called:

1. `agentInfo.name` is `llxprt-code`.
2. `agentInfo.version` equals the value `getCliVersion()` resolves to for the
   process under test. Drive this through the documented seam:
   set `process.env.CLI_VERSION`, call `__resetVersionCacheForTesting()`, and
   assert the response carries that exact version. Restore the previous env and
   reset the cache afterwards.
3. When `CLI_VERSION` is absent the version is a non-empty string and
   `agentInfo` is still present (never `undefined`, never `null`).
4. `protocolVersion`, `authMethods`, and `agentCapabilities` are unchanged by
   the addition (assert the existing shape still holds).

Do not introduce a new version-resolution path. Reuse
`packages/cli/src/utils/version.ts`.

## Phase 2: validator summary and findings gate (REQ-3095-002/003/004)

File: `scripts/validate-acplint-report.ts`, tests in
`scripts/tests/validate-acplint-report.test.ts`.

### Allowlist

Add a frozen list of the exact expected finding strings. Write the leading
warning sign as the escape `'\u26A0 '` in source rather than pasting the
literal character, and source the rest of each string from acplint's
`runner.py` at the pinned commit:

- `_assemble_findings` agent_thought_chunk branch
- `_assemble_findings` available_commands_update branch
- `_assemble_findings` usage_update branch

The em dashes inside two of those strings are U+2014 as emitted by acplint.
Verify byte equality against the reproduced report, not by eye.

### Summary emission

Emit the summary before the accept/reject decision so failing runs surface it
too. Structure the code as a pure function that takes the parsed report plus
the raw status and returns the markdown string, and a thin writer that prints
to stdout and appends to `GITHUB_STEP_SUMMARY` when that variable is set and
non-empty. The pure function is what the tests exercise for content; the CLI
behaviour is exercised end to end through `spawnSync`.

When reading or parsing fails, emit a short summary stating the report was
unavailable and the reason, then exit 1 as today.

### New validation rules

- Reject any finding not in the allowlist, naming it in the error.
- Reject a report whose `agent_info` lacks a non-empty string `name` or a
  non-empty string `version`.

`agent_info` is currently typed `z.record(z.string(), z.unknown())`. Tighten it
only as far as the requirement needs; keep unknown extra keys permitted.

### Tests (behavioural, via spawnSync as the existing suite does)

- Accepts a report whose findings are exactly the three allowlisted strings.
- Accepts a report with an empty findings array.
- Accepts a report with a strict subset of the allowlist.
- Rejects a report containing the agentInfo finding, and stderr names it.
- Rejects a report containing an arbitrary unknown finding.
- Rejects `agent_info: {}`.
- Rejects `agent_info` with an empty-string `name` or empty-string `version`.
- Rejects `agent_info` whose `name` or `version` is a non-string.
- Accepts `agent_info` carrying extra unknown keys alongside name and version.
- Summary reaches stdout on success and on every rejection path, including the
  unreadable-file and malformed-JSON paths.
- Summary content includes the raw status, the conformance level, the agent
  name and version, per-category counts, each finding marked known or
  unexpected, and each result row message.
- With `GITHUB_STEP_SUMMARY` pointed at a temp file, the same markdown is
  appended to that file; existing file content is preserved (append, not
  truncate).
- With `GITHUB_STEP_SUMMARY` unset or empty, nothing is written and the process
  still succeeds.

Existing fixtures in that test file use `agent_info: {}`. Update the shared
fixture builders to carry a valid `agent_info`, and keep dedicated fixtures for
the new rejection cases. Do not weaken any existing assertion.

## Phase 3: workflow log surfacing (REQ-3095-005)

Files: `.github/workflows/ci.yml`, `scripts/tests/ci-acplint-workflow.test.ts`.

Change the `Run acplint` step so the log tail is printed inside a `::group::`
unconditionally. Keep writing `status.txt` before anything else can fail and
keep the step exiting 0 so the validator step is what gates.

The existing test `prints the acplint log tail when the raw status is nonzero`
asserts `if [ "$EXIT_CODE" -ne 0 ]; then`. Replace it with a test asserting the
tail is printed unconditionally, and keep asserting the group markers and the
`acplint.log` path. Do not delete coverage; convert it.

Add a test that the `Validate acplint report` step still runs the committed
validator and that the job continues to upload diagnostics with `always()`.

## Phase 4: documentation (REQ-3095-006)

`dev-docs/acp-conformance.md`:

- Record the `agentInfo` addition under the conformance behaviour.
- New section covering findings: what acplint reports, why three of them are
  category artifacts (cite `runner.py` populating `update_types_seen` only in
  the streaming and plans handlers), the evidence that LLxprt does emit
  `available_commands_update` on `session/new`, the allowlist, and the rule
  that an unknown finding fails the gate.
- New subsection explaining the `RuntimeError: Event loop is closed` traceback:
  where it comes from in acplint's transport teardown, why it cannot affect the
  exit status, and that it is expected noise.
- Extend the version-update procedure with a step to re-derive the allowlisted
  finding strings from the new acplint revision.

Do not claim broader conformance than the three deterministic categories give.

## Verification

Run the full cycle and fix everything it reports:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Then re-run the real gate end to end and confirm it is green with the change:

```bash
python3 -m venv /tmp/acplint-venv
/tmp/acplint-venv/bin/python -m pip install \
  "acplint @ git+https://github.com/rinadelph/acplint.git@e2f4e49b3ba825869a4ecab7e10076d4460f4dcd"
# run with isolated LLXPRT_CONFIG_HOME/LLXPRT_DATA_HOME/LLXPRT_LOG_HOME and the
# same arguments the CI job uses, then:
node scripts/validate-acplint-report.ts <report.json> <status>
```

Required evidence: the post-change report shows a populated `agent_info`, the
agentInfo finding is gone, exactly the three allowlisted findings remain, the
validator exits 0, and its summary lists all three as known.
