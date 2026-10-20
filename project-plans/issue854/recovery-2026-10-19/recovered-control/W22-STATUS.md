# W22 agents sweep status

**Request/publication finalization is complete. Production is restored, all owned processes have exited, and W22 remains incomplete.** No new repair family or review began. This supersedes the active-control handoff at `c33ca02a39f324d2a0f2b39aa8989fdc5ceda03c`.

## Restoration and source boundary

Production remains `d7e78deae3cf17a9d4d4de11e4370d1ed67fe9df`. Finalization changed no production code. The supervisor restored both files at 2026-10-20T02:28:43.106Z; independent checks matched backups, production commit and current HEAD, with an empty production diff:

| Restored file | SHA-256 |
| --- | --- |
| `packages/core/src/services/history/journalRowCodec.ts` | `e85f21d09917c28a2b020af6d38789b47f22512f7ee38eb8a03bccf4016df03a` |
| `packages/core/src/services/history/historyCloneUtils.ts` | `be9827c9004eec3bae25703bbf8657e6a909a4e436b241ca16f65b20660c1dec` |

All **55 final source hashes match**. Source commits remain fixture `6a8d4c944`, census/API `f126215be`, media proof `ba487149d` and digest proof `95ca77b0d`. Full SHAs, original-source hashes and raw receipt checksums are in W22-REQUEST-PUBLICATION-PROOF.json.

## Completed controls and gates

Actual source from `31be71369f262f0c15d775b68d31aab8edab0b1b` rejected all **six request digests**, including both nine-MiB inputs. Each measured digest differed from its independent oracle. The original codec produced **39 passes/one field-order failure**. Both controls exited one, without timeout or skip. After byte-identical restoration, unchanged tests passed **6/6 request cases and 40/40 codec cases**, exiting zero.

Both retaining controls rejected **four original ownership predicates**, with two positive charge passes each, exit one, no timeout/skip. Census hash and counterpart guard mutations each rejected and restored with `cmp=0`; the current runner still matches its saved backup. The final census/API suites pass ten cases total: seven original reconciliation cases, one request-source case and two counterpart cases.

The fourteen target files retain **51 passes per backend**, plus forty codec passes per backend. Their completed matrices were reused. All 162 original assertion expressions, domains, timeouts, 512/8192 scales, 440-row/8 MiB bounds and nine-MiB inputs remain; independent oracles and goldens are unchanged.

**No scoped finalization gate is missing.** Ten saved product gates exited zero. Final touched and census strict types, zero-warning lint, format, affected-import graph and AST scan also exited zero. The scan reports 2490 corpus findings, with no new MOCK_MIRROR/ALWAYS_TRUE/SELF_CONFIRMING/NO_ASSERT findings on scoped sources relative to the saved scan. Existing rollback comparisons and repeated phase assertions remain documented; scanner enforcement was not changed. Graph validation does not establish shard-test execution.

Two additional census type-check invocations used incomplete compiler contexts and failed on dependency declarations, then `.ts` import configuration. Both logs remain. The completed invocation inherits the unchanged repository strict options and enables Bun `.ts` imports. No repository check was weakened.

The effective supplemental matrix is **35 files per outer setting: journal 224 passes/one failure; old 225 passes/zero failures**, no skips. The unchanged journal failure is `packages/core/src/services/history/addbatch-value-serialization.test.ts`, which constructs an old recorder before its assertions. It stays red outside the inventory. Its old pass and separate native cyclic-codec/checkpoint proof do not close that exact fixture gap.

## Accepted census and remaining work

**806 = 787 green + 18 red + one unverified**, zero unrun. Exactly ten red and four unverified target paths became green from 773/28/5. This is cumulative per-file evidence, not whole-package final-source green.

Verified cases: **6528 passes/37 failures/zero skips**. The aggregate records 6535 passes; seven inconsistent runner XML passes remain withheld. Classifications: **328 native/311 shared-public/42 explicit-old/5847 pending**, separate unclassified zero. Frozen generation `228ad4f6-129a-475b-adc9-ec6227da0203`: **1224 retained attempts, 26 historical missing attempts, zero latest missing files**. Original admission PID 98836 remains historically missing at its distinct source.

The exact **19 remaining paths** are in W22-REMAINING-FAMILIES.tsv. Conversation observations/model stamps, child ownership/transport, retained growth/controls, send snapshot count, deferred acknowledgement, semantic purge, stream request demand and turn-media rollback remain red; runner-summary accounting remains unverified. Group labels do not establish shared causes. W22/W23-W26, pending classification and scratch removal remain open. The old default is unchanged.

## Process closure and handoff

The final process receipt checked **153 specific recorded PIDs and found all absent**, including supervisors **95088, 21084, 21362, 22669**, original-source driver/children **30110, 30111, 31160**, restored-source driver/children **31170, 31173, 32273**, and final graph/audit **32282, 32352**. There is no active mutation, pending supervisor or handed-off test process. Exact PID list and observation timestamp: W22-REQUEST-PUBLICATION-PROOF.json and `request-publication-run-k/final-process-receipt.json`.

Raw evidence and frozen ledger checksums remain under `tmp/854-notes/p4/w22/request-publication-run-k/`; compact proof/checkpoint documents refer to them by SHA-256. The verified ignored test-utils declaration obstruction remains intact at its unique held path, with its earlier 87 hashes/inode receipt preserved. Unrelated dirty memory/recovery files remain untouched.

Review skipped per Andrew 2026-10-09. No OCR, cleanup/deletion, `.llxprt/` edit/staging, raw recovery bulk staging, push, merge, skip, assertion/bound/timeout weakening or default flip occurred. No further functional cluster starts before primary handoff.
