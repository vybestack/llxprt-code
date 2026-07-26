# Execution Tracker — PLAN-20260725-MERGE-0.11-FROM-0.10

**This file is the resume point after context compression.** An agent picking up this work should
read this file first, then `conflict-decisions.md`, then `verification-log.md`.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done+verified · `[!]` blocked/needs review

Immutable inputs (never edit):

```text
MAIN_SHA       = 8ab221bb307080359370281bd3496e12661438da
DEV_SHA        = 527101d14fea534cd69232765d475c0f158c6dfc
MERGE_BASE_SHA = c7b1b787568b84ac9346165e3002e035a748062c   (derived read-only)
BRANCH         = integration/0.11-from-0.10
```

---

## Current State

| Field | Value |
|-------|-------|
| Current phase | **P3 complete · P4 complete · P5 (RG-3 OCR) COMPLETED · G18 drift RESOLVED+VERIFIED · P6 complete (first integration commit) · P7 CI REMEDIATION COMPLETE (CodeRabbit auto-skipped; 4 remediation commits; E2E green) · P8 NOT RUN (awaiting user merge decision)** |
| Merge started? | **YES (committed)** — first integration merge `72564386…` committed: parents `8ab221bb…`(MAIN) + `527101d1…`(DEV); current-main drift merge committed (parents `72564386…` + `9783f8c7…`); HEAD == `e14ecce1336fba987d2bdc840e9ed097176dccad` on `integration/0.11-from-0.10` |
| Actual conflict set | **(1)** 70 paths — exactly matched §F1 forecast. **(2) drift: 3 conflicts** (pr-review walkthrough redesign + quota-selected secret; `Date.now`-relative fixture; `package-lock.json` regen) — all resolved |
| Unmerged paths | **0** — all conflicts from both merges resolved |
| `.llxprt/` status | **No conflict; remains identical to main** (tree OID `f5a6e8742d395b8c9081dbbc6916b08b7aac52a6` == MAIN's; NOT staged) |
| Working tree | Clean — all merges committed; HEAD `e14ecce133` on `integration/0.11-from-0.10`; final local verification (§P7-FINAL) re-run clean on current tree |
| HEAD | `e14ecce1336fba987d2bdc840e9ed097176dccad` (4th CI remediation commit); branch `integration/0.11-from-0.10`; first integration commit `72564386…` (parents `8ab221bb…` MAIN + `527101d1…` DEV) reachable via ancestry |
| Clusters resolved | **ALL 11 clusters VERIFIED** (C1–C11; 70/70 ledger rows VERIFIED) + 3 drift conflicts resolved |
| Ledger rows | **70 VERIFIED / 0 PENDING = 70** (+ 3 drift decisions appended) |
| Gates passed | G1 PASS · F1 PASS · G2 PASS · G3 PASS · G4 PASS (typecheck 0) · G5 PASS (lint 0; lint:ci 0; eslint-guard PASS) · G6 PASS (test 0) · G7 PASS (format 0) · G8 PASS (build 0) · G9 PASS (smoke haiku) · G11 enclave PASS (3957 files) · **G12 PASS (canonical serial: 135 files/3590 tests/9 skipped exit 0)** · **G13 COMPLETE (no new suppressions)** · **G14 COMPLETE (8 renames verified)** · G15 PASS (no source refs) · G16 PASS (bun install 0) · **G18 PASS (drift reconciled — 10 commits, 3 conflicts, full post-drift gates)** · **P7-CI: CodeRabbit AUTO-SKIPPED (581 files > 300 limit); E2E jobs (Linux sandbox none / Linux sandbox docker / macOS) all PASSED after quota compatibility bridge (commit 3489dc7); windows-installed-command transient (not a code defect); CodeQL alerts 177+178 remediated (commit e14ecce)** |
| Gates blocked | **G17 ENV-BLOCKED** (integration suite: provider env missing — not a product failure). Remains ENVIRONMENT-BLOCKED. |
| Gates N/A | **G19 N/A** (`node scripts/start.js` — command absent; not a valid gate). |
| Gates NOT RUN | None outstanding from the listed gate set. (G10 final ancestry for the committed merge tree — ancestry was committed; the two-parent graph is preserved, see §P6.) |
| Reviews | **RG-2 COMPLETED** — DeepThinker reviewed pre-drift staged tree; Zed locked-stream release-blocker fixed with real ACP behavioral tests (331 Zed tests pass). **RG-3 COMPLETED** — OCR verified session `57fe79fd-6f32-4916-8f06-1ed1cadf825b`: **569 files reviewed, 365 deduplicated findings (1 critical / 75 high / 197 medium / 92 low)**; findings source-validated in coherent batches, valid issues remediated, factual/speculative claims rejected. **No post-drift OCR/DeepThinker rerun** (review cap reached; drift = already-reviewed current-main commits + 3 reconciliations). **CodeRabbit AUTO-SKIPPED on PR 2736** (581 files exceed the 300 limit; no threads to triage). **RG-1/RG-4 NOT RUN.** **P6 first integration commit done; final merge committed.** **P7 CI REMEDIATION COMPLETE.** **P8 landing NOT RUN (awaiting user merge decision).** |
| Blocking issue | None blocking code. PR 2736 open on `integration/0.11-from-0.10` → base main; CI remediation complete; CodeRabbit auto-skipped; local verification clean on current tree. Integration suite (G17) remains environment-blocked (not a product failure). Awaiting user go-ahead to merge (§12 landing policy). |

---

## Phase Checklist

| Phase | Name | Status | Evidence location |
|-------|------|--------|-------------------|
| P0 | Preflight & invariants | `[x]` | `verification-log.md` §G1 |
| P1 | Read-only conflict forecast | `[x]` | `verification-log.md` §F1, README §3 |
| P2 | Start merge (no commit) | `[x]` | `verification-log.md` §P2 |
| P3 | Resolve clusters C7→C11 | `[x]` **ALL 11 clusters VERIFIED (70/70)** | `conflict-decisions.md` |
| P4 | Local verification G2–G9, G11–G17 | `[x]` **PASS** — G2–G9/G11/G15/G16 PASS; G12 PASS (canonical serial 135/3590/9 exit 0); G13 COMPLETE; G14 COMPLETE (8 renames verified); G17 ENV-BLOCKED; G10 NOT RUN; G18 PASS (drift reconciled); G19 N/A | `verification-log.md` |
| P5 | Review gates RG-1..RG-4 | `[~]` **PARTIAL** — RG-2 COMPLETED (DeepThinker; Zed blocker fixed); RG-3 COMPLETED (OCR verified session `57fe79fd`: 569 files, 365 findings [1C/75H/197M/92L], source-validated in batches, remediated/rejected); RG-1/RG-4 NOT RUN | `verification-log.md` §RG |
| P6 | Merge commit + ancestry G10 | `[x]` **DONE** — first integration commit `72564386…` (parents `8ab221bb…`+`527101d1…`); current-main drift merge committed; HEAD `e14ecce133` on `integration/0.11-from-0.10`; two-parent graph preserved | `verification-log.md` §G10 |
| P7 | PR + CI + CodeRabbit loop | `[x]` **CI REMEDIATION COMPLETE** — PR 2736 open; CodeRabbit auto-skipped (581>300); 4 remediation commits; E2E jobs green after quota bridge; CodeQL alerts 177+178 remediated; windows-installed-command transient | `verification-log.md` §CI, §P7-FINAL |
| P8 | Landing readiness (G18 drift) | `[~]` **G18 RESOLVED+VERIFIED; CI remediation complete; landing awaits user go-ahead** | `verification-log.md` §G18 |

---

## P0 — Preflight & Invariants  `[x] DONE`

- [x] INV-1 all three SHAs exist as commits (`git cat-file -t` ×3 → `commit`)
- [x] INV-2 HEAD == MAIN_SHA exactly
- [x] INV-3 MAIN_SHA is ancestor of HEAD → `YES`
- [x] INV-4 DEV_SHA is NOT ancestor of HEAD → `NO` (correct pre-merge)
- [x] INV-5 merge-base == `c7b1b787568b84ac9346165e3002e035a748062c`
- [x] INV-6 working tree clean
- [x] INV-7 DEV_SHA reachable via `refs/remotes/origin/dev/0.11.0`

Evidence: `verification-log.md` §G1. **All PASS.**

---

## P1 — Read-Only Conflict Forecast  `[x] DONE`

- [x] `git merge-tree --write-tree -z MAIN_SHA DEV_SHA` executed (exit 1 = conflicts, expected)
- [x] Merged tree OID recorded: `3854f0002ac058f0d07a7e37f017512f38f13143`
- [x] 70 conflicted paths enumerated (57 content / 12 add/add / 1 modify/delete)
- [x] Clusters C1–C11 assigned; ledger pre-seeded with all 70 rows
- [x] `.llxprt` merged tree OID verified == MAIN's `f5a6e8742d395b8c9081dbbc6916b08b7aac52a6`
- [x] Rename set (8) captured; DEV/MAIN deletion sets captured

Evidence: `verification-log.md` §F1. **All PASS.**

---

## P2 — Start Merge  `[x] DONE`

Merge started with explicit authorization to modify the working tree.

- [x] Re-run P0 invariants (branch state confirmed correct)
- [x] Confirm working tree clean before starting
- [x] Start the merge: `git merge --no-ff --no-commit 527101d14fea534cd69232765d475c0f158c6dfc`
      (preserves both parents; no squash, no rebase)
- [x] `MERGE_HEAD` confirmed == `527101d14fea534cd69232765d475c0f158c6dfc` (== `DEV_SHA`)
- [x] Capture the **actual** conflicted-path list from the real merge
- [x] Diff actual list vs the 70-path forecast → **exact match, zero delta**
      (57 content / 12 add/add / 1 modify/delete)
- [x] Confirm `.llxprt/` is NOT in the actual conflict list — **confirmed; no `.llxprt` status;
      remains identical to main** (verified against the real merge, not just the prediction)

**Exit condition met:** merge in progress, actual conflict set recorded (== forecast, no delta),
ledger reconciled. Evidence: `verification-log.md` §P2.

---

## P3 — Cluster Resolution  `[x] COMPLETE — ALL 11 clusters VERIFIED (70/70 rows)`

Resolved in the mandated order (contracts/harness first, generated artifacts last):

| # | Cluster | Files | Status | Ledger rows | Cluster test | Result |
|---|---------|-------|--------|-------------|--------------|--------|
| 1 | **C7** test-utils harness | 4 | `[x]` **VERIFIED** | CD-C7-001..004 | `npm run test --workspace @vybestack/llxprt-code-test-utils` | **PASS** — process-run 19/19, interactive-run 11/11 |
| 2 | **C8** guard scripts + tsconfig | 6 | `[x]` **VERIFIED** | CD-C8-001..006 | whole-repo GenAI enclave pass (3957 files) + `npm test` EXIT_STATUS=0 | **PASS** |
| 3 | **C3** core config/contracts | 6 | `[x]` **VERIFIED** | CD-C3-001..006 | whole-repo `npm test` EXIT_STATUS=0 | **PASS** |
| 4 | **C2** providers | 8 | `[x]` **VERIFIED** | CD-C2-001..008 | whole-repo `npm test` EXIT_STATUS=0 | **PASS** |
| 5 | **C1** agents/turn/stream | 14 | `[x]` **VERIFIED** | CD-C1-001..014 | whole-repo `npm test` EXIT_STATUS=0 | **PASS** |
| 6 | **C4** cli | 9 | `[x]` **VERIFIED** | CD-C4-001..008 + CD-MD-001 | whole-repo `npm test` EXIT_STATUS=0 | **PASS** |
| 7 | **C5** a2a-server | 7 | `[x]` **VERIFIED** | CD-C5-001..007 | whole-repo `npm test` EXIT_STATUS=0 | **PASS** |
| 8 | **C6** policy | 3 | `[x]` **VERIFIED** | CD-C6-001..003 | whole-repo `npm test` EXIT_STATUS=0 | **PASS** |
| 9 | **C9** small packages | 4 | `[x]` **VERIFIED** | CD-C9-001..004 | whole-repo `npm test` EXIT_STATUS=0 | **PASS** |
| 10 | **C10** CI workflows | 3 | `[x]` **VERIFIED** | CD-C10-001..003 | YAML validity + `npm test`/build pass | **PASS** |
| 11 | **C11** root manifests + docs | 6 | `[x]` **VERIFIED** | CD-C11-001..006 | plain `bun install` exit 0 + `npm test`/lint/typecheck/build/format/enclave | **PASS** |

**Total: 4+6+6+8+14+9+7+3+4+3+6 = 70 rows — ALL VERIFIED.** The single modify/delete row
(`CD-MD-001`) is the 9th row of C4, not an extra row.

**Note on verification basis:** cluster test commands were not run individually for every cluster;
instead the **whole-repo `npm test`** (EXIT_STATUS=0), **whole-repo `npm run typecheck`** (exit 0),
**whole-repo `npm run build`** (EXIT_STATUS=0), and the GenAI enclave pass (3957 files, exit 0) were
run. These cover all clusters. C7 was additionally verified with its own workspace test
(process-run 19/19, interactive-run 11/11).

### Per-cluster completion protocol (apply to EVERY cluster)

For cluster `Cn`, all of the following must be true before marking `[x]`:

- [ ] Every file in the cluster read on **both** sides (`git show MAIN_SHA:<p>`, `git show DEV_SHA:<p>`)
- [ ] Every hunk resolved as union-of-intent (CR-2), not wholesale side-taking (REQ-NL-3)
- [ ] Zero conflict markers remain in the cluster's files
- [ ] Every ledger row for the cluster moved `PENDING` → `RESOLVED` with rationale filled in
- [ ] REQ-NL check answered per row: what main behavior survives / what dev behavior survives
- [ ] No new suppression introduced (§1.4) — spot-check the cluster diff
- [ ] Cluster test command run; output pasted into `verification-log.md`
- [ ] Ledger rows moved `RESOLVED` → `VERIFIED` once cluster test passes
- [ ] `execution-tracker.md` row updated (so a compressed-context agent can resume here)

### High-attention items inside P3 — all RESOLVED

- [x] **C7**: resolved — combined MAIN RunCapture/process lifecycle/Bun launcher + DEV quota-guard;
      unioned both test suites. **VERIFIED** (process-run 19/19, interactive-run 11/11).
- [x] **C8**: resolved/staged/VERIFIED (6 files) — retained MAIN hardened async/scannable-file
      behavior + all DEV enclave/publish coverage; tsconfig union. **GenAI enclave pass (3957
      files, exit 0) + whole-repo `npm test` EXIT_STATUS=0.**
- [x] **C1**: `turn.ts` + `StreamProcessor.ts` + `AgenticLoop.ts` + `loopHelpers.ts` resolved as ONE
      coherent unit. Turn citation helpers extracted (`turnCitations.ts`).
- [x] **C1**: `providerAgnosticNamingAllowlist.ts` (add/add) resolved as the **union**.
- [x] **C2**: `IProvider.ts` resolved FIRST; implementations conformed. OpenAI reasoning helpers
      extracted (`parseResponsesStreamReasoning.ts`, `parseResponsesStreamTypes.ts`).
- [x] **C2/C3**: `IProvider.ts` and `RuntimeProviderChat.ts` kept mutually consistent.
- [x] **C3**: `tokenLimits.ts` + `tokenLimits.test.ts` resolved together; **union** of model entries.
- [x] **C3**: `secure-browser-launcher.ts` resolved to the **stricter** validation (CR-9).
- [x] **C3**: `profileSettingsWithTools` contract widened correctly (root fix).
- [x] **C4**: `CD-MD-001` modify/delete — main's deletion **accepted** (old bin launcher retired;
      file NOT_PRESENT in tree; see `conflict-decisions.md` §2).
- [x] **C4**: `useIdeRestartHotkey` — **zero source references** (DEV deleted it; only stale
      `dist/` artifacts remain, which are untracked build output, not source).
- [x] **C4**: CLI unconfigured-provider config mock fixed (root fix).
- [x] **C5**: 3 add/add test files → union of coverage.
- [x] **C6**: default-deny policy behavior preserved (CR-9).
- [x] **C8→C11**: guard resolved; `dev-docs/genai-import-baseline.md` reconciled.
- [x] **C10**: main's `#2697` mergeability-gate permissions fix preserved (CR-5).
- [x] **C11** (`package.json`): VERIFIED — exact union; DEV `generate:release-notes` + ACP SDK
      `^1.2.1` retained; all MAIN newer scripts retained.
- [x] **C11**: `bun.lock` **regenerated** (not hand-merged); plain `bun install` exit 0; lockfiles
      staged. `package-lock.json` also regenerated/staged.
- [x] **C11**: `CHANGELOG.md` = union of both sides' entries.
- [x] **Follow-ups**: `responseIdCarrier.ts` and `streamChunkVisibility.ts` (out-of-enclave
      `@google/genai` imports) **removed** as dead code — not baseline weakening. Both NOT_PRESENT.

### Root fixes made during integration (no-functionality-loss)

These fixes were made during conflict resolution to satisfy gates without suppression or
functionality loss:

- **`profileSettingsWithTools` contract widened correctly** — the type contract was widened to
  accommodate the union of both sides' settings shape, not narrowed or suppressed.
- **Stale ignored `dist/` declarations rebuilt** instead of a source workaround — the ignored
  generated declarations were rebuilt rather than hacking source to satisfy them.
- **Provider-neutral naming fixed** — naming was made provider-neutral (not vendor-specific).
- **Dead out-of-enclave `responseIdCarrier`/`streamChunkVisibility` removed** — these imported
  `@google/genai` outside the enclave boundary; removed as dead code (not baseline weakening).
- **Turn citation helpers and OpenAI reasoning helpers extracted for source size** — `turnCitations.ts`,
  `parseResponsesStreamReasoning.ts`, `parseResponsesStreamTypes.ts` extracted to keep source files
  manageable; behavior preserved.
- **Release-process test helpers consolidated** — test helpers for the release process consolidated.
- **Test-utils finalized on Vitest** — because Bun/node-pty process lifecycle is unreliable, the
  test-utils suite runs under Vitest; **119/119 tests pass**.
- **CLI unconfigured-provider config mock fixed** — the mock for the unconfigured-provider config
  path was corrected.
- **Locks/schema/import inventory regenerated** — `bun.lock`, `package-lock.json`,
  `schemas/settings.schema.json`, and the GenAI import inventory (29 importers) regenerated.

---

## P4 — Local Verification  `[x] PASS — G17 ENV-BLOCKED; G10/G18 NOT RUN; G19 N/A`

Run in order; real output pasted into `verification-log.md` for each.

- [x] **G2** zero conflict markers repo-wide — **PASS** (`git diff --diff-filter=U` = 0 unmerged)
- [x] **G3** `.llxprt` tree OID == `f5a6e8742d395b8c9081dbbc6916b08b7aac52a6` — **PASS** (no conflict; unchanged from main; NOT staged)
- [x] **G14** rename carry-over (8 rows, README §6.2) — **COMPLETE** (all 8 verified against staged tree: new paths present, old paths absent)
- [x] **G15** no dangling `useIdeRestartHotkey` references — **PASS** (zero `.ts`/`.tsx` source refs; only stale `dist/` artifacts)
- [x] **G16** `bun install` (plain) → exit 0, all 16 workspaces — **PASS**
- [x] **G4** `npm run typecheck` — **PASS** (exit 0)
- [x] **G5** `npm run lint` — **PASS** (EXIT_STATUS=0); `lint:ci` PASS (eslint --max-warnings 0); `lint:eslint-guard` PASS
- [x] **G6** `npm run test` — **PASS** (EXIT_STATUS=0)
- [x] **G7** `npm run format` — **PASS** (exit 0; no unstaged changes)
- [x] **G8** `npm run build` — **PASS** (EXIT_STATUS=0)
- [x] **G11** guard scripts — **PASS**: GenAI enclave pass (3957 files scanned, exit 0); GenAI import inventory up to date (29 importers); `lint:eslint-guard` PASS
- [x] **G12** `npm run test:scripts` — **PASS (canonical serial)**: 135 files / 3590 tests / 9 skipped, exit 0 at `/tmp/llxprt_merge_scripts_serial_postocr.log`. Default parallel run had Vitest worker RPC timeout AFTER all 3590 assertions passed (noncanonical infrastructure noise).
- [x] **G13** suppression-delta audit vs both parents — **COMPLETE** (no new suppressions; lint/typecheck/test all pass; no suppression directives added; out-of-enclave imports removed as dead code, not suppressed)
- [!] **G17** `npm run test:integration:sandbox:none` — **ENV-BLOCKED**: 15 files passed / 9 failed, 146 tests passed / 14 failed / 7 skipped. **Every** failure was blocked *before* product assertions by missing `LLXPRT_DEFAULT_PROVIDER` and related provider/model/base-URL/auth environment. Marked **ENV-BLOCKED**, not PASS. (Tmux slash-autocomplete harness separately exit 0 with artifact at `/var/folders/qd/962lhrjj0232rjykgg3lgmrw0000gn/T/llxprt-tmux-harness-1785039526703`.)
- [x] **G9** `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` — **PASS** (returned a haiku, exit 0)
- [x] **G19** `node scripts/start.js` — **N/A** (command absent; only `scripts/start.ts` exists; not a valid gate)

**Rule:** a gate is PASS only with pasted evidence. No evidence ⇒ FAIL. Never make a gate pass via
suppression, rule weakening, or test deletion (README §1.4). G17 is honestly reported as
ENV-BLOCKED — it is NOT labeled PASS. G10/G18 are NOT RUN (merge not committed / P8). G19 is N/A
(command absent).

---

## P5 — Review Gates  `[~] PARTIAL — RG-2/RG-3 COMPLETED; RG-1/RG-4 NOT RUN`

- [ ] **RG-1** cluster self-review: all 70 ledger rows `VERIFIED`, none `NEEDS-REVIEW` (ledger is complete; formal sign-off not recorded)
- [x] **RG-2** architecture review (deepthinker): **COMPLETED** — DeepThinker reviewed the staged
      pre-drift tree (not just the OCR snapshot). Found the Zed locked-stream shutdown as the
      release-blocker → **FIXED with real ACP behavioral tests**. Full 331-test Zed suite passes
      under whole-repo `npm test`.
- [x] **RG-2a** remediate any RG-2 findings — **DONE**: Zed locked-stream shutdown fixed with real
      ACP behavioral tests; re-verified under `npm test` EXIT_STATUS=0.
- [x] **RG-3** `ocr` review — **COMPLETED**: verified session
      `57fe79fd-6f32-4916-8f06-1ed1cadf825b`. **569 files reviewed, 365 deduplicated findings (1
      critical / 75 high / 197 medium / 92 low)**. Tests included in scope (global `rule.json`
      include patterns re-include `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`). Output:
      `/tmp/ocr_review_final.log` and `/tmp/ocr_findings_final_unique.tsv`. Session JSONL:
      `~/.opencodereview/sessions/Users-acoliver-projects-llxprt-branch-1-llxprt-code/57fe79fd-6f32-4916-8f06-1ed1cadf825b.jsonl`.
- [x] **RG-3a** tests included in ocr scope — **YES** (global `~/.opencodereview/rule.json` re-includes `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`)
- [x] **RG-3b** every ocr finding addressed or explicitly dispositioned — **DONE**: findings were
      **source-validated in coherent batches**; valid issues were **remediated**; factual/speculative
      claims were **rejected**. See `verification-log.md` §RG for the theme disposition summary.
- [x] **RG-3c** re-run ocr if remediation was significant — **No post-drift OCR rerun performed.**
      The review cap was reached. The drift consists entirely of already-reviewed current-main
      commits plus three reconciliations covered by focused/full gates — a rerun would not add
      signal. Honesty: do not claim a rerun that didn't occur.
- [ ] **RG-4** full verification cycle re-run after all remediation — NOT RUN (the verification cycle
      G2–G9/G11–G16 was run; RG-4 formal re-run sign-off not recorded)

> **OCR scope + drift note:** The OCR session `57fe79fd` reviewed the pre-drift tree (569 files,
> 365 deduplicated findings), which is the superset of what the drift introduced. DeepThinker
> reviewed the current staged pre-drift tree and the release-blocker (Zed locked-stream shutdown)
> was remediated with real ACP behavioral tests (331-test Zed suite passes). **No post-drift
> OCR/DeepThinker rerun was performed** — the review cap was reached, and the drift is composed of
> already-reviewed current-main commits plus three reconciliations covered by focused/full gates.

---

## P6 — Merge Commit + Ancestry  `[x] DONE`

- [x] First integration commit created: `7256438614b59da9a764d74f73bd12b830e909d0` (two parents, no squash, no rebase)
- [x] **INV-8 (first commit)** exactly 2 parents: `8ab221bb307080359370281bd3496e12661438da` + `527101d14fea534cd69232765d475c0f158c6dfc`
- [x] **INV-9 (first commit)** `HEAD^1` == `8ab221bb…` (MAIN lineage)
- [x] **INV-10 (first commit)** `HEAD^2` == `527101d14fea534cd69232765d475c0f158c6dfc` (DEV_SHA)
- [x] **Final merge committed** (current-main drift, `9783f8c7…`) — committed; two-parent graph preserved; branch `integration/0.11-from-0.10` HEAD == `e14ecce1336fba987d2bdc840e9ed097176dccad`
- [x] **CI remediation commits appended** (4 commits: `3489dc716d`, `f8cd1ef094`, `84154ccfdf`, `e14ecce133`) — forward fixes on top of the integration branch; no rewrite of MAIN/DEV ancestry
- [x] **INV-15** `.llxprt` tree unchanged from MAIN's `f5a6e8742d395b8c9081dbbc6916b08b7aac52a6` (`.llxprt` never modified during integration or remediation)

> G10 ancestry evidence for the committed tree is in `verification-log.md` §G10. The immutable
> SHA records (`MAIN_SHA`, `DEV_SHA`, `MERGE_BASE_SHA`) in §0 remain unchanged.

---

## P7 — PR + CI + CodeRabbit  `[x] CI REMEDIATION COMPLETE`

- [x] Push branch `integration/0.11-from-0.10`
- [x] Create PR via `gh`: **PR 2736**, `integration/0.11-from-0.10` → base `main`
- [x] **CodeRabbit:** automatically **skipped** — "Review skipped: 581 files exceed the limit of 300".
      **No CodeRabbit threads exist to triage.** (Not a failure; an automatic cap.)
- [x] Watch CI; remediate failures without weakening gates (§1.4); re-run local verification after
      each remediation; push and watch again. **4 CI remediation commits landed (below).**
- [x] Re-run local verification cycle on the current tree after all remediation (§P7-FINAL)

### CI remediation commits (in order, all forward commits on `integration/0.11-from-0.10`)

#### Commit 1 — `3489dc716d590a19abd738f3a336e0804fcb7d93` (2026-07-26 13:00:51 -0300)
**"Preserve trusted E2E quota selection across base versions"**

| Field | Value |
|-------|-------|
| Root cause | The trusted quota selector step checks out the base SHA `9783f8c7…`, whose `scripts/ci-quota-check.js` writes `OPENAI_API_KEY` to `GITHUB_ENV` but never emits `selected_key` to `GITHUB_OUTPUT`, while the integrated `e2e.yml` reads only `steps.quota.outputs.selected_key`. Result: "OPENAI_API_KEY missing after quota selection". |
| Affected CI jobs | Linux sandbox none, Linux sandbox docker, macOS (all three E2E jobs) |
| Fix | A compatibility bridge in **both** quota steps (`quota` and `quota_macos`) in `e2e.yml` that: (1) scrubs `OPENAI_API_KEY` from `GITHUB_ENV` before untrusted checkout (`awk` filter); (2) accepts a valid `primary` or `secondary` output; (3) emits `selected_key=primary` only for the legacy non-Synthetic path; (4) fails closed otherwise. Plus a new `scripts/tests/workflow-quota-selection.test.js`. |
| Files | `.github/workflows/e2e.yml` (+48/-2), `scripts/tests/workflow-quota-selection.test.js` (+17) |
| Outcome | All three E2E jobs later **PASSED** |

#### Commit 2 — `f8cd1ef094505b8baaaaa40d62dd31da79386336` (2026-07-26 13:15:24 -0300)
**"Neutralize internal token usage logging"**

| Field | Value |
|-------|-------|
| Root cause | The newly merged full agents-neutral gate from main detected Gemini-shaped usage keys (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `cachedContentTokenCount`) that existed in frozen dev code in `StreamProcessor.ts`, `TurnProcessor.ts`, and `tokenUsageActualLogger.ts`. |
| Fix | Replaced the internal `UsageMetadataWithCache` compatibility type with a **neutral** `ActualTokenUsageInput` contract using `promptTokens`, `cachedTokens`, and `cache_read_input_tokens`; updated both callers (`StreamProcessor.ts`, `TurnProcessor.ts`); rewrote the logger tests test-first including explicit **cache precedence** coverage (`cachedTokens` wins over `cache_read_input_tokens`; default 0). |
| Files | `StreamProcessor.ts`, `TurnProcessor.ts`, `tokenUsageActualLogger.ts`, `tokenUsageActualLogger.test.ts` |
| Suppression / allowlist added? | **No allowlist entry and no suppression added.** (Neutralization, not suppression.) |

#### Commit 3 — `84154ccfdf19d78d2bb558f52ebb213b469999c7` (2026-07-26 13:22:08 -0300)
**"Update the GenAI import inventory"**

| Field | Value |
|-------|-------|
| Root cause | The neutralization (commit 2) removed the last non-enclave importer. |
| Fix | `dev-docs/genai-import-baseline.md` regenerated from **29 importers → 28**, with the `#2349` owner row (`packages/agents/src/core/tokenUsageActualLogger.ts`) removed. **Regenerated with the documented generator, not hand-edited.** |
| Files | `dev-docs/genai-import-baseline.md` (+1/-3) |

#### Commit 4 — `e14ecce1336fba987d2bdc840e9ed097176dccad` (2026-07-26 14:31:44 -0300)
**"Harden credential-write parsing and upload cache keying"**

Two CodeQL high-severity alerts appeared on dev-origin code that had never been scanned against main.

| Field | Value |
|-------|-------|
| **Alert 178** `js/polynomial-redos` | In `packages/policy/src/destructive-commands.ts`, where the `dd of=` regex backtracked polynomially on adversarial input; a pathological input took ~56–62s. |
| Alert 178 fix | Replaced the regex with a **deterministic linear scan** helper `extractDdOutputOperand` whose behavior was verified identical across **34 edge cases**; the pathological case now completes in **~19ms**. |
| Alert 178 files | `packages/policy/src/destructive-commands.ts` (+53), `packages/policy/src/destructive-commands.dd-of-credential.test.ts` (+54, new behavioral test incl. ReDoS timing budget) |
| **Alert 177** `js/insufficient-password-hash` | In `packages/providers/src/kimi/kimiFileUpload.ts`, where the api key was hashed with bare SHA-256 for cache namespacing. |
| Alert 177 fix | Replaced with **HMAC-SHA256** using the api key as key material and a fixed domain-separation label (`llxprt-kimi-upload-cache-key`); preserves cache key composition and all namespacing properties. |
| Alert 177 files | `packages/providers/src/kimi/kimiFileUpload.ts` (+24/-9), `packages/providers/src/kimi/kimiFileUpload.test.ts` (+89, new: cache-key distinctness + stability tests) |
| Suppression added? | **No.** Both alerts fixed at the source with new behavioral tests. |

### windows-installed-command investigation — classified TRANSIENT (not a code defect)

| Field | Value |
|-------|-------|
| Failure mode | One failure with `spawnSync ETIMEDOUT` during `npm global install` |
| Smoke inputs | Confirmed **unchanged** relative to current main, except an `@agentclientprotocol/sdk` bump that is correctly resolved in `package-lock.json` |
| Cross-branch evidence | The same workflow **succeeded repeatedly** on other recent branches |
| Re-run result | An explicit re-run of the **identical commit** **succeeded** |
| Classification | **Transient registry or runner timeout** — with the evidence above, **not a code defect** |

### CI loop iterations

| Iter | Date | Failing checks | CodeRabbit threads open | Action taken | Result |
|------|------|----------------|-------------------------|--------------|--------|
| 1 | 2026-07-26 | E2E: "OPENAI_API_KEY missing after quota selection" (Linux sandbox none, Linux sandbox docker, macOS) | — | Commit `3489dc716d`: quota compatibility bridge in `e2e.yml` | E2E jobs PASSED |
| 2 | 2026-07-26 | agents-neutral gate flagged Gemini-shaped usage keys | — | Commit `f8cd1ef094`: neutralize token usage logging | gate PASS |
| 3 | 2026-07-26 | genai-import-baseline mismatch (29 vs 28) | — | Commit `84154ccfdf`: regenerate baseline (28 importers) | gate PASS |
| 4 | 2026-07-26 | CodeQL alert 178 (js/polynomial-redos) + CodeQL alert 177 (js/insufficient-password-hash) | — | Commit `e14ecce133`: linear scan + HMAC-SHA256; new tests | CodeQL PASS |
| 5 | 2026-07-26 | windows-installed-command ETIMEDOUT (1×) | — | Investigated; re-run of identical commit succeeded | Transient — not a code defect |
| — | — | — | **0 (CodeRabbit auto-skipped: 581 > 300)** | No threads to triage | N/A |

> **CodeRabbit:** automatically skipped with message "Review skipped: 581 files exceed the limit of
> 300". **No CodeRabbit threads exist to triage.** This is an automatic cap, not a failure.

### §P7-FINAL — Final local verification on the current tree (HEAD `e14ecce133`)

| Gate | Command | Result | Status |
|------|---------|--------|--------|
| G6 (test) | `npm run test` | **EXIT_STATUS=0** | **PASS** |
| G5 (lint:ci) | `npm run lint:ci` | exit 0 | **PASS** |
| G4 (typecheck) | `npm run typecheck` | exit 0 | **PASS** |
| G7 (format) | `npm run format` | exit 0, **no resulting working-tree changes** | **PASS** |
| G8 (build) | `npm run build` | exit 0 | **PASS** |
| G11 (genai-inventory) | `npm run lint:genai-inventory` | exit 0 | **PASS** |
| G16 (lockfile) | `npm run check:lockfile` | exit 0 | **PASS** |
| G11 (eslint-guard) | `npm run lint:eslint-guard` | exit 0 | **PASS** |
| G9 (smoke) | `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` | exit 0, returned a haiku | **PASS** |

**Local tooling artifact (not a gate failure):** `npm run gate:agents-neutral` exits 127 locally
**solely because `tsx` is not resolvable locally**; the same gate **passes in CI**. This is a local
tooling artifact, **not a gate failure**.

**Provider-backed integration suite:** remains **ENVIRONMENT-BLOCKED** (G17) — not PASS, not a
product failure.

---

## P8 — Landing Readiness  `[~] CI REMEDIATION COMPLETE; landing awaits user go-ahead`

- [x] **G18** snapshot-drift check: `origin/main` == `9783f8c7f1b04f8f852b397dca3a626532e6f095` ≠ `8ab221bb…`
      → **DRIFT DETECTED (10 commits) — RECONCILED**
- [x] Drift integrated: 3 conflicts resolved; README §13.1 records the full reconciliation
- [x] Post-drift gates re-run: full `npm test` exit 0; `lint:ci` exit 0; eslint guard exit 0;
      typecheck/format/build pass; serial scripts 144 files/4059 tests exit 0; lockfile/GenAI/API
      guards pass; stepfun smoke pass. **No post-drift OCR/DeepThinker rerun** (review cap reached).
- [x] **P7 CI remediation complete** — PR 2736; CodeRabbit auto-skipped (581>300, no threads);
      E2E green after quota bridge; CodeQL 177+178 remediated; windows-installed-command transient.
- [x] **Final local verification clean** on current tree (§P7-FINAL): test/lint:ci/typecheck/format/
      build/genai-inventory/lockfile/eslint-guard all exit 0; smoke haiku exit 0; format produced no
      working-tree changes. G17 remains ENV-BLOCKED. `gate:agents-neutral` 127 locally = local
      tooling artifact (passes in CI).
- [ ] Report status to user and **request explicit confirmation to merge**
- [ ] **DO NOT merge without explicit user go-ahead**

Drift log (append each check):

| Date | `origin/main` SHA | Drifted? | Action |
|------|-------------------|----------|--------|
| 2026-07-25 | `8ab221bb307080359370281bd3496e12661438da` (local ref at plan time) | No | Baseline recorded |
| 2026-07-26 | `9783f8c7f1b04f8f852b397dca3a626532e6f095` | **YES — 10 commits** | **RECONCILED**: 3 conflicts resolved (pr-review walkthrough redesign + quota-selected secret; `Date.now`-relative fixture; `package-lock.json` regen). First integration commit `72564386…` committed. Active second merge (`MERGE_HEAD`==`9783f8c7…`) reconciled. Full post-drift gates PASS (npm test/lint:ci/eslint-guard/typecheck/format/build/serial-scripts 144/4059/lockfile/GenAI/API/smoke). No post-drift OCR/DeepThinker rerun (review cap reached; drift = already-reviewed current-main commits + 3 reconciliations). G17 remains ENV-BLOCKED. |

---

## Rollback Points Status

| RP | Description | Available now? |
|----|-------------|----------------|
| RP-0 | Pristine branch at MAIN_SHA | Available via forward history; `72564386…` (first integration commit) has both MAIN+DEV parents and is an ancestor of current HEAD `e14ecce133` |
| RP-1 | Per-cluster checkpoints | All 11 clusters resolved/staged/VERIFIED (C1–C11, 70/70 rows). |
| RP-2 | Resolved, pre-commit | First integration commit `72564386…` committed (70 conflicts resolved/verified). Drift merge committed. 4 CI remediation commits appended forward. |
| RP-3 | Final merge commit, pre-push | Final current-main merge committed; 4 CI remediation commits appended on top (HEAD `e14ecce133`); branch pushed; PR 2736 open |
| RP-4 | Pushed / PR open (fix forward; **no force-push**) | **Active** — PR 2736 open on `integration/0.11-from-0.10` → base `main`; CI remediation complete; CodeRabbit auto-skipped |

---

## Standing Constraints (apply at every phase)

- [ ] Never modify anything under `.llxprt/`
- [ ] Never delete or clean anything (`rm -rf`, `git clean` are forbidden)
- [ ] Never add lint/type suppressions or weaken rules to pass a gate
- [ ] Never delete or skip tests to pass a gate
- [ ] Never squash or rebase — the two-parent graph is a deliverable
- [ ] Never force-push after the PR exists
- [ ] Never merge the PR without explicit user confirmation
- [ ] Never claim a gate passed without pasted real output
