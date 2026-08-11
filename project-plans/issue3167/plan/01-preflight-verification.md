# Phase 01: Preflight Verification (blocking)

Plan ID: PLAN-20260808-PERFTREND.P01
Status: **COMPLETE** (findings below). No implementation until every checkbox is
green; all are.

> **Preflight correction (this pass).** Source fact-checking against the live tree
> found blockers in the original artifacts and **falsified** the claim that child
> continuation ids arrive in the CLI via `AgentEvent` (§3). These blockers are
> resolved here and in the companion artifacts by decisions **D1–D8** (see
> `acceptance-criteria.md`): D1 child-id arrays removed + join at read time; D2
> nested settings; D3 claim-file concurrency accounting; D4 PerfSink does not
> inherit FileOutput's bounded/drop queue; D5 retention constants derived from a
> Bun record-size benchmark; D6 fs-failure testing via a package-private port;
> D7 report `--baseline`; D8 stdout observer fails fast. P03 (IntervalUnion)
> remains COMPLETE and is unaffected.

This phase verifies every Phase-0.5 assumption named in PLAN.md Phase 0.5 and the
task directive, against the actual source tree. Evidence is file:line.

---

## 1. Ink observer injection seam — RESOLVED (the real blocker)

**Finding:** `packages/cli/src/ui/inkRenderOptions.ts:24` builds
`const sharedStdio = createInkStdio();` at **module scope** (import time), before
any config/settings object exists → no seam to inject an observer into today.
`createInkStdio()` in `packages/core/src/utils/stdio.ts:118` returns Proxies
delegating `write` → `writeToStdout` with **no observer parameter**.

Zed builds its OWN instance separately
(`packages/cli/src/zed-integration/runZedIntegration.ts:105-112`), so a global
patch would double-count Zed.

**Ink onRender:** CLOSED (verified earlier). `node_modules/ink/build/render.d.ts:44`
declares `onRender?: (metrics: RenderMetrics) => void`; `ink.js:74-76` throttles
per actual render pass. `ink_render_ms` is a pure accumulate (Ink computes the
duration).

**Decision (locks the design):**
- `createInkStdio(observer?)` gains an **optional** `StdoutWriteObserver` param
  (pseudocode 03 lines 10-36). Absence ⇒ identical current behaviour.
- The Proxy `write` trap measures encoded bytes + sync duration, delegates to
  `writeToStdout`, preserves overload/encoding/callback/backpressure, and calls
  the observer **directly with no try/catch** (D8: internal observer/programming
  errors fail fast; only filesystem writer failures fail open as external I/O).
- `inkRenderOptions.ts` replaces the module-scope constant with a **lazy cache**
  (`getInteractiveStdio()`, pseudocode 03 lines 41-55) so a late,
  settings-gated `setInteractiveStdoutObserver()` invalidates the cache and the
  next render carries the observer.
- Zed keeps calling `createInkStdio()` with no observer ⇒ uncounted.
- A single observer accumulates globally; the operation recorder snapshots the
  delta per operation (no per-operation Proxy churn needed).

- [x] Seam absent → RESOLVED by optional-observer + lazy cache (interactive only).

## 2. Operation lifecycle seams — VERIFIED

`packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts`:
- Acquire `~:627-631`: `activeTurnRef.current = true`; installs the turn's
  `AbortController` at `:630`.
- Release `~:650-659`: inside `finally`, guarded by `isCurrentTurn(current, turnSignal)`
  (`:813-814` compares `abortControllerRef.current?.signal === signal`).
- `isCurrentTurn` is false for a superseded turn → its `finally` release never
  runs → **finalisation needs its own registry + sweep** (confirmed load-bearing).
- Cancellation: `useAgentStreamLifecycle.ts` `useCancellation` (`:219-288`) sets
  `turnCancelled`, aborts the controller, cancels tool calls.
- No-send path: `prepareTurnForQuery` (`queryPreparer.ts:82`) gates on the turn's
  own abort signal; pre-send failure flows to `handleSubmissionError`.
- Queued submissions: `useDrainSubmission` + `useScheduleNext` (`:430-530`).

- [x] Acquire/release stable; superseded unreachable via release (needs sweep).
- [x] All terminal-status paths reachable (completed/error/4×cancelled/superseded).
- [x] CLI holds initial prompt id before `runStream` (`:787`).

## 3. Prompt/turn identity + prefix invariant — VERIFIED; child-id claim CORRECTED

`packages/agents/src/core/agenticLoop/AgenticLoop.ts`:
- `:238-244`: `generateInitialPromptId() = ${sessionId}#agentic-loop#${uuid}`;
  `generateContinuationPromptId(initial) = ${initial}#continuation#${n}`.
- `run()` (`:378-410`): `initialPromptId = promptId ?? generateInitialPromptId()`;
  continuations recompute `currentPromptId = generateContinuationPromptId(initialPromptId)`.
- CLI fallback (no caller promptId): `resolvedPromptId = sessionId + '########' + count`
  (EIGHT hashes — never contains `#continuation#`).
- Existing test: `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.prompt-id.test.ts`.

⇒ `operation_id = promptId.split('#continuation#')[0]` is sound in **all** paths.

**BLOCKER FOUND (D1).** An earlier revision of this preflight claimed: "Continuation
ids reach the CLI via per-turn stream events (`useStreamEventHandlers`, `streamUtils`
carry `prompt_id`)." Source fact-checking **falsified** this: `AgentEvent`
(`packages/agents/src/api/event-types.ts`) defines ~20 variants (text, thinking,
tool-call, tool-result, tool-confirmation, tool-status, usage, model-info, notice,
compression, context-warning, retry, citation, loop-detected, idle-timeout,
invalid-stream, hook-blocked, error, done) — **none carries a per-continuation
`prompt_id`**. The `prompt_id` the CLI supplies to `agent.stream()` /
`useStreamEventHandlers` is the **outer** id only; the child continuation ids stay
inside `packages/agents`. So the CLI **cannot** observe child prompt/turn ids, and
the original plan to collect + cap them on the perf record is unimplementable
without an excluded agents→telemetry edge.

**Resolved by D1:** the perf record carries **no** `prompt_ids`/`turn_ids`
arrays/true-count; `operation_id` is the sole join key, and the report derives it
from token-usage/session `prompt_id` metadata at read time (token-usage records DO
carry per-send `prompt_id` — `tokenUsageRecords.ts:63`). Zero plumbing;
`packages/agents` untouched.

- [x] Prefix invariant holds; derivation safe; existing test to extend.
- [x] FALSE child-id claim removed; D1 join-at-read-time recorded.

## 4. Settings hierarchy / default / privacy — VERIFIED; shape CORRECTED (D2)

- `TelemetrySettings` interface: `packages/core/src/config/configTypes.ts:117`
  (`enabled`, `logConversations` default false).
- Resolved in `packages/core/src/config/configConstructor.ts` `resolveTelemetrySettings`
  (hierarchy: CLI flags > env > workspace `.llxprt/settings.json` > user > defaults).
- No zod schema for telemetry settings (interface + manual resolution) — new keys
  follow the same interface pattern; `perf?: { enabled?: boolean; memory?: boolean }`.
- `docs/telemetry-privacy.md`: persistent telemetry opt-in, disabled by default,
  records carry session/project/provider/model identity ⇒ mandatory.

**D2 (corrected):** the persisted shape is **nested** `telemetry.perf.enabled`
(master) and `telemetry.perf.memory`, both default **false**; `memory` requires
`enabled`. `telemetry.perf` is **not** itself a boolean (spec §7.4 names the
master `telemetry.perf`; the resolved persisted contract is the nested shape —
recorded here because spec is not rewritten).

- [x] Hierarchy understood; new keys follow it; default-off honoured.
- [x] Nested settings shape confirmed (D2); `telemetry.perf` is not a boolean.

## 5. FileOutput reuse + retention constraints — VERIFIED

`packages/telemetry/src/debug/FileOutput.ts`:
- Singleton (`private static instance`), `getInstance`/`disposeInstance`.
- `maxFileSize = 10*1024*1024`, `maxQueueSize = 1000`, `batchSize = 50`,
  `flushInterval = 1000`, serialized-write guard `isWriting`, `dispose()` drain.
- `fs.stat` per flush (in `checkFileRotation`); unbounded `console.error` on
  failure; `grep -c 'unlink|rm'` == **0** (never deletes anything).
- Existing test `FileOutput.test.ts` is **mock-theater** (`vi.mock('fs')`) — the
  new perf tests must NOT repeat this; they use real files (or a package-private
  fs port for fault injection — D6).

⇒ **D4 (corrected):** PerfSink does **not** inherit/extend `FileOutput` and does
not carry over its bounded/drop queue, batch+interval flush, or singleton. Narrow
file/path/append primitives are extracted/reused where practical while
`FileOutput`'s public singleton/debug behaviour is preserved. PerfSink uses a
serialized no-drop promise chain, one exclusive-create day file per run UUID, UTC
roll on next record, no gzip, no size sub-rolling. (An earlier "extend it + fix 4
defects" framing is withdrawn — that would inherit the bounded/drop queue this
design must not have.)

- [x] Reusable narrow primitives identified; FileOutput's public behaviour preserved.
- [x] PerfSink does NOT inherit FileOutput's bounded/drop queue (D4).

## 6. IntervalUnion extraction — VERIFIED

`packages/telemetry/src/telemetry/sessionMetricsAggregator.ts`:
- `IntervalUnion` is a **private** class; `add()` → `recomputeDuration()` walks
  every interval on each insert → O(n²) over a 24/7 session.
- Exports: `ApiAttemptRecord`, `ModelBreakdown`, `SessionMetricsSnapshot`,
  `SessionMetricsAggregator` (the class itself, not IntervalUnion).

⇒ Extract to exported `intervalUnion.ts`; maintain `cachedDurationMs`
incrementally; refactor `SessionMetricsAggregator` to import it.

- [x] Private + quadratic confirmed; extraction plan defined.

## 7. Memory-monitor timer/ring seam — VERIFIED

`packages/cli/src/ui/hooks/useMemoryMonitor.ts`:
- `MEMORY_CHECK_INTERVAL_MS = 60 * 1000`; unconditional interval; calls
  `process.memoryUsage().rss`; **`clearInterval(intervalId)` inside the warning
  branch** → self-terminates after warning once (the defect).
- `Footer.tsx` `ResponsiveMemoryDisplay` runs a 2 s interval **gated on
  `showMemoryUsage` and on being mounted** → NOT a viable host.

⇒ Extend the 60 s interval; separate warn-once latch from sampling loop; add a
fixed-capacity overwrite ring for the live `/perf` view. Zero new timers.

- [x] Host interval exists; self-termination is the defect to fix; ring to add.

## 8. Command routing for /perf + inspect/delete/report — VERIFIED

- Commands aggregated in `packages/cli/src/services/BuiltinCommandLoader.ts:141-200`
  (array incl. `statsCommand`, `loggingCommand`, …).
- `SlashCommand` type + subcommand pattern (`packages/cli/src/ui/commands/types.ts`,
  `statsCommand.ts`, `loggingCommand.ts`).
- `/perf` with subcommands (default/inspect/report/delete) follows the pattern.

- [x] Registration point + convention confirmed.

## 9. Version/git/project/runtime identity — VERIFIED

- `getCliVersion()` async+cached: `packages/cli/src/utils/version.ts`.
- `getGitCommitInfo()` sync+cached: `packages/cli/src/utils/gitCommitInfo.ts`.
- runtime: `process.versions`/`Bun.version`; platform: `process.platform`+`process.arch`.
- runtime_id: agent runtime state `runtime.getRuntimeId()`; session_id:
  `config.getSessionId()`; parent/subagent via subagent orchestrator keys.
- project_hash: SHA-256 of project root (cwd) — computed; path stays global.

- [x] All identity fields reachable from cli without new edges.

## 10. Concurrent-instance calculation — DESIGNED (D3)

`concurrent_instances` replaces the [EXCLUDED] `contended` drift probe at zero
timer cost. **D3 (corrected):** a per-run claim file in the global perf dir is
created on perf enable, touched by the single owned coarse maintenance interval,
and removed on clean dispose. At operation finalization the count of **non-stale**
claims (mtime within the lease window) is `concurrent_instances`. The name is kept
but the value has **lease-window semantics with bounded crash overshoot** (a
crashed run leaves a stale claim until the next sweep). This reuses one owned
maintenance timer; there is **no drift-probe timer and no additional memory
timer**. Claim files are included in retention artifact accounting but are never
parsed as JSONL records. (An earlier "count perf files by mtime, minus self"
framing is withdrawn — it conflates JSONL files with run liveness.)

- [x] Zero-timer claim-file design defined (D3).

## 11. End-to-end overhead harness design — VERIFIED FEASIBLE

Bun/`bun:test` harness exercises the REAL integrated pipeline (real PerfSink in
tmpdir + real stdout observer + real onRender path + real lifecycle registry +
fixture streaming provider). Runs perf-enabled and perf-disabled; reports
p50/p95/p99; asserts stable invariants only (no wall-clock gate). No mocks of the
recorder/sink/observer (would be mock theater).

- [x] Harness design feasible with Bun; no new deps required.

## 12. Dependency / type / test-infra checks

- `zod` present (used by `tokenUsageRecords.ts`) — schema-first mandated by RULES.
- `bun:test` is the test framework (`FileOutput.test.ts` imports from `bun:test`).
- All target packages export `.js` ESM (no CommonJS).

- [x] zod available; bun:test is the framework; ESM throughout.

## Blocking issues found

**Found and RESOLVED (D1–D8).** Source fact-checking falsified the original
"child ids arrive via AgentEvent" claim (§3) and surfaced five further design
corrections (D2 settings, D3 concurrent_instances, D4 PerfSink inheritance, D6
fs-failure testing, D8 stdout observer). All are resolved in the companion
artifacts (acceptance-criteria, domain-model, pseudocode, phase files) and do not
block implementation: every seam is verified, the Ink observer blocker is resolved
by the optional-observer + lazy-cache decision (§1), and the schema contract is
settled. P03 (IntervalUnion) remains COMPLETE. Proceed to Phase 02 → P04.

## Verification gate

- [x] All dependencies verified (no new deps; zod + bun:test present).
- [x] All types/edges match expectations (telemetry < core < agents < cli; no agents→telemetry).
- [x] All call paths possible (interactive-only observer; lifecycle acquire/release).
- [x] Test infrastructure ready (bun:test; existing tests to extend, not duplicate).
- [x] Ink observer injection mechanism DECIDED and documented.
- [x] Blockers D1–D8 resolved and applied across companion artifacts.
