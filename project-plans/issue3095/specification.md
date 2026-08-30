# Issue #3095 : ACP lint findings must be surfaced, and the real gap fixed

## Problem

The `acp_conformance` CI job runs pinned acplint v0.2.0 over three
deterministic categories and passes when the JSON report validates. Three
problems were reported:

1. A Python traceback (`RuntimeError: Event loop is closed`) appeared in the
   job log with no explanation of what it means or whether it matters.
2. The uploaded `report.json` carried four `findings` entries that nobody ever
   sees, including one claiming LLxprt does not advertise commands/hooks or
   usage.
3. The job reports only pass/fail. Findings never surface, so a report full of
   warnings still shows a green check and an artifact nobody opens.

## Evidence gathered before writing this specification

### Reproduction

The pinned acplint commit `e2f4e49b3ba825869a4ecab7e10076d4460f4dcd` was
installed into a clean virtualenv and run against the built launcher with the
exact CI arguments and isolated `LLXPRT_CONFIG_HOME` / `LLXPRT_DATA_HOME` /
`LLXPRT_LOG_HOME`. It exited 0 with **Full Conformance**, 16/16 PASS, and
reproduced the issue's four findings byte for byte:

```text
\u26a0 No agentInfo in initialize response - agents should identify themselves
\u26a0 No agent_thought_chunk notifications received at all
\u26a0 No available_commands_update notifications received - agent doesn't advertise commands/hooks
\u26a0 No usage_update notifications received - agent doesn't report usage
```

(The leading `\u26a0` is a literal U+26A0 WARNING SIGN followed by a space in
acplint's output, and the `-` characters shown here are em dashes in the real
strings. Source them from `runner.py`, never by retyping.)

`agent_info` in the report was `{}`, and `coverage_methods_exercised` reported
`"update_types_seen": []`.

### Finding 1 is real

A direct ACP stdio probe (raw JSON-RPC `initialize` against
`./packages/cli/bin/llxprt --experimental-acp`) returned exactly
`protocolVersion`, `authMethods`, `agentCapabilities`. There is no `agentInfo`.
`packages/cli/src/zed-integration/zed-initialize.ts` never sets it, and the ACP
schema (`@agentclientprotocol/sdk` 1.2.1) documents `agentInfo` as
"in future versions of the protocol, this will be required".

**This is a genuine incomplete-ACP-support gap and is fixed here.**

### Findings 2–4 are false positives of the category selection

The same probe issued `session/new` and captured the notifications LLxprt
emitted. It received `available_commands_update`. LLxprt calls
`session.sendAvailableCommands()` inside `newSession` and both `loadSession`
paths (`packages/cli/src/zed-integration/zedIntegration.ts`), builds
`usage_update` in `zed-helpers.ts`, and emits `agent_thought_chunk` from
`zed-stream-batcher.ts` and `zed-session-replay.ts`.

acplint only adds to `_coverage["update_types_seen"]` inside its `streaming`
and `plans` category handlers (`runner.py` lines 630 and 1406). Neither
category is selected by the deterministic gate, so `update_types_seen` is
always empty, and `_assemble_findings()` then reports every optional update
type as never seen. The three notification findings are artifacts of running a
subset of categories, not LLxprt defects.

**No LLxprt behaviour change is warranted for findings 2–4. They are recorded
as known, explained, expected findings.**

### The Python traceback is upstream teardown noise

acplint's `AcpTransport.__aexit__` terminates the agent subprocess and awaits
`wait()`, but never closes the asyncio subprocess transport. `run_all()` then
returns from `asyncio.run()`, which closes the event loop. When CPython later
garbage-collects `BaseSubprocessTransport`, its `__del__` calls `close()` on a
closed loop and prints `RuntimeError: Event loop is closed`.

The message is printed by the interpreter during shutdown as
"Exception ignored in", so it cannot change acplint's exit status. It did not
reproduce locally on Python 3.14/macOS and is timing dependent, which matches an
interpreter-shutdown GC race rather than an LLxprt fault.

**No LLxprt behaviour change is warranted. The gate must make this noise
visible and attributable instead of mysterious.**

## Accepted behaviour

### REQ-3095-001 : LLxprt identifies itself over ACP

`initializeZedAgent` includes `agentInfo` in the `initialize` response with:

- `name`: the stable programmatic identifier `llxprt-code`
- `version`: the value resolved by `getCliVersion()`

Boundary cases:

- When version resolution yields `unknown` (no `CLI_VERSION` env and no
  readable package.json), `agentInfo.version` is `unknown`. `agentInfo` is
  still present; the field is never omitted and never `null`.
- Adding `agentInfo` does not change `protocolVersion`, `authMethods`, or
  `agentCapabilities`.

### REQ-3095-002 : Every acplint run emits an inspectable summary

`scripts/validate-acplint-report.ts` writes a human-readable summary before it
decides pass or fail, so the summary exists for failing runs too. The summary
contains:

- the raw acplint status and the declared conformance level
- `agent_info` (name and version, or an explicit "not reported")
- per-category passed/failed/skipped/errored counts
- every finding, each marked `known` or `UNEXPECTED`
- every result row carrying a non-null message

The summary goes to stdout always, and is additionally appended to the file
named by `GITHUB_STEP_SUMMARY` when that variable is set and non-empty. When
the report cannot be read or parsed, the summary still emits, stating that the
report was unavailable and why.

### REQ-3095-003 : Unknown findings fail the gate

The validator carries an explicit allowlist of the exact finding strings that
the selected deterministic categories cannot avoid producing:

```text
⚠ No agent_thought_chunk notifications received at all
⚠ No available_commands_update notifications received — agent doesn't advertise commands/hooks
⚠ No usage_update notifications received — agent doesn't report usage
```

Validation rules:

- A report whose findings are a subset of the allowlist is accepted.
- A report containing any finding outside the allowlist is rejected, and the
  rejection names the offending finding.
- A report with no findings is accepted.
- The allowlist is matched by exact string equality against the pinned v0.2.0
  finding text.

This is what makes a new ACP gap surface as a red check instead of a silent
green one. The pre-existing agentInfo finding is deliberately not allowlisted,
so REQ-3095-001 is enforced by the gate rather than by hope.

### REQ-3095-004 : The gate asserts the agent identified itself

The validator rejects a report whose `agent_info` lacks a non-empty `name` or a
non-empty `version`. This turns REQ-3095-001 into a CI-enforced invariant: if
`agentInfo` is ever dropped from the initialize response, the gate fails.

### REQ-3095-005 : The acplint log is always shown

The `Run acplint` step prints the acplint log tail inside a collapsed
`::group::` on every run, not only when the raw exit status is nonzero, so
interpreter-shutdown noise like the reported traceback is visible in the job
log and attributable to acplint rather than to LLxprt.

### REQ-3095-006 : Documentation

`dev-docs/acp-conformance.md` records: the agentInfo change, the findings
surfacing and allowlist with the evidence that findings 2–4 are category
artifacts, the root cause of the Python traceback, and the extra steps required
when the acplint pin is updated (re-check the allowlisted finding strings).

## Out of scope

- Auto-filing GitHub issues from CI for findings. Surfacing is done through the
  job summary and the gate.
- Enabling the remaining eleven acplint categories, which need live model
  inference.
- Patching or forking acplint to fix its asyncio teardown or its coverage
  tracking.
- Any change to session lifecycle, storage format, transport, or capabilities
  beyond adding `agentInfo`.
