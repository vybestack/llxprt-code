# W22 retained growth and read cost

The four targets are green at source `888461db478884b0d29b69694e9b5a496d51255e`, following recorder-fixture commit `c69b1c85b`. W22 remains incomplete for runner accounting and case classification.

## Causes and changes

The three original memory failures were recorder/backend mismatches before measurement. The selected real recorder now runs the unchanged workload and predicate. No statistical method, allowance, trend bound, request domain or timeout changed.

`getCurrentTurnMarker()` streamed and decoded all history before a send. Production now delegates this async operation through the store port. Native reads index entries backwards to the newest marked row and decodes only that row; old retains its streaming implementation. An unmarked suffix requires metadata lookups proportional to that suffix, not constant work for arbitrary malformed history. Token totals still read aggregates; last-content still reads one addressed row. Stream and old-materialization extractions preserve behavior while satisfying existing file limits. No row cache, spool, fallback or default flip was added.

Actual read-cost evidence for 46/406 existing rows is one walk, 48/408 visited entries and 49/409 decoded rows per ordinary send. Scalar token reads visit zero rows; last-content reads one. Restoring original production in PID 39290 produces two failures, including 96 entries versus the required 48. Restoration is byte-identical (`cmp=0`); PID 39331 then passes both tests.

The supplemental marker fixture initially failed twice because native admission stamped its supposedly unmarked tail. The corrected native tail uses the fixture's existing zero-block historical-write route. Expected marker, 512/8192 scales and one-live-row ownership bounds remain unchanged; native decoding tightens to one row. PIDs 38936/39415 pass three cases each. Failed input and output remain preserved.

## Measurements and gates

All byte values below come from completed workers:

| Backend | Normal retained | Late fitted / endpoint | Retaining trap retained | Release trap peak / final |
| ------- | --------------: | ---------------------: | ----------------------: | ------------------------: |
| journal |          318257 |           21401 / 2610 |                77816398 |         36330974 / 322687 |
| old     |           94638 |          33342 / 23367 |                77675394 |         36091464 / 117189 |

Normal workers sent 845 requests with 89 compressions. Both traps sent 850 with 90. The unchanged allowance is 1048576 bytes at every checkpoint; both late-growth bounds remain 262144 bytes. Retaining traps reject allowance, fitted growth and endpoint growth. Release traps reject earlier excessive retention despite zero retained rows and small final heaps. These are intended memory-predicate rejections, not loader failures.

The effective eleven-file matrix passes 55 cases per backend, zero failures/skips. Completed memory runs were reused, never repeated. Preserve the initial native marker failures separately from the effective matrix. Four type gates, scoped lint/format, graph and audit pass; declaration build is reused from matching source. Five final census suites pass fourteen cases/183 expectations, with strict types, zero-warning lint and explicit format checks. Touched product audit findings are zero. Graph validation is not shard execution.

## Census and remaining work

The first publisher correctly refused an unexpected 803-green/three-unverified partition. Batch-wide acceptance had replaced two related regression rows without their exact case contracts. A failing scope test precedes the restriction to the four intended paths. No acceptance guard was relaxed.

Final generation `ccbaa4bd-6aac-4b0e-a356-3305480eaeb0`: **806 = 805 green + zero red + one unverified**, zero unrun; **6568 verified passes**, zero failures/skips. Recorded 6575 still includes seven inconsistent runner XML passes withheld from verified totals. Classifications: 401 native, 359 shared-public, 44 explicit-old, 5764 pending. Retain 1497 attempts, 26 historical missing attempts and zero latest missing files. Exactly four target rows change from baseline 801/4/1.

Next unknown: `packages/agents/test-bun/run-bun-tests.issue3253.bun.ts`, historical PID 62524. Do not infer a whole-package final-source pass. JSON proof includes twenty source hashes, six raw measurement references/checksums, gate receipts, frozen census/ledger hashes and 68 absent recorded owned PIDs. Raw evidence: `tmp/854-notes/p4/w22/retained-run-o/`. No active mutation or worker remains.

W23-W26, pending classifications and scratch removal remain open. Review skipped per Andrew 2026-10-09. No cleanup/deletion, obstruction move, `.llxprt` edit/staging, raw recovery bulk staging, pattern kill, weaker check/bound/timeout, OCR, push or merge occurred in this finalization.
