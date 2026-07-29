# Issue 2625 delivery plan: recording-native checkpoints and branching

Plan ID: PLAN-20260728-ISSUE2625
Base: `7abb646f7` (`origin/main`)
Issue: https://github.com/vybestack/llxprt-code/issues/2625

## Policy provenance and scope status

`dev-docs/workflow/ISSUE-DELIVERY.md` is not present on this base. This plan applies the bounded issue-delivery rules supplied with the issue request directly and follows `dev-docs/RULES.md` behavioral TDD requirements.

The full accepted issue intent does **not** fit the 25-file/1,500-net-line target or the 40-file hard stop. The grounded minimum is 51 paths including this plan and approximately 2,000–2,450 net changed lines after legacy deletions. The user approved proceeding with the bounded full-intent implementation in one issue-linked PR.

## Chosen architecture and semantic decisions

- Recording JSONL becomes the only conversation checkpoint format. Existing `checkpoint-*.json` files are ignored; there is no reader, importer, dual writer, alias, or compatibility window.
- Checkpoint metadata is represented by append-only `checkpoint_created`, `checkpoint_renamed`, and `checkpoint_deleted` events folded by stable checkpoint ID. The creation envelope sequence is the inclusive branch watermark.
- `session_forked` records ancestry and `session_named` records the mutable living-session name. These metadata events never enter model history.
- Checkpoint and session names are trimmed, non-empty, exact, case-sensitive, and project-unique. `latest`, positive decimal strings, and exact existing session IDs are reserved to keep `/continue` resolution unambiguous.
- A checkpoint transition replays through its watermark, creates and locks a new UUID session, writes ancestry plus canonical `IContent` seed events, flushes the complete child, and only then swaps active state. Failures remove/release the partial child and leave the current session unchanged.
- Living-session `/continue` retains current append/resume semantics. `/chat resume` returns the same transition action and uses the same service as `/continue`.
- Every fresh, resumed, and forked active recording holds a lock keyed by the full header session ID. Existing filename-derived lock identity is corrected.
- Active checkpoint operations use the owned active lock. Closed-source operations acquire required full-ID locks in sorted order, replay and validate after acquisition, append one event at `lastSeq + 1`, flush, and release in reverse order.
- Confirmed overwrite tombstones the existing reference before creating the replacement while all required locks are held. Lock acquisition failure makes no change. Append-only cross-file crash transactions and a new transaction journal are outside scope.
- `/chat clear` and `/chat restore N` share a history-mutation service that computes suffixes from real non-initial human boundaries, durably records the rewind, and commits live/UI history only after persistence succeeds.
- Preserve the existing history-returning Agents `resume()` API while adding the distinct requested `resumeSession()` API. Delete the misleading legacy `restoreCheckpoint` conversation API.
- Preserve unrelated Git file-edit checkpointing, including the private `restoreCheckpoint` in `restoreCommand.ts`. The legacy-symbol assertion is scoped to conversation checkpoint production code.

## Decision-complete acceptance matrix

All evidence uses real temporary recording files and actual replay/lock behavior. Mocks are limited to unrelated UI plumbing.

| ID  | Accepted behavior                                                       | Behavioral evidence                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Save after C, continue source through E, then continue checkpoint `foo` | Source replays A–E; new child initially replays A–C and accepts F/G independently.                                                                                                         |
| A2  | Source and child remain independent                                     | Replaying/resuming source excludes child F/G; replaying child excludes source D/E.                                                                                                         |
| A3  | Repeated checkpoint continuation creates siblings                       | Two forks have distinct IDs/files/locks and identical initial canonical history.                                                                                                           |
| A4  | Children are self-contained                                             | After checkpoint deletion and permitted parent deletion, child resumes from its own JSONL.                                                                                                 |
| A5  | Live checkpoints block source deletion                                  | Deletion fails and lists every blocking checkpoint name/ID; deletion succeeds after tombstones.                                                                                            |
| A6  | Lifecycle folds by stable ID and namespace is global                    | Rename preserves ID/watermark; delete removes only the reference; duplicate checkpoint/session names fail; confirmed overwrite is lock-safe.                                               |
| A7  | `/chat resume` aliases `/continue`                                      | Both commands emit the same transition action and reach the same service; separate calls create equivalent independent children.                                                           |
| A8  | Living-session `/continue` does not fork                                | Target session ID is retained, no fork event is written, and latest session history is preserved.                                                                                          |
| A9  | Replay fidelity covers all recording events                             | Checkpoints after compression, rewind, provider change, and tool/media/thinking content produce exact canonical history.                                                                   |
| A10 | Save and fork fail atomically                                           | Real write/flush failure rejects; current recording/history/lock remain unchanged; partial child is absent/unlocked.                                                                       |
| A11 | All active recordings own full-ID locks                                 | Fresh, resumed, and forked sessions reject second acquisition, deletion, and closed append; disposal releases the lock.                                                                    |
| A12 | Clear/restore are durable and turn-aware                                | Tool-heavy and multi-entry human turns survive process restart with replay equal to visible history; persistence failure leaves live/UI state unchanged.                                   |
| A13 | Agents APIs are recording-native                                        | Real-file tests cover create/fork/list/rename/delete checkpoints, name/resume/list/delete sessions, ancestry, and no legacy file creation.                                                 |
| A14 | Persistence is provider-neutral                                         | Emitted JSONL content uses `speaker`/`blocks`; no session-control persistence caller uses Gemini conversion or emits legacy provider envelopes.                                            |
| A15 | Replay supports an inclusive sequence bound and metadata fold           | Replay through checkpoint sequence includes branch state through C, excludes D/E, and exposes checkpoint/name/fork metadata separately from history.                                       |
| A16 | Metadata operations are durable and empty save is rejected              | Unmaterialized save creates no file; successful create/rename/delete/name is readable after the promise resolves; inactive/failed recorders reject.                                        |
| A17 | Closed-source append is lock-checked and monotonic                      | Exactly one event is appended at `lastSeq + 1`; prior bytes are unchanged; held lock causes the existing in-use error and no write.                                                        |
| A18 | Discovery/browser/completion expose both target kinds                   | `/continue` lists and resolves sessions and checkpoints; checkpoint deletion deletes the reference rather than its source.                                                                 |
| A19 | Session names are distinct from titles                                  | Naming survives replay, does not alter title, resolves through `/continue`, shares checkpoint namespace, and clearing the name frees it.                                                   |
| A20 | Legacy conversation checkpoint persistence is absent                    | Legacy JSON is ignored; Logger checkpoint duties and CLI serializer are absent; no production conversation caller uses old readers/writers.                                                |
| A21 | Public API and documentation are truthful                               | Root-surface snapshot and behavioral/API tests add `CheckpointInfo`/`SessionInfo`, remove conversation `restoreCheckpoint`, preserve distinct `resume()`, and document breaking semantics. |

## Explicit non-goals

- Git file-edit checkpointing (`restoreCommand.ts`, core checkpoint utilities, and the separate `checkpointing` setting).
- A2A file-edit checkpoint directories.
- Legacy checkpoint import, decoding, startup scanning, renaming, fallback, dual writing, aliases, or migration commands.
- Cross-project session import/export or cross-project names.
- Parent-reference-only child replay or parent JSONL rewriting.
- Provider request/wire-format changes or global deletion of `ContentConverters.toGeminiContents`.
- Replay-time emoji filtering or arbitrary checkpoint `context` objects.
- A transaction journal, new filesystem transaction abstraction, or broader OS-level fsync contract.
- Workflow, dependency, package-graph, agent-memory, lint, complexity, quality-tool, coverage, safety, CI, or unrelated documentation changes.
- Unrelated refactors, test moves, cleanup, optional hardening, or broad renaming of internal lock fields.

## Test-first bounded vertical slices

1. **Event model and durable writer**
   - RED: typed metadata fold, inclusive maximum sequence, metadata exclusion, empty save, and real write-failure tests.
   - GREEN: add event payloads/results; make raw enqueue internal; retain asynchronous content recording while making typed metadata operations fail truthfully.
2. **Full-ID locking and checkpoint lifecycle**
   - RED: fresh/resumed lock identity, closed append, namespace collision, overwrite ordering, and blocker tests.
   - GREEN: correct lock identity and add one lifecycle service using active ownership or sorted closed-session locks.
3. **Discovery and canonical target resolution**
   - RED: project metadata index, session/checkpoint names, reserved names, typed targets, and deletion blockers.
   - GREEN: add the checkpoint/session-name index and unified resolver while retaining the living-session resolver primitive.
4. **Failure-atomic self-contained fork**
   - RED: A–E/C branching, siblings, fidelity, parent independence, lock ownership, and failure cleanup.
   - GREEN: add one transition service; prepare and flush a complete child before invoking existing host swap callbacks.
5. **CLI integration and durable history mutation**
   - RED: command alias, overwrite confirmation, browser/completion, and clear/restore restart behavior.
   - GREEN: rebuild `/chat` over recording services, route `/continue` targets through the transition service, and persist rewinds before UI mutation.
6. **Agents cutover and public contract**
   - RED: real-file Agents behavior and root API snapshot.
   - GREEN: expose truthful native methods/types, preserve `resume()`, remove conversation `restoreCheckpoint`, and remove session-control provider-shaped persistence.
7. **Legacy deletion and documentation**
   - RED: scoped production symbol scan, ignored legacy JSON, and provider-neutral output assertion.
   - GREEN: delete Logger checkpoint duties and CLI serializer/test surface; update API docs and CHANGELOG.

Each production change must follow a failing behavioral test. Focused tests pass after each slice before proceeding.

## Expected paths

### Core production

1. M `packages/core/src/recording/types.ts`
2. M `packages/core/src/recording/SessionRecordingService.ts`
3. M `packages/core/src/recording/ReplayEngine.ts`
4. M `packages/core/src/recording/SessionDiscovery.ts`
5. M `packages/core/src/recording/resumeSession.ts`
6. M `packages/core/src/recording/SessionLockManager.ts`
7. M `packages/core/src/recording/sessionCleanupUtils.ts`
8. M `packages/core/src/recording/sessionManagement.ts`
9. M `packages/core/src/recording/index.ts`
10. A `packages/core/src/recording/CheckpointService.ts`
11. A `packages/core/src/recording/SessionTransitionService.ts`
12. A `packages/core/src/recording/HistoryMutationService.ts`
13. M `packages/core/src/core/logger.ts`

### CLI production

14. M `packages/cli/src/cliSessionBootstrap.ts`
15. M `packages/cli/src/services/performResume.ts`
16. M `packages/cli/src/ui/commands/chatCommand.ts`
17. D `packages/cli/src/ui/commands/checkpointContentValidation.ts`
18. M `packages/cli/src/ui/commands/continueCommand.ts`
19. M `packages/cli/src/ui/hooks/useSessionBrowser.ts`
20. M `packages/cli/src/ui/hooks/useSessionBrowserHelpers.ts`
21. M `packages/cli/src/ui/hooks/useSessionBrowserKeypress.ts`
22. M `packages/cli/src/ui/components/SessionBrowserDialog.tsx`
23. M `packages/cli/src/ui/components/DialogManager.tsx`
24. M `packages/cli/src/ui/hooks/slashCommandHandlers.ts`

### Agents and public contract

25. M `packages/agents/src/api/control/sessionControl.ts`
26. M `packages/agents/src/api/agent.ts`
27. M `packages/agents/src/api/__tests__/expected-root-surface.json`

### Behavioral tests

28. A `packages/core/src/recording/recordingMetadata.integration.test.ts`
29. A `packages/core/src/recording/checkpointLifecycle.integration.test.ts`
30. A `packages/core/src/recording/sessionForking.integration.test.ts`
31. A `packages/core/src/recording/historyMutation.integration.test.ts`
32. M `packages/core/src/recording/resumeSession.test.ts`
33. M `packages/core/src/recording/SessionLockManager.test.ts`
34. M `packages/core/src/recording/sessionCleanupUtils.test.ts`
35. M `packages/core/src/recording/sessionManagement.test.ts`
36. M `packages/core/src/core/logger.test.ts`
37. M `packages/cli/src/ui/commands/chatCommand.test.ts`
38. D `packages/cli/src/ui/commands/chatCommand.checkpoint-content.test.ts`
39. M `packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts`
40. M `packages/cli/src/services/__tests__/performResume.spec.ts`
41. M `packages/cli/src/services/__tests__/performResume.swap.spec.ts`
42. M `packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts`
43. M `packages/cli/src/cli.provider-init.test.ts`
44. M `packages/cli/src/test-utils/mockCommandContext.ts`
45. M `packages/cli/src/ui/commands/test/subagentCommand.test.ts`
46. M `packages/agents/src/api/__tests__/session.spec.ts`
47. M `packages/agents/src/api/__tests__/sessionControl.recording.behavior.test.ts`
48. M `packages/agents/src/api/__tests__/sessionControl.concurrency.behavior.test.ts`

### Plan and documentation

49. A `dev-docs/plans/2026-07-28-issue-2625-recording-native-checkpoints.md`
50. M `dev-docs/agent-api.md`
51. M `CHANGELOG.md`

No additional subsystem, service, public abstraction, or path is authorized by this plan.

## Scope ledger

| Measure | Planned | Final candidate |
| --- | ---: | ---: |
| Changed paths | 51 | 58 |
| Insertions | — | 5,377 |
| Deletions | — | 3,023 |
| Net changed lines | +2,000 to +2,450 | +2,354 |

- Target: no more than 25 files or 1,500 net changed lines.
- Mandatory scope review: completed because the grounded forecast exceeded the target.
- Hard stop without approval: more than 40 files or 2,500 net changed lines.
- The user approved the single-PR full-intent implementation above the file stop.
- The seven paths added after planning are existing contract/integration tests and established CLI wiring needed to preserve behavior discovered during implementation and review; no unplanned subsystem or public abstraction was added.
- The final candidate remains below the approved 2,500-net-line stop and contains no workflow, dependency, agent-memory, quality-tool, lint, complexity, coverage, CI, or `.llxprt` changes.

## Review triage contract

Every DeepThinker, OCR, CodeRabbit, CI, or human finding is recorded as exactly one of:

- **Blocker-Fix** — accepted behavior, safety, correctness, architecture, or a required gate cannot complete without it.
- **In-scope-Fix** — valid and within this matrix and ledger.
- **Reject** — factually incorrect, already covered, or harmful to accepted behavior.
- **Defer** — valid but outside this matrix/ledger and requiring separate work.

Reviewer suggestions do not expand scope. At most two local OCR and two PR OCR runs are allowed.

## Approval and stop boundaries

Stop before:

- beginning implementation without explicit approval to exceed the 40-file hard stop with the recorded 51-path single-PR scope;
- changing unrelated Git checkpointing to satisfy an over-broad symbol grep;
- removing the existing history-returning Agents `resume()` API;
- adding a journal/transaction subsystem or changing the global fsync contract;
- adding any unplanned subsystem, public abstraction, path, behavior, dependency, workflow, agent-memory, quality-tool, lint/complexity/coverage/CI change, unrelated refactor, or test move;
- exceeding 2,500 net changed lines or materially exceeding 51 paths.

## Exact-head completion gates

The candidate head is complete only when every acceptance row has behavioral evidence; focused and full local verification pass; the prescribed smoke and tmux UI checks pass; DeepThinker/OCR findings are classified and accepted findings resolved; the exact committed head has green CI and resolved CodeRabbit/OCR threads; `origin/main` is an ancestor; the PR is conflict-free; and the final diff reconciles with this scope ledger. Stop successfully then without optional hardening or cleanup.
