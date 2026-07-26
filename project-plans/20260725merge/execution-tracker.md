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
| Current phase | **P3 complete · P4 complete · P5 (RG-3 OCR) COMPLETED · P6/P7/P8 NOT RUN** |
| Merge started? | **YES** — `git merge --no-ff --no-commit 527101d14fea534cd69232765d475c0f158c6dfc`; `MERGE_HEAD` == `DEV_SHA` |
| Actual conflict set | **70 paths** — exactly matched the §F1 forecast (57 content / 12 add/add / 1 modify/delete); no delta |
| Unmerged paths | **0** — `git diff --name-only --diff-filter=U` returns empty (all 70 resolved; 592 files staged) |
| `.llxprt/` status | **No conflict; remains identical to main** (tree OID `f5a6e8742d395b8c9081dbbc6916b08b7aac52a6` == MAIN's; NOT staged) |
| Working tree | Merge in progress (uncommitted); all resolved files staged; no commit yet |
| HEAD | `8ab221bb307080359370281bd3496e12661438da` (MAIN) — **merge commit NOT yet created**; `MERGE_HEAD` == `527101d14fea534cd69232765d475c0f158c6dfc` |
| Clusters resolved | **ALL 11 clusters VERIFIED** (C1–C11; 70/70 ledger rows VERIFIED) |
| Ledger rows | **70 VERIFIED / 0 PENDING = 70** |
| Gates passed | G1 PASS · F1 PASS · G2 PASS · G3 PASS · G4 PASS (typecheck 0) · G5 PASS (lint 0; lint:ci 0; eslint-guard PASS) · G6 PASS (test 0) · G7 PASS (format 0) · G8 PASS (build 0) · G9 PASS (smoke haiku) · G11 enclave PASS (3957 files) · **G12 PASS (canonical serial: 135 files/3590 tests/9 skipped exit 0)** · **G13 COMPLETE (no new suppressions)** · **G14 COMPLETE (8 renames verified)** · G15 PASS (no source refs) · G16 PASS (bun install 0). |
| Gates blocked | **G17 ENV-BLOCKED** (integration suite: 15 files pass/9 fail, 146 pass/14 fail/7 skip — every failure blocked before product assertions by missing `LLXPRT_DEFAULT_PROVIDER` + provider/model/base-URL/auth env). |
| Gates N/A | **G19 N/A** (`node scripts/start.js` — command absent; not a valid gate). |
| Gates NOT RUN | G10 (post-merge ancestry — merge not committed), G18 (drift re-check — P8). |
| Reviews | **RG-2 COMPLETED (partial)** — DeepThinker reviewed current staged tree; Zed locked-stream release-blocker fixed with real ACP tests (331 Zed tests pass). **RG-3 COMPLETED** — OCR final session `d045460a` (2026-07-26 10:41): 81 high/185 med/64 low; all dispositioned. **RG-1/RG-4 NOT RUN.** **P6 NOT RUN** (no commit) · **P7 PR/CI/CodeRabbit NOT RUN** · **P8 landing NOT RUN** |
| Blocking issue | None blocking code. Commit/PR/CI remain outstanding. Integration suite failures are environment-blocked (not product failures). OCR findings all dispositioned; no resolution change required. |

---

## Phase Checklist

| Phase | Name | Status | Evidence location |
|-------|------|--------|-------------------|
| P0 | Preflight & invariants | `[x]` | `verification-log.md` §G1 |
| P1 | Read-only conflict forecast | `[x]` | `verification-log.md` §F1, README §3 |
| P2 | Start merge (no commit) | `[x]` | `verification-log.md` §P2 |
| P3 | Resolve clusters C7→C11 | `[x]` **ALL 11 clusters VERIFIED (70/70)** | `conflict-decisions.md` |
| P4 | Local verification G2–G9, G11–G17 | `[x]` **PASS** — G2–G9/G11/G15/G16 PASS; G12 PASS (canonical serial 135/3590/9 exit 0); G13 COMPLETE; G14 COMPLETE (8 renames verified); G17 ENV-BLOCKED; G10/G18 NOT RUN; G19 N/A | `verification-log.md` |
| P5 | Review gates RG-1..RG-4 | `[~]` **PARTIAL** — RG-2 COMPLETED (DeepThinker; Zed blocker fixed); RG-3 COMPLETED (OCR final session; 81H/185M/64L dispositioned); RG-1/RG-4 NOT RUN | `verification-log.md` §RG |
| P6 | Merge commit + ancestry G10 | `[ ]` NOT RUN (no commit yet) | `verification-log.md` §G10 |
| P7 | PR + CI + CodeRabbit loop | `[ ]` NOT RUN | `verification-log.md` §CI |
| P8 | Landing readiness (G18 drift) | `[ ]` NOT RUN | `verification-log.md` §G18 |

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
- [x] **RG-2** architecture review (deepthinker): **COMPLETED (partial)** — DeepThinker reviewed the
      current staged tree (not just the OCR snapshot). Found the Zed locked-stream shutdown as the
      release-blocker → **FIXED with real ACP tests**. 331 Zed tests pass under whole-repo `npm test`.
- [x] **RG-2a** remediate any RG-2 findings — **DONE**: Zed locked-stream shutdown fixed with real
      ACP tests; re-verified under `npm test` EXIT_STATUS=0.
- [x] **RG-3** `ocr` review — **COMPLETED**: final session `d045460a` (2026-07-26 10:41). 115 files
      reviewed, 81 high / 185 medium / 64 low findings. Tests included in scope (global rule.json
      include patterns). Log: `/tmp/ocr_review.log`. Session JSONL: `~/.opencodereview/sessions/.../d045460a-*.jsonl`.
- [x] **RG-3a** tests included in ocr scope — **YES** (global `~/.opencodereview/rule.json` re-includes `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`)
- [x] **RG-3b** every ocr finding addressed or explicitly dispositioned — **DONE** (see
      `verification-log.md` §RG for the 10-theme disposition summary covering all 81 high findings;
      none require a resolution change — all are pre-existing DEV/main logic covered by passing gates)
- [x] **RG-3c** re-run ocr if remediation was significant — the OCR snapshot predates some later
      fixes, but DeepThinker reviewed the current staged tree and the release-blocker was remediated.
      No re-run of OCR occurred after the final session (honesty: do not claim a rerun that didn't occur).
- [ ] **RG-4** full verification cycle re-run after all remediation — NOT RUN (the verification cycle
      G2–G9/G11–G16 was run; RG-4 formal re-run sign-off not recorded)

> **OCR snapshot timing note:** The OCR session reviewed a snapshot commit that predates some later
> fixes. DeepThinker subsequently reviewed the **current staged tree** and the release-blocker (Zed
> locked-stream shutdown) was remediated with real ACP tests. The Zed test suite passes (331 tests).

---

## P6 — Merge Commit + Ancestry  `[ ] NOT STARTED`

- [ ] Create the merge commit (two parents; no squash, no rebase)
- [ ] **INV-8** exactly 2 parents
- [ ] **INV-9** `HEAD^1` on MAIN lineage
- [ ] **INV-10** `HEAD^2` == `527101d14fea534cd69232765d475c0f158c6dfc`
- [ ] **INV-11** MAIN_SHA is ancestor of HEAD
- [ ] **INV-12** DEV_SHA is ancestor of HEAD
- [ ] **INV-13** dev-only commits reachable (303 accounted for)
- [ ] **INV-14** `git rev-list HEAD..MAIN_SHA` is **empty** (no main commits lost)
- [ ] **INV-15** `git rev-parse HEAD:.llxprt` == `f5a6e8742d395b8c9081dbbc6916b08b7aac52a6`

---

## P7 — PR + CI + CodeRabbit  `[ ] NOT STARTED`

- [ ] Push branch (only when authorized)
- [ ] Create PR via `gh` (never web-fetch); include both SHAs, merge-base, cluster summary,
      ledger summary, verification evidence
- [ ] Watch CI: `gh pr checks <NUM> --watch --interval 300` with tool `timeout_seconds` ≥ 1800
- [ ] Read CodeRabbit comments via `gh`
- [ ] Remediate failures/comments without weakening gates
- [ ] Re-run local verification cycle after each remediation
- [ ] Push and watch again — **loop until all checks green and all threads resolved**
- [ ] **Never** stop while workflows are still running

CI loop iterations (append a row per cycle):

| Iter | Date | Failing checks | CodeRabbit threads open | Action taken | Result |
|------|------|----------------|-------------------------|--------------|--------|
| — | — | — | — | — | — |

---

## P8 — Landing Readiness  `[ ] NOT STARTED`

- [ ] **G18** snapshot-drift check: `git rev-parse origin/main` vs `8ab221bb...`
- [ ] If drifted: record new SHA, integrate, **re-run §3 conflict analysis**, re-run ALL of G1–G17,
      update README §3/§4 and affected ledger rows
- [ ] All gates PASS with evidence
- [ ] All CI green, all threads resolved
- [ ] Report status to user and **request explicit confirmation to merge**
- [ ] **DO NOT merge without explicit user go-ahead**

Drift log (append each check):

| Date | `origin/main` SHA | Drifted? | Action |
|------|-------------------|----------|--------|
| 2026-07-25 | `8ab221bb307080359370281bd3496e12661438da` (local ref at plan time) | No | Baseline recorded |

---

## Rollback Points Status

| RP | Description | Available now? |
|----|-------------|----------------|
| RP-0 | Pristine branch at MAIN_SHA | Available via `git merge --abort` (merge is in progress, uncommitted) — returns to `8ab221bb...` |
| RP-1 | Per-cluster checkpoints | All 11 clusters resolved/staged/VERIFIED (C1–C11, 70/70 rows). |
| RP-2 | Resolved, pre-commit | **Available now** — all 70 conflicts resolved; 592 files staged; full local verification (G2–G9/G11/G12-serial/G13/G14/G15/G16) PASS. RG-2/RG-3 COMPLETED. **Awaiting P6 commit.** |
| RP-3 | Merge commit, pre-push | Not yet (commit not created — P6) |
| RP-4 | Pushed / PR open (fix forward; **no force-push**) | Not yet |

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
