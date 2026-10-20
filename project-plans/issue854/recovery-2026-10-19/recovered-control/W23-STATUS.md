# W23 bounded integration and provider parity

## SendPeak collection handoff, 2026-10-20T05:23:55Z

First green cluster committed as `2f20ada0c50e65e127b89c07957872e26e72b18f`. A separate fourteen-file sendPeak batch is running serially, with no package source edits or overlapping heavy gates. At this timestamp, two files have complete agreeing raw/JUnit results: OpenAI chat text-only and tool-heavy, **four passes, zero failures/skips**. Both complete byte/Content-Length and unchanged memory predicates pass. Twelve paths remain, including the currently running file.

Live driver **88231**, current test **89482**, `packages/providers/src/__tests__/sendPeak.anthropicTextOnly.test.ts` (index two of fourteen). Managed job: `shell_265985fe87db`. The driver records each next PID/current file immediately and stops at the fourteen-file boundary. Current authority is `tmp/854-notes/p4/w23/run-a/send-peak-a-state.json`; append-only results/process records and per-file logs/XML/measurement summaries remain alongside it. `W23-SEND-PEAK-CHECKPOINT.json` preserves this dated snapshot and every exact path. No automatic retries. Ordinary assertion failures continue; loader/disk failures stop this driver. Do not start another heavy lane or edit package source until the recorded driver reaches its boundary.

These sendPeak suites use independent disk-row inputs, not native HistoryService sources. Their oracle is assembled outside measurement by the existing harness; the frozen-corpus proof remains separate. Dedicated trap suites are in this batch. Running unchanged positive tests with trap environments to obtain actual assertion failures is still required afterward. Do not treat a pending trap as executed.

The exact fifteen-path native remainder is inventoried in `run-a/native-remainder-inventory.json`, not queued. Three repeated-turn files reuse validated prior proof. Two prior W21 curated lifecycle/fault tests retain matching test hashes and executed logs, but HistoryServiceCore changed since that source boundary; no current-source native promotion is made. The remaining suffix/curated/borrowed requirements stay open. No W24, default flip, cleanup, OCR, push or merge.

## First cluster green, 2026-10-20

The CLI bootstrap fixture and native raw-history provider wire corpus are green. W23 remains open. Starting HEAD verified: `f092ca898ede471f1cf6265e59dd402ed45f6b02`. W22's 806 files/6575 passes remain accumulated evidence, not a fresh final-source whole-package run.

Pre-test inventory: `tmp/854-notes/p4/w23/run-a/INVENTORY.md` and `inventory.json`, 223 exact candidate paths/source hashes. The first nineteen-file serial batch produced eighteen green files, one red file, 706 passes/four failures/zero skips. No native coverage is inferred from package membership or environment selection.

The bootstrap fixture's four observed failures were JSONL-only recorder and parser assumptions. The repaired suite preserves old behavior and runs the same seven behaviors on each backend. Independent native disk decoding verifies actual bootstrap, local HTTP send, profile handoff, duplicate-free resume and cleanup ownership. Native recording waits for the admitted row's commit.

The new native wire corpus feeds committed HistoryService rows through the existing adapter and unchanged provider normalizers/builders. All 154 route/history comparisons and a changed-row rejecting control pass. Historical empty-block inputs use the established seeder; request-local purge tags come from the existing purge transaction. Neither codec behavior nor frozen bytes changed.

Final two-environment matrix: **338 passes, zero failures/skips**. Eight scoped gates pass: both touched declaration builds, both package noemit/test type sets with complete Node/Bun test ambient declarations, zero-warning ESLint, Prettier, dependency-graph validation and AST audit. Touched audit findings are zero. Graph validation is not shard execution. Twenty frozen fixture files match the starting commit.

Repeated-turn retention is reused from the executed W22 native normal/retaining/release proofs after thirty-five matching source/measurement/log/JUnit hash checks. No memory workers were repeated. Exact details and scope: `W23-PROOF-MAP.md`, `W23-FIRST-CLUSTER-PROOF.json`; raw receipts: `tmp/854-notes/p4/w23/run-a/`. All 52 recorded first-cluster driver/test/gate PIDs were absent at that cluster's proof publication. The later sendPeak collection is documented above; no restoration is pending.

## Remaining W23 work

- Native selected requestRows, independent seeded equivalence/retry and request-dump golden boundaries beyond the proved raw stream. Original provider goldens passed but use arrays.
- sendPeak positive/trap files and scoped source-bound suffix/provider-curated/borrowed snapshot proofs, reusing actual prior native executions where covered.
- Remaining CLI session/chat/resume and zed/a2a native tool/history protocol contracts. Initial orchestration stubs are not whole native-frontdoor proofs.
- Planning-time over-limit-body refusal and 40 MiB send. Service persistence at that size does not establish send behavior.

The provider per-send spool remains intermediate, with later removal still required. W24 whole-product/write amplification, W25 default selection, W26 scratch/seam removal and phases 5-9 remain open. Old default remains unchanged.

No cleanup/deletion, `.llxprt` edit/staging, raw recovery bulk staging, skips, weaker checks, OCR, push or merge. Review skipped per Andrew 2026-10-09.
