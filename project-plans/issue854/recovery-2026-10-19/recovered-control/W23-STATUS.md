# W23 bounded integration and provider parity

## Actual native 40 MiB send subset, 2026-10-20T05:57Z

Starting HEAD `b377f9faa1df1a8ea2e80fe214c1e603702dece5` verified; no W23 jobs active at entry. Eight native sends pass: OpenAI chat, both Responses routes and Anthropic cache-off, each with a single committed 41,943,040-byte text row, separately without media and with an admitted stored-image reference. Real locked recording, HistoryService curation and pinned selections feed production providers. A local HTTP sink hashes chunks without retaining bodies. Each complete body length, SHA-256 and Content-Length matches the separate existing array-backed oracle. Body lengths range 41,943,148..41,943,279 bytes. This is send proof, not a native memory or planning-limit claim.

Initial execution had six passes and two byte failures. Changing the endpoint to localhost made via-OpenAI choose Chat Completions. The supported provider-scoped `apiMode=responses` selector fixes that fixture input; the sink also refuses a wrong endpoint. No production or oracle change. Final test has eight passes, zero failures/skips. All six scoped gates pass: declaration build, provider noemit/test types, zero-warning lint, format, affected graph validation, AST audit with zero touched findings. Earlier lint and NO_ASSERT authoring failures remain recorded; direct test lifecycle assertions resolve the audit without exclusions.

Raw authority: `tmp/854-notes/p4/w23/limits-memory-run-c/`, including `subset-accepted-*`, byte receipts, source hashes and initial failures. No source changed within the accepted lane. Native memory/trap and planning-limit work is still open. Phase 4 still builds/spools bodies; phase 7 specifies refusal from stored totals. Existing .llxprt change and raw recovery files remain untouched and unstaged. No cleanup, fixture regeneration, weaker checks, OCR, push, merge, W24 or default flip. Review skipped per Andrew 2026-10-09.

## Provider parity cluster green, 2026-10-20T05:47Z

First selected subset committed as `72d3328e4`. The final serial matrix completes **28 file executions, 3264 passes, zero failures/skips**, with both outer environments for the twelve targeted/related files and four additional 5000-seed frozen builder suites. The latter exercise 20,000 array-backed cases inside 32 Bun tests; they are not 20,000 native-service cases. No package source changed during this matrix.

The five new native suites contribute 630 passes per environment: selected requests 163, dumps 256, continuation/image recovery 139, Responses retry 7, and seeded boundary checks 65. They consume actual journal-backed selections or native raw streams followed by the existing normalizer, with forbidden eager reads/contents fallback and explicit pin/close checks. Dump expectations use dump fixtures separately from wire fixtures. Native tests remain explicitly journal-backed under both outer environments.

The production correction is seven lines in `OpenAIProvider`: its Responses executor lacked rejected-parent callbacks, so a rejected `resp_dead` was selected again on recovery. Initial native tests observed two failures. The provider now retires rejected IDs and clears them with provider state, matching the standalone Responses implementation. Tests prove older-parent fallback, complete-history retry with no surviving parent, a second source on the same provider, state reset, exact bytes/Content-Length and exclusion of a row committed after the selection was pinned.

A seeded fixture authoring error produced sixteen failures: the frozen normalized corpus performs provider normalization without HistoryService's earlier invalid-AI exclusion. Seed 3 yielded fifteen frozen units but twelve old/native history-curated units; seed 4 matched at twenty. The harness now proves both input boundaries separately: 32 native provider-only frozen comparisons, 32 native history-curated comparisons against old eager curation, plus a rejecting wrong-boundary control. No fixture, curation rule, assertion bound or timeout changed. The randomized purge corpus and full native 5000-seed coverage remain open.

Six final-source scoped gates pass: provider declaration build, provider noemit/test types, zero-warning lint, formatting, affected graph validation and test audit. Touched audit findings are zero. Core source was untouched. Twenty wire/chat/Anthropic fixture files retain aggregate hash `38fa22ebf2246c18ed6e1f71811ed3cf68084844ef06c2e50e9f5b350c8570da`; all twenty-four frozen-corpus files also match starting HEAD. Raw failures, diagnosis, final logs, hashes and PIDs remain under `tmp/854-notes/p4/w23/provider-parity-run-b/`; `W23-PROVIDER-PARITY-PROOF.json` binds the receipts. All seventy recorded task PIDs are absent at publication.

The completed sendPeak batch remains 29 passes across fourteen files. Positive large bodies span 8,596,212 to 11,774,659 bytes; heap-growth values span -167,279 to 656,750 bytes, ArrayBuffer growth 0 to 8304, and retained growth 0 to 408,445. All original positive predicates passed. Array/estimate/fill traps rejected heap growth of 13,932,345 / 14,040,905 (chat), 13,903,043 (Anthropic) / 28,119,865 bytes; retaining trap rejected 80,627,707.5 bytes of retained growth. These disk-row measurements predate the seven-line OpenAI fix and are not fresh final-source OpenAI memory proof. Actual unchanged positive assertions under trap environments remain unrun. Thirty-five repeated-turn source/receipt checks still match and were reused without worker reruns.

W23 remains open for those positive-assertion traps, remaining suffix/curated/borrowed and CLI/zed/a2a contracts, planning-time over-limit refusal and actual 40 MiB send. Service persistence does not prove send behavior. Per-send spooling, W24, the default flip, W26 and phases 5-9 remain open. No cleanup, `.llxprt` edit/staging, fixture regeneration, weaker checks, OCR, push or merge. Review skipped per Andrew 2026-10-09.

## Provider selected subset, 2026-10-20T05:35Z

The fourteen-file sendPeak driver completed: **29 passes, zero failures/skips**. Driver 88231 and final child 96076 are absent. The refreshed `W23-SEND-PEAK-CHECKPOINT.json` supersedes the running snapshot below. Measurements and dedicated trap receipts remain in run-a; actual positive tests under trap environments remain open.

Native selected parity is green: **163 passes per outer environment**, including 154 route/history comparisons against independent old eager curation and real builders, seven untouched frozen text-only checks, and committed-row/settings rejection controls. The fixture uses committed journal rows, actual curation snapshots, forbidden eager/contents fallbacks, and live/closed selection checks. No production source changed. The unchanged wire golden adds 315 passes per environment, for **956 passes, zero failures/skips** in this subset matrix.

Six scoped gates pass: provider declarations, provider noemit/test types, zero-warning lint, formatting, affected graph validation and audit. Touched audit findings are zero. An authoring lint failure was the throw-only async generator in the contents trap; its iterator now throws directly. No rule changed. Receipts and design: `tmp/854-notes/p4/w23/provider-parity-run-b/`. Dump, retry, continuation and seeded native boundaries are next; W23 remains open.

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
