# Issue #2755 — Recover preflight context overflow before surfacing the guard

The requested canonical file, `dev-docs/workflow/ISSUE-DELIVERY.md`, is not
present on current `origin/main` or through the repository contents API. This
plan applies the bounded issue-delivery requirements supplied with the issue.

## Problem and decision

The screenshot shows the CLI's `ContextWindowWillOverflow` preflight message,
not the hard-limit error fixed for #2588. Its values are internally consistent:
251,971 used of 262,144 leaves 10,173 tokens, while the pending request was
estimated at 32,275 tokens.

The preflight path attempts one automatic compression and bails when the result
is a no-op or is insufficient. It does not then use the existing
`ChatSession.enforceContextWindow()` path, which already owns density,
compression, retry, deterministic top-down truncation, and final hard-limit
enforcement. In addition, the initial check derives remaining capacity from
`getLastPromptTokenCount()`, which returns zero after compression clears the API
observation, while the recovery recheck uses the history-derived projected
baseline. That inconsistency can make a subsequent `continue` appear to fit.

Decision: use the projected prompt baseline for both checks and delegate an
insufficient preflight compression to the existing context-window enforcer. Do
not add a new fallback API or public abstraction.

## Acceptance matrix

| ID  | Given                                                                                                                                            | When                                              | Then                                                                                                            | Behavioral evidence                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | A request exceeds the preflight threshold and ordinary compression is a no-op, but existing context-window enforcement can reduce history enough | `sendMessageStream` checks session limits         | The turn proceeds without `ContextWindowWillOverflow`                                                           | Extend `client.sendMessageStream-overflow-compression.test.ts` with a stateful overflow scenario whose enforced reduction changes the projected baseline |
| A2  | Ordinary compression reports success but the projected baseline still leaves too little room, and existing enforcement can reduce further        | Preflight rechecks the request                    | Existing enforcement is attempted and the recovered turn proceeds                                               | Add a behavioral insufficient-compression recovery case in the same test file                                                                            |
| A3  | Compression and existing context-window enforcement cannot make the request fit                                                                  | Preflight recovery runs                           | Exactly one `ContextWindowWillOverflow` event is emitted and the turn does not run                              | Adapt the existing insufficient-reduction case to remain unrecoverable after enforcement                                                                 |
| A4  | Compression cleared the last API-observed prompt count but current history remains too large                                                     | A later turn performs its initial preflight check | Capacity is based on `getProjectedPromptBaseline()`, so the turn does not receive a false full-window allowance | Add a consecutive-check regression scenario that supplies zero as the last observed count and a large projected baseline                                 |
| A5  | Ordinary compression makes sufficient room                                                                                                       | Preflight rechecks the request                    | The turn proceeds without invoking extra reduction behavior                                                     | Existing issue #2402 recovery test remains green and observes the emitted stream behavior                                                                |
| A6  | History is empty or compression throws and recovery cannot apply                                                                                 | Preflight recovery runs                           | The existing guard behavior remains intact                                                                      | Existing skipped-empty and throwing scenarios remain green                                                                                               |
| A7  | Initial and post-recovery checks evaluate the same request                                                                                       | Both checks calculate available capacity          | Both use the same projected baseline and `CONTEXT_OVERFLOW_THRESHOLD`                                           | A4 plus existing threshold-boundary coverage                                                                                                             |

## Non-goals

- Do not change the #2588 hard-limit margin policy or error construction.
- Do not change compression strategies, retry counts, thresholds, model limits,
  tool-response truncation, or the `/compress` command UI.
- Do not promise that an intrinsically oversized pending request can be sent;
  unrecoverable requests must still emit the guard.
- Do not add a subsystem, public abstraction, workflow, dependency, quality-tool
  change, agent-memory change, lint suppression, threshold increase, or ignore.
- Do not move tests or perform unrelated compression/context refactors.

## Bounded vertical slices

1. **Projected-baseline parity (RED/GREEN):** prove the initial check cannot use
   a cleared observed count as a zero baseline, then switch it to the existing
   projected baseline.
2. **No-op/insufficient recovery (RED/GREEN):** prove both recoverable outcomes,
   then delegate to the existing `enforceContextWindow()` only after ordinary
   compression did not make sufficient room.
3. **Unrecoverable integrity (RED/GREEN):** prove the guard remains the final
   outcome when existing enforcement cannot recover.
4. **Regression verification:** run the focused overflow suites and all required
   project gates.

## Expected paths and scope ledger

| Path                                                                             | Planned change                                                                                       | Acceptance   | Estimated net lines | Status      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ | ------------------- | ----------- |
| `dev-docs/plans/2026-07-27-issue-2755-preflight-overflow-recovery.md`            | This bounded plan and ledger                                                                         | Policy gate  | +90                 | In scope    |
| `packages/agents/src/core/MessageStreamOrchestrator.ts`                          | Use projected baseline for initial remaining capacity                                                | A4, A7       | 0                   | In scope    |
| `packages/agents/src/core/preflightRecovery.ts`                                  | Escalate insufficient ordinary compression through existing context-window enforcement, then recheck | A1-A3, A5-A6 | +20                 | In scope    |
| `packages/agents/src/core/client.sendMessageStream-overflow-compression.test.ts` | Behavioral recovery, unrecoverable, and baseline regressions                                         | A1-A7        | +120                | In scope    |
| `packages/agents/src/core/client.sendMessageStream-overflow.test.ts`             | Adjust only if the baseline correction exposes a fixture with an inaccurate projected count          | A4, A6       | ±10                 | Conditional |

Expected implementation: at most 5 files and about 240 net lines, including
this plan. This is below the 25-file/1,500-line target and does not trigger a
mandatory scope review. Stop for approval before any unlisted production path,
new public surface, or behavior outside A1-A7. Hard stop above 40 files or 2,500
net lines.

### Final scope reconciliation

The initial estimate intentionally counted only behavioral files. Replacing the
baseline method required existing `ChatSession` fixture objects to implement the
same already-public method. Those are mechanical test-contract updates, not new
behavior, public surface, or subsystem scope.

| Final scope entry                          | Files | Net lines                        | Classification                             |
| ------------------------------------------ | ----- | -------------------------------- | ------------------------------------------ |
| Production behavior                        | 2     | +14                              | A1-A7 implementation                       |
| Behavioral overflow evidence               | 2     | +287                             | A1-A7 tests, including real enforcement    |
| Agents fixture contract updates            | 11    | +30                              | Required by baseline method replacement    |
| A2A real-pipeline fixture contract updates | 2     | +2                               | Required after full-suite runtime evidence |
| Delivery plan                              | 1     | +103 before scope reconciliation | Policy evidence                            |

The candidate remains at 18 files and about 457 net changed lines including
this plan. It is below the 25-file/1,500-line target, so no mandatory scope
review or hard stop is triggered. There are no unlisted production paths, new
public APIs, dependencies, workflows, quality-tool changes, agent-memory
changes, test moves, or unrelated refactors.

## Review finding classifications

Every finding must be recorded as one of:

- **Blocker-Fix:** violates an accepted behavior or required gate.
- **In-scope-Fix:** improves correctness or maintainability within the listed
  paths and A1-A7.
- **Reject:** factually incorrect or contradicts the accepted design.
- **Defer:** valid but outside the matrix or scope ledger; requires separate work.

Reviewer suggestions do not expand this ledger.

### Review triage

| Finding                                                        | Classification | Resolution                                                                                                                   |
| -------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Non-throwing compression failure bypassed hard-limit reduction | Blocker-Fix    | Failure is logged and now continues into existing context enforcement; behavioral fallback coverage added                    |
| Recovery re-resolved a different token limit                   | Blocker-Fix    | The orchestrator computes one configured limit and passes it to every recheck; injected-resolver regression added            |
| Recovery evidence mocked the enforcer and asserted mock calls  | Blocker-Fix    | Proceed paths assert stream output; A1 uses a real `ChatSession`, real pending enforcer, and real top-down history reduction |
| New code comments restated control flow                        | In-scope-Fix   | Newly added explanatory comments were removed                                                                                |
| Broader rewrite of pre-existing mock-heavy client fixtures     | Defer          | Outside A1-A7; the issue-defining enforcement path now has real integration evidence                                         |
| OCR review                                                     | Reject         | No findings were generated across the 17 reviewed source/test files                                                          |

## Verification and completion gate

Required local evidence: focused overflow tests, `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, and the configured smoke
test. Because the failure is visible in terminal UI, exercise the tmux harness
before PR creation. Run DeepThinker and local OCR (maximum two local OCR runs),
triage every finding, and stop optional hardening once accepted behavior and
required gates pass.

Exact-head completion additionally requires green CI on the candidate commit,
completed and triaged PR reviews (maximum two PR OCR runs), all Blocker-Fix and
In-scope-Fix findings resolved, correct ancestry, a conflict-free PR, and this
scope ledger reconciled to the final diff.
