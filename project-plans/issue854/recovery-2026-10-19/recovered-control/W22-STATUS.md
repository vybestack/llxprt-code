# W22 agents sweep status

## Retained/read-cost finalization, 2026-10-20

The four retained-growth/read-cost targets are green at `888461db478884b0d29b69694e9b5a496d51255e`, following recorder-fixture commit `c69b1c85b`. Effective matrix: eleven files and 55 passes per backend, zero failures/skips. Memory workers were not repeated. All scoped gates pass; five census suites pass fourteen cases/183 expectations. Twenty product hashes match tested/committed bytes.

Normal retained bytes are journal 318257 and old 94638; late fitted/endpoint growth is 21401/2610 and 33342/23367. Bounds remain 1048576 retained bytes and 262144 late-growth bytes. Both retaining traps reject all memory gates. Release traps reject excessive intermediate retention despite small final heaps. The production read-cost control fails twice before byte-exact restoration and passes afterward.

**806 = 805 green + zero red + one unverified**, zero unrun. Verified 6568 passes/zero failures/skips; recorded 6575 includes seven inconsistent runner XML passes withheld. Classifications: 401 native/359 shared-public/44 explicit-old/5764 pending. Keep 1497 attempts, 26 historical missing attempts and zero latest missing files separate. Only four target rows change from baseline 801/4/1. Generation: `ccbaa4bd-6aac-4b0e-a356-3305480eaeb0`.

## Exact remaining queue

| State      | Path                                                      | Historical PID |
| ---------- | --------------------------------------------------------- | -------------: |
| unverified | `packages/agents/test-bun/run-bun-tests.issue3253.bun.ts` |          62524 |

No live owned worker or supervisor remains: all 68 recorded PIDs are absent. No mutation/restoration is pending. The remaining runner has inconsistent nested-summary accounting; it was not repaired or rerun here.

Details: W22-RETAINED-READ-COST-PROOF.md/.json and W22-REMAINING-FAMILIES.tsv. Raw evidence: `tmp/854-notes/p4/w22/retained-run-o/`. Initial marker-fixture and publisher scope failures remain documented, separate from accepted results.

W22 classification and W23-W26/scratch-removal requirements remain open. The cumulative census does not prove a whole-package final-source run. Old default remains. Review skipped per Andrew 2026-10-09. No cleanup, `.llxprt` edit/staging, raw recovery staging, weaker enforcement, push or merge.
