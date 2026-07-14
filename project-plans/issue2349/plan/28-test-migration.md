# Phase 28: Test migration — behavioral rewrite off Google fixtures

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P28`

## Prerequisites
- Required: Phase 27 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P27" packages/agents/src`
- Expected files from previous phase: remaining-group retype complete → ZERO prod `@google/genai` imports (`grep -rl "@google/genai" packages/agents/src | grep -v test` ⇒ empty); AST `--count` at the bounded floor.
- Preflight verification: Phase 0.5 completed.
- Reference: overview §3.3-A, §8.1, Appendix A.5/A.6.

## Requirements Implemented (Expanded)

### REQ-INT-005.1: Agent-loop tests behavioral, off {candidates}
**Full Text**: Agent-loop tests assert OBSERVABLE outputs (emitted `ServerAgentStreamEvent`s, committed `HistoryService` state, retry ordering, finish/stop reasons) — NOT `GenerateContentResponse`/`{candidates}` internals. Tests that only asserted Google shape are DELETED or rewritten around neutral behavior. The 54 raw-importer tests + the no-import structural fixtures (§3.3-A classes) are migrated per disposition.
**Behavior**:
- GIVEN: an agent-loop test that previously asserted `{candidates}`/`GenerateContentResponse` shape
- WHEN: it is migrated per its Appendix P28-A disposition (RB/DEL/CHAR/REL)
- THEN: it asserts only observable outputs (events/history/finish reasons) and NO `{candidates}` internals, and it still passes against the now-neutral pipeline
**Why This Matters**: locks the migration to observable behavior so the neutral pipeline can never regress silently and #2424-style shape assertions cannot creep back.

### REQ-012.3: Characterization allow-list finalized (test gate)
**Full Text**: A small, explicitly-named set of converter/boundary characterization tests may retain Gemini structural assertions (`boundaryRecovery.test.ts`, `chatSession.thinking-toolcalls.repro.test.ts`, `switch-context.spec.ts`, plus hook-wire fixtures IFF OQ-1a keeps the wire Gemini-shaped). All others are neutral. This list is recorded in the central allow-list (P31).
**Behavior**:
- GIVEN: the finalized agents test suite
- WHEN: the test gate runs
- THEN: only the named allow-list tests may contain Gemini structural fixtures, and every allow-listed test uses LOCAL structural fixtures (typed locally/`unknown`, NO `@google/genai` import — Minor 3) so the P32 dependency removal validates the SAME target state with no later churn
**Why This Matters**: makes the test-gate target identical before and after P32 (no two-phase target).

## Implementation Tasks
- Rewrite the 54 raw-importer agents tests (Appendix A.5) to drop `@google/genai` and assert neutral behavior, OR delete purely structural ones.
- Rewrite the no-import structural fixture tests (Appendix A.6 classes 1-4) per §3.3-A disposition: agent-loop fabrications → neutral IContent fixtures; converter/boundary characterization → retain on allow-list.
- Update `eventHarness.ts`/`realLoopHarness.ts` helpers to produce neutral `IContent`/`ModelStreamChunk` fixtures (mock only the provider stream).
- Confirm the earlier characterization tests (P06/P10/P12/P14/P16/P18/P20/P22/P24/P26) remain the behavioral backbone.
- **SEMANTIC per-file disposition audit (Major 5 round 8 — the PRIMARY proof of behavior-coverage preservation).** Produce `project-plans/issue2349/.completed/P28-disposition-audit.md` with ONE ROW PER RB (rewrite-behavioral) file recording, as prose (NOT a keyword count): (1) the OLD behavior(s) the test asserted before migration; (2) the NEW OBSERVABLE assertions after migration (which emitted `ServerAgentStreamEvent`s / committed `HistoryService` state / finish-stop reasons it now checks); (3) WHY breaking the real implementation would FAIL the rewritten test (the specific behavioral link — e.g. "if the #2329 refusal `stopReason` were dropped, the `Finished.stopReason==='refusal'` assertion fails"). A row whose (3) cannot name a concrete implementation-break that the test would catch means the test is structure-only or vacuous and MUST be re-authored. This audit is the behavior-not-structure proof (RULES.md §94-108/§399-408); the keyword/file-count baseline below is retained ONLY as a smoke cross-check, NOT the primary proof. Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P28`, `@requirement:REQ-INT-005.1`.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P28`, `@requirement:REQ-INT-005.1/REQ-012.3`.

## Appendix P28-A — per-file disposition (Major 5): every file in the 54 raw-importer set + the no-import structural set
Each file has EXACTLY ONE disposition: **RB** = rewrite-behavioral (assert observable events/history/finish reasons; drop `@google/genai`); **DEL** = delete-as-pure-internal-shape (the test ONLY asserted `{candidates}`/`.parts` shape with no behavioral value); **CHAR** = retain-as-named-boundary-characterization with LOCAL fixtures (on the §8.1 allow-list, zero SDK import); **REL** = relocate the Gemini-shape assertion to the provider/conversion package (the assertion belongs to a Gemini boundary that now lives outside agents). Coordinator MUST NOT delete behavioral coverage: a file is DEL ONLY if it asserts pure shape with no behavior; otherwise RB. Verification proves behavior coverage is PRESERVED by counting behavioral tests per behavior-area (below) and comparing each against the FROZEN pre-migration baseline captured in `.completed/P0.5.md` (P0.5 Task 15, Major 5) — not merely that imports vanished. If the P0.5 baseline block is missing, P28 FAILS (no invented baseline).

### A.5 — the 54 raw `@google/genai` importers (overview Appendix A.5)
Helpers (produce neutral fixtures; RB-helper): `agents/executor-test-helpers.ts`, `api/__tests__/helpers/eventHarness.ts`, `api/__tests__/helpers/realLoopHarness.ts`, `core/agenticLoop/__tests__/agenticLoop-test-helpers.ts`, `core/client-test-helpers.ts`, `core/subagent-test-helpers.ts` — **RB (helper)**: emit neutral `IContent`/`ModelStreamChunk`; mock only the provider `AsyncIterable<IContent>`. (C2: `executor-test-helpers.ts`/`subagent-test-helpers.ts` also drop `streamChunkWrapper` imports — deleted P25.)

Executor: `agents/executor.execution.test.ts` **RB**, `agents/executor.recovery.test.ts` **RB**, `agents/executor.test.ts` **RB**.

API/event: `api/__tests__/event-characterization.spec.ts` **RB** (asserts public `ServerAgentStreamEvent` sequence — the neutral event shape is the point).

Core streaming/turn (agent-loop, all **RB** — assert emitted events / committed history / finish-stop reasons, drop `{candidates}` fixtures): `core/__tests__/executionControlErrors.test.ts`, `core/__tests__/turn.thinking.test.ts`, `core/StreamProcessor.retryBoundary.test.ts`, `core/StreamProcessor.yieldAsYouGo.test.ts`, `core/turn.abort-timeout.test.ts`, `core/turn.debug-responses.test.ts`, `core/turn.hook-events.test.ts`, `core/turn.idle-timeout.test.ts`, `core/turn.preRequestTimeout.test.ts`, `core/turn.test.ts`, `core/turn.tool-restrictions.test.ts` (also C2 streamChunkWrapper drop), `core/turn.undefined_issue.test.ts`, `core/turn.issue2329.test.ts` (**RB** — #2329 refusal/stop reason is OBSERVABLE via the `Finished` event; keep the behavior, drop `{candidates}`).

chatSession (agent-loop, **RB**): `core/chatSession.directRefusal.issue2329.test.ts`, `core/chatSession.issue1150.integration.test.ts`, `core/chatSession.runtime.history.test.ts`, `core/chatSession.runtime.streaming.test.ts`, `core/chatSession.runtime.test.ts`, `core/chatSession.thinkingHistory.test.ts`.

client (**RB**): `core/client.editor-context.test.ts`, `core/client.hooks.test.ts`, `core/client.ide-context.test.ts`, `core/client.lifecycle.test.ts`, `core/client.methods.test.ts`, `core/client.model-profile.test.ts`, `core/client.sendMessageStream-errors.test.ts`, `core/client.sendMessageStream-overflow-compression.test.ts`, `core/client.sendMessageStream-overflow.test.ts`, `core/client.sendMessageStream-thinking.test.ts`, `core/client.sendMessageStream.test.ts`, `core/client.test.ts`, `core/clientHelpers.test.ts`.

Other core (**RB**): `core/__tests__/subagent.stateless.test.ts`, `core/agenticLoop/__tests__/agenticLoop.auto-policy.test.ts`, `core/ConversationManager.modelStamp.test.ts`, `core/coreToolScheduler.edit-cancel.test.ts`, `core/MessageStreamOrchestrator.modelinfo.test.ts`, `core/MessageStreamOrchestrator.todoPause.test.ts`, `core/subagent.buildParts.test.ts`, `core/subagent.create.test.ts`, `core/subagent.runNonInteractive-execution.test.ts`, `core/subagent.runNonInteractive.test.ts`.

MessageConverter conversion tests — **CHAR or REL** (these test the neutral↔Gemini converter directly): `core/MessageConverter.issue1844.test.ts`, `core/MessageConverter.issue2329.test.ts` — decide per test: if the assertion is on `ContentConverters` (core-owned converter) it is **REL** to the provider/conversion characterization in `packages/core` (the converter lives in core); if it asserts an agents-boundary behavior it is **RB**. `MessageConverter` in agents loses its fabricators (P09/P13), so any test asserting `convertIContentToResponse` output is **DEL** (the fabricator is gone).

### A.6 — no-import structural fixtures (overview Appendix A.6, classes 1-4)
Class 1 `{candidates}` (5): `core/__tests__/chatSession.runtimeState.test.ts` **RB**, `core/chatSession.hook-control.test.ts` **CHAR** (hook-wire fixture; OQ-1a keeps the wire → local fixture, allow-listed), `core/chatSession.issue1749.test.ts` **CHAR** (hook-wire), `core/subagent.runNonInteractive-term.test.ts` **RB**, `core/subagent.stream-idle.test.ts` **RB**.

Class 2 `{role,parts}` (15): request/history INPUT builders → **RB** (neutral `IContent` fixtures): `api/__tests__/core-conversation.spec.ts`, `api/__tests__/core-history.spec.ts`, `api/__tests__/session.spec.ts`, `compression/__tests__/compression-recency.test.ts`, `compression/__tests__/compression-retry-hardlimit.test.ts`, `core/__tests__/compression-logic.test.ts`, `core/__tests__/compression.test.ts`, `core/baseLlmClient.test.ts`, `core/ChatSessionFactory.test.ts`, `core/ChatSessionFactory.tokenReestimate.test.ts`, `core/clientLlmUtilities.test.ts`; **CHAR** (converter/boundary): `api/__tests__/switch-context.spec.ts`, `core/__tests__/boundaryRecovery.test.ts`; hook-wire **CHAR**: `core/chatSession.hook-control.test.ts`, `core/chatSession.issue1749.test.ts` (already listed Class 1).

Class 3 `.parts` (5): `core/chatSession.thinking-toolcalls.repro.test.ts` **CHAR** (converter/boundary), `api/__tests__/switch-context.spec.ts` **CHAR**, `core/subagentExecution.test.ts` **RB** (`:148,:186` assert `result[0].parts[0]` → assert neutral `ContentBlock[]` once subagent output is neutral), `api/__tests__/core-history.spec.ts` / `api/__tests__/session.spec.ts` **RB** (public history round-trip → assert neutral history projection; classify with §4 contract-surface migration).

Class 4 converter-boundary (2): `core/__tests__/boundaryRecovery.test.ts` **CHAR**, `core/chatSession.thinking-toolcalls.repro.test.ts` **CHAR** — both intentionally exercise the persisting neutral↔Gemini converter boundary; retain on the §8.1 allow-list with LOCAL fixtures.

**Named CHAR allow-list (final, ties to REQ-012.3 + P31):** `boundaryRecovery.test.ts`, `chatSession.thinking-toolcalls.repro.test.ts`, `switch-context.spec.ts`, and the hook-wire pair `chatSession.hook-control.test.ts` / `chatSession.issue1749.test.ts` (IFF OQ-1a keeps the hook wire Gemini-shaped — which it does; the wire is preserved). Every CHAR file uses LOCAL structural fixtures (typed locally/`unknown`), ZERO `@google/genai` import.

## Constraints
- No mock theater / reverse testing / structure-only. Keep ≥30% property-based where tests are rewritten.

## Verification Commands
```bash
# Minor 3: P28 FINAL state already uses LOCAL structural fixtures — ZERO @google/genai imports in agents tests,
# so P31's test allow-list and P32 dep removal validate the SAME target state (no later churn):
if grep -rl "@google/genai" packages/agents/src | grep -E "\.(test|spec)\.|test-helpers|__tests__"; then echo "FAIL: an agents test still imports @google/genai (allow-listed char tests must use LOCAL fixtures)"; exit 1; fi
# The allow-listed characterization tests still exist but assert Gemini SHAPE via local objects (typed locally/unknown):
grep -rlE "boundaryRecovery\.test|chatSession\.thinking-toolcalls\.repro\.test|switch-context\.spec" packages/agents/src   # present, but 0 @google/genai imports (checked above)
# The CHAR allow-list is EXACTLY the five named files (no accidental additions):
test "$(grep -rlE 'boundaryRecovery\.test|chatSession\.thinking-toolcalls\.repro\.test|switch-context\.spec|chatSession\.hook-control\.test|chatSession\.issue1749\.test' packages/agents/src | sort -u | wc -l)" -eq 5
npm test -- packages/agents   # all green

# ---- MAJOR 5 (PRIMARY PROOF, round 8): SEMANTIC per-file disposition audit ----
# The audit is the PRIMARY behavior-coverage proof; the keyword/file-count baseline below is a SMOKE cross-check only.
AUDIT=project-plans/issue2349/.completed/P28-disposition-audit.md
test -f "$AUDIT" || { echo "FAIL(Major 5): semantic per-file disposition audit missing (P28-disposition-audit.md)"; exit 1; }
# Every RB file in Appendix P28-A MUST have an audit row naming OLD behavior + NEW observable assertions + WHY breaking the impl fails the test.
# Enumerate the RB files actually migrated on this slice (the A.5/A.6 RB set = agents *.test.ts/*.spec.ts that dropped @google/genai and are not CHAR):
CHAR='boundaryRecovery\.test|chatSession\.thinking-toolcalls\.repro\.test|switch-context\.spec|chatSession\.hook-control\.test|chatSession\.issue1749\.test'
missing=0
while IFS= read -r rb; do
  base=$(basename "$rb")
  # each RB file must appear in the audit AND its row must contain a "why-break-fails" clause (heuristic: the words 'fail'/'would break' near the filename row)
  if ! grep -qF "$base" "$AUDIT"; then echo "FAIL(Major 5): RB file '$base' has no semantic audit row"; missing=1; fi
done < <(grep -rlE "$CHAR" -L packages/agents/src --include='*.test.ts' --include='*.spec.ts' 2>/dev/null | grep -vE "test-helpers")
test "$missing" -eq 0 || { echo "FAIL(Major 5): one or more RB files lack a semantic audit row"; exit 1; }
# Each audit row MUST assert a concrete implementation-break (behavior-not-structure); FAIL if any row lacks a why-break clause:
grep -qiE "would fail|breaking .* fails|fails if|regress" "$AUDIT" || { echo "FAIL(Major 5): audit rows do not name concrete implementation-breaks (structure-only/vacuous)"; exit 1; }
echo "OK(Major 5): semantic per-file disposition audit present with why-break clauses (PRIMARY proof)"
# ---- MAJOR 5 (SMOKE cross-check only): behavior-area keyword/file counts vs the FROZEN P0.5 baseline ----
# The PRE-migration baseline is captured in `.completed/P0.5.md` by P0.5 Task 15 using the BYTE-IDENTICAL
# probe commands below. P28 PARSES those recorded values MECHANICALLY and FAILS if the baseline
# block is missing OR any post-migration count drops below it. This is a SMOKE check (necessary, not sufficient) —
# the semantic audit above is the primary proof. Behavior-area probes (observable assertions,
# NOT {candidates}) — MUST match P0.5 Task 15 verbatim:
BASE=project-plans/issue2349/.completed/P0.5.md
test -f "$BASE" || { echo "FAIL(Major 5): P0.5 marker missing — no behavior-area baseline to compare against"; exit 1; }
grep -qE "P28 behavior-area baseline counts" "$BASE" || { echo "FAIL(Major 5): P0.5 marker lacks the 'P28 behavior-area baseline counts' block (P0.5 Task 15)"; exit 1; }
#   #2329 refusal/stop reason (Finished event):
cur_refusal=$(grep -rlE "issue2329|directRefusal|stopReason|finishReason" packages/agents/src --include='*.test.ts' --include='*.spec.ts' | wc -l | tr -d ' ')
#   retry/abort/timeout ordering:
cur_retry=$(grep -rlE "retryBoundary|abort-timeout|idle-timeout|preRequestTimeout" packages/agents/src --include='*.test.ts' | wc -l | tr -d ' ')
#   history commit-once / thinking history:
cur_history=$(grep -rlE "thinkingHistory|modelStamp|runtime\.history" packages/agents/src --include='*.test.ts' | wc -l | tr -d ' ')
#   hook events / tool restrictions:
cur_hook=$(grep -rlE "hook-events|tool-restrictions|hook-control" packages/agents/src --include='*.test.ts' | wc -l | tr -d ' ')
#   overflow/compression:
cur_overflow=$(grep -rlE "overflow|compression" packages/agents/src --include='*.test.ts' | wc -l | tr -d ' ')
# Parse the frozen baselines from the P0.5 marker (labeled key=value lines from P0.5 Task 15):
for pair in "refusal-stop:$cur_refusal" "retry-abort-timeout:$cur_retry" "history-thinking:$cur_history" "hook-tool-restrictions:$cur_hook" "overflow-compression:$cur_overflow"; do
  key=${pair%%:*}; cur=${pair##*:}
  base=$(grep -oE "$key=[0-9]+" "$BASE" | head -1 | cut -d= -f2)
  if [ -z "$base" ]; then echo "FAIL(Major 5): baseline '$key=' absent from $BASE"; exit 1; fi
  if [ "$cur" -lt "$base" ]; then echo "FAIL(Major 5): behavior-area '$key' dropped ($cur < baseline $base) — a DEL was applied where RB was required; restore the behavioral test"; exit 1; fi
  echo "OK(Major 5): $key post=$cur >= baseline=$base"
done
# Every DEL disposition MUST be justified in THIS phase's completion marker (which file, why it was pure-shape).
```

## Success Criteria
- Agents tests neutral; the named characterization allow-list retains Gemini STRUCTURAL assertions via LOCAL fixtures only (ZERO `@google/genai` imports anywhere under `packages/agents/src` tests); all green. This is the identical target state that P31's test gate and P32's dependency removal validate — no two-phase test target (Minor 3).
- **Major 5:** every file in the A.5 (54) + A.6 (no-import) sets has exactly one applied disposition per Appendix P28-A; the CHAR allow-list is EXACTLY the five named files; and behavior coverage is PRESERVED, proven PRIMARILY by the SEMANTIC per-file disposition audit (`.completed/P28-disposition-audit.md`): every RB file has a row naming OLD behavior + NEW observable assertions + a concrete implementation-break the rewritten test would catch (behavior-not-structure, RULES.md §94-108/§399-408). The keyword/file-count baseline vs `.completed/P0.5.md` (P0.5 Task 15) is retained as a SMOKE cross-check only (P28 FAILS if the audit is missing/vacuous, the baseline block is missing, or any count drops). Any DEL is justified in THIS phase's completion marker as pure-shape-only.

## Failure Recovery
1. If a rewritten test now only asserts structure or uses mock theater / reverse testing: re-author it around observable behavior (events/history) — a neutral test must still prove behavior.
2. If a test genuinely needs Gemini structural fixtures: it must be a converter/boundary characterization test on the §3.3-A / REQ-012.3 allow-list, using LOCAL structural objects (typed locally/`unknown`), NOT a `@google/genai` import in `packages/agents`.
3. If agents tests go red after rewrite: the rewrite changed asserted behavior — reconcile against the P06/P10/P12/P14/P18/P20 characterization backbone.
4. `git checkout --` the affected test/helper files and re-author. Cannot proceed to Phase 29 until all agents tests are green and the test gate would pass.

## Phase Completion Marker
`project-plans/issue2349/.completed/P28.md`.
