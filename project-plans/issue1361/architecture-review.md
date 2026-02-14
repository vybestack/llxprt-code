# Architecture Review

## Overall Assessment

**CONDITIONAL PASS**

The architecture is directionally solid and significantly better than snapshot persistence, but there are unresolved correctness-critical details (re-subscription, schema consistency, startup ordering, and lock/materialization edge behavior) that must be tightened before implementation is considered execution-ready.

---

## Critical Concerns

1. **Flush boundary is underspecified/fragile in practice.** Plan anchors durability to `useGeminiStream` finally completion, but does not fully prove all content-emitting paths (tool callbacks, cancellation races, slash-command side effects) settle before that boundary in current architecture.

2. **Re-subscription on HistoryService replacement is high-risk and not concretely designed.** Compression-induced GeminiChat/HistoryService replacement is acknowledged, but detection strategy remains optional/pick-one, which is an architectural gap.

3. **Deferred materialization + lock lifecycle has unresolved edge ordering.** Lock may exist before file; cleanup/list/delete/resume behavior around pre-materialized sessions is not fully specified (especially stale lock without file, and ID resolution while no file exists).

4. **Event schema governance is loose across issues:** issue #1362 says `session_start` includes schema version, while top-level design says envelope `v` is canonical and not duplicated. This inconsistency can produce divergent implementations.

5. **ENOSPC behavior is intentionally simple but operationally risky:** once disabled, no recovery in-session, and no explicit observability contract for downstream components beyond UI warning.

---

## Architectural Risks

- **Single JSONL forever can become large; replay is full scan only.** This is accepted but no hard guardrails (size threshold warnings, replay latency telemetry) are planned.

- **Non-fatal skip policy for malformed known events may silently degrade restored state.** Good for availability, risky for correctness if many malformed lines occur.

- **Provider/model mismatch handling may emit `provider_switch` during resume;** if emitted before/after other startup events inconsistently, replay semantics may drift over repeated resumes.

- **Reliance on file order over seq is correct for robustness,** but seq continuation from last seen value after corrupted tails needs stricter rule to avoid reuse/rollback confusion.

---

## Integration Gaps

- **Source integration points in gemini.tsx/useGeminiStream/client/geminiChat are broad,** but plan does not map exact call sites for:
  - provider switch commits
  - directory mutation commits
  - `session_event` emission parity with existing `addItem` paths

- **AppContainer removal/migration (#1368) is large;** plan references removal targets but lacks explicit compatibility bridge period strategy to avoid breaking resume UX mid-rollout.

- **SessionDiscovery shared API is good,** but exact reuse contract across `--continue` and `--delete-session`/index resolution is not enforced by shared tests in plan text.

---

## Testing Blind Spots

- No explicit chaos tests for **interleaved events**: content + compress + rewind in same turn boundary.
- Insufficient tests for **cancellation/error turns** where partial tool output exists and flush should still persist causal subset.
- Missing end-to-end tests for **lock contention between two real processes** (not just mocked lock manager).
- Missing regression tests for **malformed known payloads** (not just unknown type/corrupt JSON) across all event types.
- No explicit tests for **repeated resume cycles** ensuring seq monotonicity and no duplicate `session_start` emission.

---

## Issue Alignment (#1361–#1369)

- Strong alignment on decomposition and dependency graph.
- **#1362/#1363** are mostly coherent, but schema/version duplication conflict should be resolved before coding.
- **#1364** correctly identifies HistoryService + subsystem capture, but re-subscription mechanism must be mandatory and concrete.
- **#1365/#1366** shared `SessionDiscovery` is a good architectural choice.
- **#1367** lock/process lifecycle scope is appropriate; needs stronger ordering guarantees with deferred materialization.
- **#1368** cleanup/removal sequencing is correct (last), but migration safety criteria are not explicit enough.
- **#1369** lock-aware cleanup is directionally correct; stale-lock deletion policy could accidentally remove recoverable sessions without a retention check.

---

## Execution Risks

- Multi-phase plan (50+ docs) risks **drift between stub/TDD/impl/verification artifacts**; contradictions already visible.
- High coupling across core and CLI packages means **partial merges can break startup path** quickly.
- If verification relies mainly on unit tests, **replay/locking bugs may survive until production-like use.**

---

## Recommendations

1. **Resolve schema contract now:** envelope `v` only, remove payload version duplication everywhere.
2. **Specify one concrete HistoryService re-subscription mechanism** (with exact hooks in geminiChat/client/useGeminiStream) and test it end-to-end.
3. **Define strict event ordering contract at startup/resume** (`session_start`, `provider_switch`, `session_event`) and codify with golden replay tests.
4. **Add process-level integration tests:**
   - dual-process lock contention
   - SIGINT during active tool turn
   - crash with partial last line + resume
5. **Add guardrail telemetry/logging:**
   - replay duration and line count
   - malformed-event warning counts threshold
   - ENOSPC disabled-state surfacing in status command/log
6. **For cleanup, require age/count policy check before deleting stale-lock sessions;** do not auto-delete merely due to stale lock.
7. **Add rollout safety gate before #1368 removal:** prove parity on resume and history reconstruction through dedicated E2E suite.

---

## Verdict

**CONDITIONAL PASS.** The architecture is directionally solid and significantly better than snapshot persistence, but there are unresolved correctness-critical details (re-subscription, schema consistency, startup ordering, and lock/materialization edge behavior) that must be tightened before implementation is considered execution-ready.
