# W22 agents sweep status

Updated 2026-10-19T23:15:03.089Z.

**W22 remains partial. Collection is running; no package source changed.** The exact 400 pending files resumed at `cdd66e039` under supervisor **25008**, using the existing serial collect-fail-and-continue driver, one Bun process per file, original timeouts and no automatic retries. Evidence is under `tmp/854-notes/p4/w22/completion-sweep-run-f/`. Do not start a duplicate sweep.

## Census at this checkpoint

**806 = 597 green + 46 red + 4 unverified + 159 unrun**. 647 files attempted; **4951 passes, 142 failures, 0 skips**. This continuation has attempted **241 of 400** pending files. Counts advance while collection runs. These are cumulative per-attempt source boundaries, not a final-source package pass.

Exact-case classifications remain conservative: **{"native-history":87,"journal-selected-shared-public":258,"explicit-old":27,"classification-pending":4579,"unclassified":0}**. The actual case ledger is `run-20261019-a/current-progress.json`; its frozen copy, all attempts, failure table, missing-evidence table and checksums are under `completion-sweep-run-f/frozen-handoff/`. Journal selection alone does not establish native coverage. History-independent cases need shared/public mapping when applicable, not invented native counterparts. 4 latest missing-XML files remain unknown, separate from 22 historical missing attempts.

## Live authority and continuation

At capture: batch **package-resume-g-0450**, driver **39798**, child **50643**, current file `packages/agents/src/core/retained-array-memory.test.ts`, started `2026-10-19T23:14:54.958Z`, source SHA-256 `a553b0905e0e1f35ff1253607c2e9c40af0bb4091c0fd609064b5e2a7fdaae78`. These identities are timestamped observations. Read `tmp/854-notes/p4/w22/run-20261019-a/sweep-supervisor.json` and its `currentFilePath` before acting. The supervisor should continue the remaining files without intervention. Do not kill a test for the handoff.

No package edits or gates may overlap active collection. Ordinary failures continue; disk/loader/driver-integrity failures stop the owned batch for diagnosis. After collection or a deliberate safe batch boundary, repair a shared-root cluster with its own verified source boundary.

## Next repair clusters

1. Six pending-window suites share `pending-window-disk-helpers.ts`: addbatch-pending-window and pending-window-disk-contracts/noop/owner-controls/phases/route. The helper constructs the JSONL-only AdmissionFailureRecorder without an explicit old backend, so native selection rejects construction before target assertions. Preserve old assertions, bounds and scales. Map existing real-service native fallback compensation, partial admission/retry, queued chronology, acknowledgement, media and retaining-control evidence; add only uncovered contracts. The implementation plan is `completion-sweep-run-f/cluster-plan.md`.
2. Provider fallback/hardlimit suites share the same recorder/backend selection fault in `provider-fallback-disk-helpers.ts`. Keep diagnostics and native source-stage compensation coverage distinct.
3. Other recorded families remain cursor `previous.close`, empty-block publication, token/owner/span parity, serialized-request equality, and newly collected core synchronous-observation/JSONL assumptions. Exact red paths/counts are in `W22-COMPLETION-SWEEP-PROOF.json`; failed cases and raw references are in the frozen failure table. This is repair planning, not a completed code review.

## Preserved verified work

Source repair **`8a4f11980`** and documentation **`cdd66e039`** remain intact. The prior compression-source matrix had **114 passes, zero failures/skips, 16 serial processes and ten passing scoped gates**. It was not rerun for this continuation. Details remain in `W22-COMPRESSION-SOURCE-PROOF.md/json`; earlier increments retain their own proof files and git history.

This run has no product edit and ran **no verification gates**, declaration build or OCR. Review skipped per Andrew 2026-10-09. No cleanup, deletion, obstruction move, .llxprt edit, raw recovery bulk staging, default flip, weaker assertions/timeouts, push or merge. W23-W26 remain open. W22 cannot close until all 806 inventory paths and required native contracts have evidence.
