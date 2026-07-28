# Issue #1605: Zed ACP ToolKind Mapping and Chat History Recording — Verification

**Date:** 2026-07-28
**Issue:** vybestack/llxprt-code#1605
**Verified against:** `main` (commit `4fd465c4b`)
**Outcome:** Already fully delivered by PR #2502 — no code changes required.

## Summary

Issue #1605 requested two things: (1) a `toAcpToolKind()` mapping function that
converts internal `Kind` values to valid ACP `ToolKind` values with an `'other'`
fallback, and (2) recording completed tool calls into chat history for session
persistence and resumption. Both were implemented and are present on `main`.

## Acceptance Criteria Verification

### 1. `toAcpToolKind()` maps all `Kind` values to valid ACP `ToolKind` — MET

`packages/cli/src/zed-integration/zed-tool-handler.ts` defines:

- `ACP_TOOL_KINDS` — the set of valid ACP `ToolKind` values.
- `toAcpToolKind(kind: string | undefined): acp.ToolKind` — passes through
  values in `ACP_TOOL_KINDS`, maps anything else (including `undefined` and
  future non-ACP kinds like `Kind.Communicate`) to `'other'`.

The internal `Kind` enum (`packages/tools/src/tools/tools.ts`) has exactly 9
values — `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`,
`fetch`, `other` — all string-identical to ACP's `ToolKind` union, so every
`Kind` passes through correctly.

**Test evidence:** `zed-tool-kind.test.ts` — 43 tests, all pass. Covers every
`TOOL_KIND_BY_NAME` entry, every `Kind` value pass-through, and the
`undefined`/`'communicate'` → `'other'` fallback.

### 2. All `tool_call` and `tool_call_update` notifications use mapped kind — MET

`resolveToolKind(name, registeredKind)` is called in:

- `emitToolCallStart` (produces `tool_call` notifications)
- `emitToolStatus` (produces `tool_call_update` notifications)
- `emitToolResult` (produces `tool_call_update` notifications)
- `requestToolConfirmation` (produces permission requests)

The registry-sourced kind is resolved via `agent.tools.get(name)?.kind` at all
call sites in `zed-agent-event-handler.ts` (`handleToolEvent`,
`handleToolUpdate`, `handleToolResultEvent`) and `zedIntegration.ts`
(`handleToolConfirmation`). When no registered kind exists, the name-based
`inferToolKind(name)` fallback applies.

**Test evidence:** `zedIntegration.toolCall.test.ts` —
`'uses the registered tool kind on every live tool notification'` drives a tool
through `tool-call`, `tool-status`, and `tool-result` events with a registered
kind of `'search'` and asserts all three notifications carry `kind: 'search'`.

### 3. Tool history recording after each tool execution — MET (architecturally)

The issue's original premise (`call chat.recordCompletedToolCalls() in runTool`)
predates the Agent API port (#2385). In the current architecture:

- Tool execution and history recording are owned by `AgenticLoop`
  (`packages/agents/src/core/agenticLoop/AgenticLoop.ts`), which `agent.stream()`
  drives internally.
- `recordCompletedToolHistory()` (`AgenticLoop.ts:744`) persists completed tool
  calls; `recordCancelledToolHistory()` (`AgenticLoop.ts:733`) persists cancelled
  ones.
- The Zed integration consumes events via `agent.stream()` but does not (and
  cannot) reconstruct `CompletedToolCall[]` from the lossy public
  `AgentEvent`/`AgentToolResult` projections. A zed-side recording call would
  double-record.

**Test evidence:** `sessionControl.recording.behavior.test.ts` —
`'records COMPLETED TOOL CALLS (call + response) into the session JSONL for later
replay (issue #1605 verification)'` drives a real agent through a confirmed
`read_file` tool turn with recording enabled and asserts the on-disk JSONL
carries the `tool_call` block, its paired `tool_response`
(`response.callId === call.id`), and post-tool assistant text.

### 4. Session history correctly records tool calls for later resumption — MET

End-to-end replay is verified by the issue #1604 loadSession replay suite:

- `zedIntegration.loadSession.test.ts` (18 tests) — `loadSession` orchestration,
  disk-resume path, live re-attach, concurrent serialization, partial-failure
  cleanup.
- `zed-session-replay.test.ts` (24 tests) — `mapHistoryToSessionUpdates` pairing
  of `tool_call`/`tool_response`, orphan handling, duplicate response dropping,
  callId reuse across turns, trailing-failure synthesis.

**Test evidence:** 42 tests, all pass.

## Test Results Summary

| Suite                                       | Tests   | Result          |
| ------------------------------------------- | ------- | --------------- |
| `zed-tool-kind.test.ts`                     | 43      | ✅ all pass     |
| `zedIntegration.toolCall.test.ts`           | 6       | ✅ all pass     |
| `zedIntegration.prompt.test.ts`             | 21      | ✅ all pass     |
| `sessionControl.recording.behavior.test.ts` | 5       | ✅ all pass     |
| `zedIntegration.loadSession.test.ts`        | 18      | ✅ all pass     |
| `zed-session-replay.test.ts`                | 24      | ✅ all pass     |
| **Total**                                   | **117** | **✅ all pass** |

## Conclusion

All four acceptance criteria are satisfied by code already present on `main`.
No implementation work was required — this was a pure verification effort
confirming PR #2502 correctly delivered the issue's intent.
