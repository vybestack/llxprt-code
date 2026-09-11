# Plan: Issue #3535 — Subagent terminates GOAL after attempting unavailable `undefined_tool_name`

Plan ID: PLAN-20260909-ISSUE3535
Generated: 2026-09-09
Issue: vybestack/llxprt-code#3535
Branch: `issue3535`

## Problem summary (traced failure chain)

A subagent launched via the `task` tool emitted a single tool call whose name was
absent or unnormalizable. The run then terminated with
`terminate_reason: "GOAL"` and a final message reporting that
`undefined_tool_name` was unavailable, so the parent could not distinguish the
failed run from success.

Chain (verified on main @ 2aac6841e):

1. `packages/agents/src/core/turn.ts` `handlePendingFunctionCall` (L856–895)
   substitutes the literal `undefined_tool_name` whenever a tool-call block's
   name is missing (undefined/empty/whitespace) or `normalizeToolName` fails.
   `createSyntheticFunctionCallId` (L912) embeds the same literal in synthetic
   call ids. This is the only production fabricator of the literal; the other
   is `packages/providers/src/openai/ToolNameValidator.ts` (L61, L74, L94),
   which is currently dead code wired only to its own test.
2. The doomed request is dispatched (interactive path:
   `subagent.ts` `handleInteractiveToolCalls` L780–796; non-interactive path:
   `subagentToolProcessing.ts` `processFunctionCalls` L554–565). The registry
   misses, `ToolDispatcher` returns `TOOL_NOT_REGISTERED`
   (`tool-dispatcher.ts` L70–84, "could not be loaded … Did you mean"),
   `isFatalToolError` is true, and `buildToolUnavailableMessage` becomes
   `output.final_message`.
3. The fatal message is fed back to the model ("Please continue without using
   it.") but `terminate_reason` is untouched. When the model stops calling
   tools, `checkGoalCompletion` (`subagentExecution.ts` L305–321) sets
   `GOAL`, and `finalizeOutput` preserves the fatal text. Result: `GOAL` with
   a tool-failure final message — the masking bug.

## Accepted behavior (acceptance criteria)

### AC1 — Never fabricate the literal `undefined_tool_name`

Tool-call construction must never substitute the literal `undefined_tool_name`
for an absent/unnormalizable tool name.

- `turn.ts` `handlePendingFunctionCall`: when the incoming name is absent or
  unnormalizable, the emitted `ToolCallRequestInfo` carries the raw name
  unchanged (an empty name stays empty). The call must still be dispatched so
  the existing `TOOL_NOT_REGISTERED` path produces a proper `tool_response`
  (no dangling tool_use, which would break provider protocols on the next
  request).
- `createSyntheticFunctionCallId`: no `undefined_tool_name` in the id; use the
  raw name when normalization fails.
- `ToolNameValidator` (providers): invalid results keep `isValid: false` and
  carry an empty `name`, never the literal.

### AC2 — A fatal tool error that killed the run must not terminate GOAL

When a run's tool dispatch hit a fatal tool error
(`isFatalToolError`: `TOOL_DISABLED` or `TOOL_NOT_REGISTERED`) and no later
tool execution succeeded, the run must terminate with
`SubagentTerminateMode.ERROR` instead of `GOAL`, in both the interactive and
non-interactive subagent paths.

- Recovery is preserved: the fatal message is still fed back to the model. If
  a subsequent tool call succeeds (or `self_emitvalue` emits), the fatal
  condition is cleared and normal `GOAL` completion applies.
- Precedence: if all declared `outputConfig` outputs were emitted, the run
  still completes `GOAL` (the caller's output contract was satisfied); the
  fatal condition is cleared at those sites.

Implementation shape: an optional `OutputObject.unrecovered_fatal_tool_error?: string`
field (packages/core `subagentTypes.ts`) recording the fatal message; shared
set/clear helpers in `subagentToolProcessing.ts` used by both paths;
`checkGoalCompletion` converts the flag to `ERROR` termination (final message
already the fatal message) at the two `GOAL` branches and returns null (stop);
`subagentNonInteractive.ts` completed-declared-outputs `GOAL` site clears the
flag.

### AC3 — The task result identifies the malformed call

For the AC2 `ERROR` termination, `final_message` is the existing fatal
tool-unavailable message (raw tool name + dispatcher detail with "Did you
mean" suggestions), so `task`'s `terminateReason`/`finalMessage` fields give
the caller an actionable failure.

## Boundary cases

- Name `undefined`, `''`, whitespace-only, or unnormalizable garbage → raw
  passthrough (AC1); dispatch fails `TOOL_NOT_REGISTERED` as today.
- Well-formed but unregistered name (e.g. model calls `grep`) → identical
  semantics: fatal tracked, recovery possible, ERROR only if unrecovered.
- First-and-only tool call fatal, model then stops → `ERROR` (the issue
  reproduction).
- Fatal, then a successful tool call / successful `self_emitvalue`, then stop →
  `GOAL` (recovery preserved).
- Repeated fatals with no success → `ERROR`.
- Fatal plus all declared outputs emitted → `GOAL`.
- Non-fatal errors (`EXECUTION_ERROR`, `INVALID_TOOL_PARAMS`, …) never set the
  flag; existing behavior unchanged.
- Todo-pause termination paths unchanged.
- No `undefined_tool_name` may appear in any emitted event, synthetic id, or
  final message.

## Out of scope (explicitly)

- No changes to `ToolDispatcher` messages ("could not be loaded", suggestion
  logic) beyond what AC1–AC3 require (none expected).
- No immediate-ERROR kill switch on fatal tool errors (would break recovery;
  issue is labeled recoverability).
- No retry orchestration, no provider-protocol rework, no cleanup of unrelated
  `undefined_tool_name` test fixtures beyond updating stale assertions.
- No new JS files; everything TypeScript + `bun:test`.

## Test plan (behavioral, bun:test; extend existing files where they exist)

New: `packages/agents/src/core/subagentNonInteractive.issue3535.test.ts`
(harness copied from `subagentNonInteractive.issue3540.test.ts`
`runDirectNonInteractive` — real `GemmaToolCallParser`, real scheduler via
`createMockConfig`, real dispatch):

1. Native tool_call with an empty name as the first and only call, then a
   plain-text stop → `terminate_reason === 'ERROR'`, `final_message` contains
   "is not available" and identifies the call; never `GOAL`.
2. Unnormalizable garbage name (e.g. `"not a tool!!"`) → same ERROR outcome,
   final message contains the raw name.
3. Fatal empty-name call, then `self_emitvalue` successes that emit all
   declared outputs → `GOAL` (recovery/precedence).
4. No `undefined_tool_name` anywhere in the output.

Extend:

- `packages/agents/src/core/turn.test.ts` (undefined-name cases L302–347):
  expect raw-name passthrough (`''`), not `undefined_tool_name`.
- `packages/agents/src/core/turn.undefined_issue.test.ts`: replace literal
  assertions with raw-passthrough assertions.
- `packages/agents/src/core/subagentExecution.test.ts`
  (`checkGoalCompletion`): flag set → `ERROR` + stop; flag cleared → `GOAL`;
  flag set but all declared outputs emitted → `GOAL`.
- `packages/agents/src/core/subagentToolProcessing.test.ts`: flag set on
  fatal, cleared on success; `finalizeOutput` still preserves the fatal
  message for `ERROR`.
- `packages/providers/src/openai/__tests__/ToolNameValidator.test.ts`:
  invalid cases expect `name === ''` and `isValid === false`.

## Implementation phases

### Phase 0.5 — Preflight

Baseline: `npm run lint`, `npm run typecheck`, `npm run test` (targeted files
first, then full), confirm no pre-existing failures to attribute.

### Phase 1 — Stop fabricating the literal (AC1)

- `turn.ts`: raw passthrough in `handlePendingFunctionCall`; drop both
  `undefined_tool_name` assignments and the `name || 'undefined_tool_name'`
  belt-and-suspenders; `createSyntheticFunctionCallId` uses raw name.
- `ToolNameValidator.ts`: invalid results keep empty `name`.
- Update the two test files above.

### Phase 2 — Fatal-error termination semantics (AC2/AC3)

- `packages/core/src/core/subagentTypes.ts`: add optional
  `unrecovered_fatal_tool_error?: string` to `OutputObject` with a doc
  comment referencing #3535.
- `subagentToolProcessing.ts`: exported
  `recordFatalToolError(output, message)` / `recordSuccessfulToolExecution(output)`
  helpers; wire into `processFunctionCalls` (set on fatal branch, clear when a
  call completes without error) and into the `self_emitvalue` success paths
  (`handleEmitValueCall`, `executeNonInteractiveTool` emit branch).
- `subagent.ts` `handleInteractiveToolCalls`: set flag at the existing
  `fatalCall` branch; clear when any completed call (or manual emit) succeeded.
- `subagentExecution.ts` `checkGoalCompletion`: both `GOAL` branches —
  if flag set → `terminate_reason = ERROR`, log, return null; else `GOAL` as
  today.
- `subagentNonInteractive.ts` completed-declared-outputs `GOAL` site (L533):
  clear flag when setting `GOAL` there.

### Phase 3 — Tests (written with/against each phase; behavioral first)

Files listed in the test plan. Harness: issue3540 pattern (mocked
`sendMessageStream` async generator, `vi.mock` only for
`LocalTodoStore` — no mock theater).

### Phase 4 — Verification cycle (full)

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, then smoke:
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

## Review gates

- deepthinker compliance review — completed, 2 rounds (cap reached).
  - Round 1 (FAIL): 6 findings — (1) HIGH failed calls cleared the fatal flag;
    (2) HIGH interactive stop text overwrote the fatal diagnostic;
    (3) MEDIUM fatal dispatch dropped the structured tool_response;
    (4) MEDIUM interactive mixed batches let a fatal override a later success;
    (5) LOW flag survived declared-output GOAL completion and successful
    todo-pause; (6) MEDIUM test-quality gaps. All remediated.
  - Round 2 (follow-up, findings verification): 1/2/5 RESOLVED; 3/4/6 partial —
    remediation had introduced a duplicate tool_response forward in the
    interactive fatal branch, classifyToolCompletions still used request
    order, and several test gaps remained. Final remediation round resolved
    all three: duplicate forward removed (buildPartsFromCompletedCalls owns
    forwarding), recovery made order-independent (availability fatals are
    decided at dispatch validation before any sibling executes, so any
    successful execution in a batch proves recovery), and all test gaps
    closed (145 targeted tests).
  - Known limitation (documented per the 2-round cap): the harness's
    pairing-count assertions passed both before and after the duplicate-removal
    fix — they verify the final request's response count but do not
    independently detect the internal duplication; the mixed-batch
    regression test is what fails on the pre-fix code.
- open-code-review (ocr, `--provider zai-anthropic --model glm-5.3`, max 2
  rounds), findings triaged Blocker-Fix / In-scope-Fix / Reject / Defer.
  - Round 1 (12 findings, glm-5.3 verified in session manifest): fixed —
    HIGH order-insensitive interactive recovery unsound (runtime TOOL_DISABLED
    completes during execution, e.g. GenerateImageTool capability errors);
    MEDIUM manual-emit phase split (emit clears during partition before the
    scheduler fatal is recorded); MEDIUM todoReminder branch bypassed the
    fatal→ERROR guard (nudged a tool-broken model to MAX_TURNS); MEDIUM
    recovered runs kept the stale fatal `final_message` (parent-facing result
    read as failure on a GOAL run); plus test/polish findings (restored
    warnings assertions, stale titles, no-op assignment, shared raw-name
    resolver, `completeWithGoal` helper, misplaced JSDoc, dead test generator).
    Remediation: request-order classification over scheduler calls + manual
    emits (markers), pre-batch flag snapshot/restore, equality-guarded
    diagnostic clear, fail-fast on the todo nudge path. 151 targeted tests.
  - Rejected (scope): delete-or-wire `ToolNameValidator` and the live
    `toolNameUtils.processFinalToolName` fabrication path — provider-side and
    out of #3535 scope; filed as #3639 instead.
  - Round 2 (5 findings, glm-5.3 verified): fixed — HIGH positional marker
    indexing in `classifyToolCompletions` broke when
    `CoreToolScheduler.deduplicateRequests` dropped duplicate callIds
    (undefined deref killing the run, or misattributed classification);
    rekeyed markers by callId via a Map with unresolved-id skip. LOW bugs:
    `resolveRawToolName` threw on truthy non-string names (typeof guard +
    stringification at the external-input boundary); duplicate
    ToolNameValidator tests merged into one honest test. LOW: redundant
    `preBatchFatal` capture/restore removed (provably re-derived from
    markers). Deferred: harness typing façade (`as unknown as` constructor/
    config casts) — established harness pattern, out of scope.
    154 targeted tests; both round-2 bugs reproduced test-first.
  - Note: the round-2 ocr session itself failed to finalize ("no space left
    on device") after emitting findings — transient disk pressure from the
    concurrent build+test+ocr chain; findings were recovered from stdout.
    The same pressure crashed three zed-acp test files in the concurrent
    full-suite run; all 27 pass in isolation.
- PR `Fixes #3535`; watch CI + CodeRabbit until green; no self-merge.

## Session recovery notes (2026-09-11)

The original session was interrupted mid-verification on 2026-09-09 (stale
`packages/mcp/dist` from an interrupted build broke module resolution;
regenerated with `npm run build`). Verification baseline:
`packages/cli/src/utils/startup-fatal-log.test.ts` fails on macOS only
(`/var` vs `/private/var` cwd resolution), pre-existing, unrelated to this
change, filed as #3632; Linux CI is unaffected.
