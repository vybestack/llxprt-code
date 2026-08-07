# Issue #3109 — `getHistory()` deep-clones the entire conversation on every call

Performance task. The retention-causation claim in the original issue body was
**disproven** by the instrumented probe in #3111 (0/8 tracked `structuredClone`
results survived a forced `Bun.gc(true)`); the steady-state leak is unbounded
thinking-block accumulation, tracked separately. What remains valid and is the
whole of this task: `ConversationManager.getHistory()` deep-copies the entire
conversation on every call, from many per-turn call sites, when every caller
needs only a read-only view.

## Current behaviour

`packages/agents/src/core/ConversationManager.ts`:

    getHistory(curated: boolean = false): IContent[] {
      const iContents = curated
        ? this.historyService.getCurated()
        : this.historyService.getAll();
      return structuredClone(iContents);
    }

`HistoryService.getAll()` already returns `[...this.history]` and
`getCurated()` already builds a fresh array via `buildCuratedHistory`. So the
array is **already** isolated from the live history before `structuredClone`
runs. The only thing the deep clone adds is per-entry (deep) isolation, at the
cost of materialising the system prompt, the LLXPRT.md context block, every
prior turn, all tool I/O, and all serialised request bodies on every call.

## Call-site audit (evidence for the change)

Every non-test call site was inspected. **None mutates the returned entries.**

| Call site | Use | Mutates entries? |
| --- | --- | --- |
| `agents/src/core/MessageStreamOrchestrator.ts:404` | reads `length` + last entry's blocks (**per turn**) | no |
| `agents/src/core/turn.ts:588` | `[...getHistory(true), req]` → `reportError` (serialise) | no |
| `agents/src/core/client.ts:291` | snapshot into `_previousHistory` across auth re-init | no |
| `agents/src/core/client.ts:426` | client-level accessor pass-through | no |
| `agents/src/api/agentImpl.ts:882` | public `getHistory()` — **already typed `readonly`** | no |
| `agents/src/api/agentImpl.ts:1229` | `carriedHistory` → `startChat(...)` | no |
| `agents/src/api/control/sessionControl.ts:220` | returned to caller | no |
| `agents/src/api/control/sessionControl.ts:282` | `priorHistory` rollback snapshot → `setHistory` | no |
| `agents/src/api/control/sessionControl.ts:647` | → `HistoryMutationService.clear(history: readonly IContent[], …)` | no |
| `agents/src/api/control/sessionControl.ts:890` | `recordContent(item)` per entry | no |
| `core/src/config/agentClientLifecycle.ts:114` | `length` + copy-on-write `stripThoughtSignatures` | no |
| `core/src/config/config.ts:367` | `length` only | no |
| `core/src/utils/checkpointUtils.ts:124` | `JSON.stringify` | no |
| `cli/src/ui/hooks/agentStream/checkpointPersistence.ts:101` | `JSON.stringify` | no |
| `cli/src/ui/commands/copyCommand.ts:30` | `filter` / `map` | no |
| `cli/src/ui/commands/chatCommand.ts:445` | → `HistoryMutationService.clear` (readonly param) | no |
| `cli/src/ui/commands/chatCommand.ts:494` | → `HistoryMutationService.restore` (readonly param) | no |
| `cli/src/ui/commands/chatCommand.ts:669` | `length` only | no |
| `cli/src/zed-integration/zed-session-loader.ts:141` | `[...history]` | no |

Corroborating invariant: the history layer already treats stored `IContent`
entries as **immutable**. Every in-place edit path replaces the array slot
rather than mutating the entry —
`HistoryService.replaceToolResponse` (`this.history[i] = { ...entry, blocks }`),
`applyDensityMutations` (`history[index] = replacement`),
`client.setHistory({ stripThoughts: true })` (maps to new objects),
`agentClientLifecycle.stripThoughtSignatures` (maps to new objects).
Because entries are already copy-on-write, sharing them with readers is safe.

Therefore no caller needs an isolated mutable deep copy, and **no
`cloneForMutation()` escape hatch is added** — a clone API with zero callers
would be speculative dead code.

## Accepted behaviour (acceptance criteria)

**AC1 — No deep clone.** `ConversationManager.getHistory()` returns the entries
held by the live `HistoryService` **by reference**. Given a recorded history,
`conversationManager.getHistory()[i]` is reference-identical (`===`) to
`historyService.getAll()[i]`, and the nested block object is reference-identical
too. This is the direct, deterministic proof that no deep copy occurred (better
evidence than timing).

**AC2 — Array isolation is preserved.** The returned array is a distinct array
instance from the live internal array. `push`/`splice`/reorder on the returned
array does not change what a subsequent `getHistory()` returns, for both
`curated: false` and `curated: true`.

**AC3 — The read-only contract is expressed in the type, and the sharing it
implies is pinned by a test.** `getHistory()` returns `readonly IContent[]`,
propagated through `chatSession.getHistory()`, `AgentChatContract.getHistory()`,
`AgentClientContract.getHistory()` and `AgentClient.getHistory()`.

Be precise about what this does and does not buy, because `readonly T[]` in
TypeScript is **shallow**:

- It *does* make `push`/`splice`/reorder on the result a compile error, which is
  the mutation that could corrupt history membership.
- It does *not* stop `entry.blocks[0].text = …`. Entries are shared by
  reference, so entry-level immutability is an **invariant maintained by the
  history layer**, not a compile-time guarantee: every post-insertion edit path
  replaces the array slot (`HistoryService.replaceToolResponseBlock`,
  `applyDensityMutations`) rather than mutating the stored entry. The one
  in-place write is the additive `metadata.chronology` stamp at the insertion
  boundary (`ChronologyStamper.stamp`), which is documented as an ownership
  transfer and happens before the entry is observable through `getHistory()`.

That invariant is what makes reference-sharing safe, so it is pinned by a
regression test: a previously returned history must not change when a stored
entry is subsequently edited (`ConversationManager.historyView.test.ts`, AC3).

This is the same exposure `HistoryService.getAll()` / `getCurated()` — both
public, and both reachable from the client contracts via `getHistoryService()` —
have always given their callers. The issue explicitly asks `getHistory()` to
follow that existing pattern.

**AC4 — Curation semantics unchanged.** `getHistory(true)` still excludes
invalid/empty AI entries and still includes all human and tool entries;
`getHistory(false)` still returns everything.

**AC5 — Content equivalence unchanged.** `addHistory` → `getHistory` still
returns equivalent content (same length, same speakers, same blocks), including
for arbitrary generated histories.

**AC6 — No behavioural regression.** The existing agents/core/cli suites pass
unchanged, including the resume/restore/clear, checkpoint, `--continue`, and
auth-refresh history-carry paths.

### Boundary cases covered

- empty history; `curated` true and false
- history whose only AI entry is invalid/empty (curated drops it, `getAll` keeps it)
- entries carrying a large text block (reference identity proves no copy)
- `getHistory()` called twice: both calls return distinct arrays, identical entries
- client-level `getHistory()` before chat init (`_previousHistory` / stored
  `HistoryService` fallbacks) and after chat init

## Change set

Type-only ripple, measured by a spike: 8 real sites. (A separate 3-error
pre-existing failure — `LoopDetectionSnapshot` / `checkpoint` / `restore` in
`MessageStreamOrchestrator.ts` — reproduces on unmodified `main` from a stale
`packages/core/dist` and is not part of this change.)

1. `packages/agents/src/core/ConversationManager.ts` — drop `structuredClone`,
   return `readonly IContent[]`.
2. `packages/agents/src/core/chatSession.ts` — `getHistory(): readonly IContent[]`.
3. `packages/core/src/core/clientContract.ts` — `AgentChatContract.getHistory():
   readonly IContent[]`; `AgentClientContract.getHistory(): Promise<readonly
   IContent[]>`; widen the non-mutating history **parameters** the ripple
   requires (`setHistory`, `startChat`, `restoreHistory`, `resumeChat`,
   `storeHistoryForLaterUse`) to `readonly IContent[]`. Widening a parameter is
   source-compatible for existing callers.
4. `packages/agents/src/core/client.ts` — `getHistory(): Promise<readonly
   IContent[]>`; `_previousHistory?: readonly IContent[]`; orchestrator dep
   `getHistory` type.
5. `packages/agents/src/core/MessageStreamOrchestrator.ts` — dep signature.
6. `packages/agents/src/api/agentImpl.ts` — `startChat(carriedHistory)`.
7. `packages/agents/src/api/control/sessionControl.ts` — `setHistory(history)` at
   two sites.
8. `packages/core/src/config/agentClientLifecycle.ts` +
   `packages/core/src/utils/checkpointUtils.ts` — `readonly IContent[]` on the
   history fields they carry.

## Explicitly deferred (not in this change)

The issue's proposed fix item 3 asked checkpoint persistence to serialise "a
curated/minimal projection rather than the whole history, and only when
checkpoints are enabled and a restorable tool call is actually in the
awaiting-approval path."

- The gating half is **already implemented**:
  `checkpointPersistence.saveRestorableToolCalls` returns early unless
  `checkpoint.getCheckpointingEnabled()` is true, and filters to
  `status === 'awaiting_approval'` restorable (`replace` / `write_file`) calls.
- The projection half would change the **on-disk checkpoint format** and reduce
  restore fidelity. That is a functional/format change with restore-correctness
  risk, not a performance change, and this issue was explicitly re-scoped to
  performance. Deferred; the deep clone is removed from that path regardless.

## Review triage

| # | Finding | Class | Action |
| --- | --- | --- | --- |
| 1 | `readonly IContent[]` is shallow, so entry/block mutation still compiles; the plan claimed any mutation attempt is a compile error | In-scope-Fix (partial) | AC3 and the `getHistory()` comment rewritten to state exactly what `readonly` does and does not guarantee. See #2 for the rejected half. |
| 2 | Proposed remedy: restore an isolated deep-clone snapshot at the "public" boundary and add an internal borrowed `getHistoryView()` | **Reject** | The public boundary (`AgentImpl.getHistory`) is one of the per-turn call sites the issue names, so cloning there reinstates exactly the cost this issue exists to remove. It is also defence-in-depth against a hypothetical external mutator while the identical exposure stays wide open through `getHistoryService().getAll()/getCurated()` — both already public on `AgentChatContract`/`AgentClientContract` and unchanged here. The issue explicitly directs `getHistory()` to follow the existing non-cloning `getCurated()` pattern. |
| 3 | Deep-readonly (`DeepReadonly<IContent>`) instead of shallow `readonly` | **Defer** | Would fully close the typing gap, but `DeepReadonly<IContent>` is not assignable to `IContent`, so every consumer that builds new turns from history entries would need casts. That is a data-model change across packages, far beyond this issue. |
| 4 | `AgentClient.getHistory()` returned `_previousHistory` directly, so the membership-isolation guarantee did not hold on the pre-chat-init branch | In-scope-Fix | Returns `[...this._previousHistory]`. Cold path only (no chat yet), so it does not reintroduce per-turn cost. |
| 5 | No test would catch a future contributor making a history edit path mutate in place | In-scope-Fix | Added AC3 regression test: a previously returned history must not change when a stored entry is edited via `replaceToolResponseBlock`, and the live history must actually have changed (so the test is not vacuous). |
| 6 | `client.ts` structural cast still declared `getHistory: () => IContent[]`; concrete `storeHistoryForLaterUse` still took `IContent[]` | In-scope-Fix | Both widened to `readonly IContent[]`. |
| 7 | "Copy-on-write" overstated: `ChronologyStamper.stamp` writes `metadata.chronology` in place | In-scope-Fix | Documented precisely — it is an additive stamp at the insertion boundary (documented ownership transfer) that happens before the entry is observable through `getHistory()`. |
| 8 | Stale describe label `history round-trip with defensive clone` | In-scope-Fix | Renamed to `history round-trip with array isolation`. |
| 9 | `ChatSessionFactory` spreads `extraHistory` for `reportError(context?: unknown[])`; widening `reportError` would be cleaner | **Reject** | Reviewer agrees it is not a correctness problem. Error path only; widening a shared core utility is out of scope. |
| 10 | Checkpoint "curated/minimal projection" not implemented | **Defer** | See *Explicitly deferred* above; reviewer agreed the deferral is defensible. |

### Open Code Review triage (2 local runs; run 1 found 0, run 2 found 4)

| # | Finding | Class | Action |
| --- | --- | --- | --- |
| 11 | `clientContract.characterization.spec.ts` comment claimed the push "proves … even an untyped consumer cannot corrupt live history" — misleading, it only proves membership isolation | In-scope-Fix | Comment corrected in both that spec and the new test file to scope the claim to membership. |
| 12 | Add an assertion pinning that mutating `raw1[0].blocks[0].text` DOES corrupt live history | **Reject** | `dev-docs/RULES.md` forbids writing a passing test that enshrines undesirable behavior as specification — it would make a future hardening (deep-readonly, freezing) look like a regression. The detection this asks for already exists without that cost: the reference-identity assertions (`expect(raw1[i]).toBe(raw2[i])`, plus the AC1 tests) fail if a deep clone or entry-level copy-on-read is reintroduced. Verified by reinstating `structuredClone` locally — 4 tests went red. |
| 13-14 | `AgentClientContract.generateJson` / `generateContent` still take `IContent[]`, not `readonly IContent[]` | **Defer** | Those take caller-supplied content, not history from `getHistory()`; nothing in this ripple reaches them and OCR confirms "No correctness bug." Widening them is adjacent cleanup outside this issue. |

### Known-flaky local suite

`packages/agents/src/core/__tests__/subagentOrchestrator-loadBalancer.test.ts`
fails non-deterministically under local parallel load (5s per-test timeouts):
different tests fail on each run, and it also fails on a stashed, unmodified
tree. Not a regression from this change; CI is the arbiter.

## Non-goals

- No change to `HistoryService` storage, curation, compression, or density.
- No new public abstraction, no `cloneForMutation()` (zero callers).
- No lint/complexity rule changes and no suppression directives.
