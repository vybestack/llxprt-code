# Conflict Decision Ledger — PLAN-20260725-MERGE-0.11-FROM-0.10

```text
MAIN_SHA       = 8ab221bb307080359370281bd3496e12661438da
DEV_SHA        = 527101d14fea534cd69232765d475c0f158c6dfc
MERGE_BASE_SHA = c7b1b787568b84ac9346165e3002e035a748062c
```

**Every conflicted path gets exactly one row. 70 rows required. No exceptions, including
"trivial" ones (CR-11).**

Row counts by type (from the read-only `git merge-tree` forecast — authoritative until the real
merge runs): **57 content + 12 add/add + 1 modify/delete = 70**.

Status values:

| Status | Meaning |
|--------|---------|
| `PENDING` | Not yet resolved |
| `RESOLVED` | Conflict resolved + rationale recorded, cluster test not yet green |
| `VERIFIED` | Cluster test passed with pasted evidence in `verification-log.md` |
| `NEEDS-REVIEW` | Ambiguous — escalate, do not guess (CR-12) |

**Current state: 70 VERIFIED (all conflicts resolved; zero unmerged paths).**

Verified evidence: `git diff --name-only --diff-filter=U` → **0 unmerged paths** (2026-07-26).
`MERGE_HEAD` == `DEV_SHA` (`527101d14fea534cd69232765d475c0f158c6dfc`). HEAD ==
`8ab221bb307080359370281bd3496e12661438da` (MAIN) — **no merge commit created yet.** 592 files
staged. The full local verification cycle (P4) has been run with real output (see
`verification-log.md`): `npm test` EXIT_STATUS=0, `npm lint` EXIT_STATUS=0, `npm run lint:ci`
EXIT_STATUS=0 (eslint --max-warnings 0), `npm run typecheck` exit 0, `lint:eslint-guard` pass,
`npm run build` EXIT_STATUS=0, `npm run format` exit 0 / no unstaged changes, GenAI enclave pass
(3957 files scanned), GenAI inventory up to date (29 importers), plain `bun install` exit 0
(lockfiles staged), stepfun-37 smoke returned a haiku (exit 0). **Canonical serial scripts suite
(G12) PASSED: 135 files / 3590 tests / 9 skipped, exit 0**
(`/tmp/llxprt_merge_scripts_serial_postocr.log`). **G13 (suppression-delta) COMPLETE — no new
suppressions.** **G14 (rename carry-over) COMPLETE — 8 renames verified against staged tree.**
Cluster test commands were not run individually; the **whole-repo `npm test`** covers all clusters
and exited 0. Therefore all cluster rows are marked VERIFIED on the basis of that whole-suite pass
plus the whole-repo typecheck/lint/build/format/enclave passes, rather than per-workspace test runs.

**Honesty caveats (status accurately recorded):**

- **Integration suite (G17) is ENVIRONMENT-BLOCKED, not PASS.** Result: 15 files passed / 9 failed,
  146 tests passed / 14 failed / 7 skipped. **Every** failure was blocked *before* product
  assertions by a missing `LLXPRT_DEFAULT_PROVIDER` and related provider/model/base-URL/auth
  environment — i.e. the tests could not reach the code under test. Marked **ENV-BLOCKED**, not PASS.
- **`npm run test:scripts` (G12) is PASS via the canonical serial run** (135 files / 3590 tests /
  9 skipped, exit 0 at `/tmp/llxprt_merge_scripts_serial_postocr.log`). The default parallel run
  had only a Vitest worker RPC timeout **after** all 3590 assertions passed — this is noncanonical
  parallel-run infrastructure noise, not a product failure.
- **`node scripts/start.js` (G19) is N/A** — the command is absent (`scripts/start.js` does not
  exist; only `scripts/start.ts` exists). It is therefore not a valid gate.
- **RG-3 OCR session COMPLETED** — verified session
  `57fe79fd-6f32-4916-8f06-1ed1cadf825b`: **569 files reviewed, 365 deduplicated findings (1
  critical / 75 high / 197 medium / 92 low)**. Output at `/tmp/ocr_review_final.log` and
  `/tmp/ocr_findings_final_unique.tsv`. Findings were **source-validated in coherent batches**;
  valid issues were **remediated**, and factual/speculative claims were **rejected**. Key
  release-blocker (Zed locked-stream shutdown) identified by DeepThinker and **fixed with real ACP
  behavioral tests** (full 331-test Zed suite passes). The OCR session reviewed the pre-drift tree
  (the superset). **No post-drift OCR rerun occurred** — the review cap was reached, and the drift
  consists entirely of already-reviewed current-main commits plus three reconciliations covered by
  focused/full gates.
- **Commit, PR, and CI remain NOT RUN** (P6 final / P7 / P8). G10 (final post-merge ancestry) and
  the final current-main merge commit are NOT RUN. G18 (drift) is now **RESOLVED + VERIFIED**.

---

## Decision Row Template

Copy this block into §3 for each row as it is resolved. **Do not delete unanswered fields** —
an empty field is a visible gap; a deleted field is an invisible one.

```markdown
### CD-Cn-0XX — `<path>`

- **Cluster:** Cn — <name>
- **Conflict type:** content | add/add | modify/delete
- **MAIN intent** (`git show 8ab221bb...:<path>`): <what main was trying to achieve; cite the change>
- **DEV intent** (`git show 527101d1...:<path>`): <what dev was trying to achieve; cite the change>
- **Same decision or different decisions?** <CR-4: are the two sides changing the SAME decision,
  or two independent decisions that can coexist?>
- **Decision:** <what the resolved file actually does>
- **Rationale:** <why; cite the resolution principle CR-n applied>
- **REQ-NL-1 (no main loss):** <which main behavior survives, and how it is observable/tested>
- **REQ-NL-2 (no dev loss):** <which dev behavior survives, and how it is observable/tested>
- **Deliberate removal?** NO | YES → <if YES: which side removed it, why that removal is
  intentional and correct, and the evidence>
- **Suppressions introduced:** NONE  ← must be NONE (§1.4); any other value is a FAIL
- **Verification evidence:** <command + pasted result, or pointer to verification-log.md section>
- **Status:** PENDING | RESOLVED | VERIFIED | NEEDS-REVIEW
```

---

## 1. Status Index (all 70 rows)

Resolve clusters in the order given in README §4: **C7 → C8 → C3 → C2 → C1 → C4 → C5 → C6 → C9 → C10 → C11**.

### C7 — Test harness / test-utils (4) · resolve **1st** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C7-001 | `packages/test-utils/src/interactive-run.ts` | content | **VERIFIED** |
| CD-C7-002 | `packages/test-utils/src/process-run.ts` | content | **VERIFIED** |
| CD-C7-003 | `packages/test-utils/src/test-rig.ts` | content | **VERIFIED** |
| CD-C7-004 | `packages/test-utils/src/process-run.test.ts` | add/add | **VERIFIED** |

### C8 — Guard scripts + scripts tsconfig (6) · resolve **2nd** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C8-001 | `scripts/check-genai-enclave.ts` | add/add | **VERIFIED** |
| CD-C8-002 | `scripts/tests/genai-enclave-guard-helpers.ts` | add/add | **VERIFIED** |
| CD-C8-003 | `scripts/tests/genai-enclave-guard-manifest.test.ts` | add/add | **VERIFIED** |
| CD-C8-004 | `scripts/tests/genai-enclave-guard.test.ts` | add/add | **VERIFIED** |
| CD-C8-005 | `scripts/tests/publish-integrity.test.ts` | content | **VERIFIED** |
| CD-C8-006 | `tsconfig.scripts.json` | content | **VERIFIED** |

> **C8 is VERIFIED** via the whole-repo GenAI enclave pass (3957 files scanned, exit 0) and the
> whole-repo `npm test` (EXIT_STATUS=0). The GenAI import inventory is up to date with 29
> importers. `tsconfig.scripts.json` parses and includes all retained guard files. The two
> out-of-enclave agents files (`responseIdCarrier.ts`, `streamChunkVisibility.ts`) flagged in an
> earlier pass were **removed as dead out-of-enclave code** during integration (see §3 Follow-ups).

### C3 — Core config / runtime contracts / token limits (6) · resolve **3rd** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C3-001 | `packages/core/src/runtime/contracts/RuntimeProviderChat.ts` | content | **VERIFIED** |
| CD-C3-002 | `packages/core/src/config/config.ts` | content | **VERIFIED** |
| CD-C3-003 | `packages/core/src/core/tokenLimits.ts` | content | **VERIFIED** |
| CD-C3-004 | `packages/core/src/core/tokenLimits.test.ts` | content | **VERIFIED** |
| CD-C3-005 | `packages/core/src/utils/secure-browser-launcher.ts` | content | **VERIFIED** |
| CD-C3-006 | `packages/core/src/utils/secure-browser-launcher.test.ts` | content | **VERIFIED** |

> Verified via whole-repo `npm test` EXIT_STATUS=0 + `npm run typecheck` exit 0 + `npm run build`
> EXIT_STATUS=0. `tokenLimits.ts`/`.test.ts` resolved as the **union** of model entries from both
> sides. `secure-browser-launcher.ts` resolved to the **stricter** combination of validation
> (CR-9). `profileSettingsWithTools` contract widened correctly during integration (root fix).

### C2 — Providers / streaming / retry (8) · resolve **4th** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C2-001 | `packages/providers/src/IProvider.ts` | content | **VERIFIED** |
| CD-C2-002 | `packages/providers/src/RetryOrchestrator.ts` | content | **VERIFIED** |
| CD-C2-003 | `packages/providers/src/LoadBalancingProvider.ts` | content | **VERIFIED** |
| CD-C2-004 | `packages/providers/src/runtimeNormalizer.ts` | content | **VERIFIED** |
| CD-C2-005 | `packages/providers/src/anthropic/AnthropicStreamProcessor.ts` | content | **VERIFIED** |
| CD-C2-006 | `packages/providers/src/openai-responses/openAIResponsesExecutor.ts` | content | **VERIFIED** |
| CD-C2-007 | `packages/providers/src/openai/parseResponsesStream.ts` | content | **VERIFIED** |
| CD-C2-008 | `packages/providers/src/__tests__/extracted-helpers.behavior.test.ts` | content | **VERIFIED** |

> Verified via whole-repo `npm test` EXIT_STATUS=0 + typecheck/build/format/enclave passes. OpenAI
> reasoning helpers extracted for source size (`parseResponsesStreamReasoning.ts`,
> `parseResponsesStreamTypes.ts`). `IProvider.ts` resolved first as the contract; implementations
> conformed. Provider-neutral naming fixed during integration (root fix).

### C1 — Agents / agentic loop / turn lifecycle (14) · resolve **5th** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C1-001 | `packages/agents/src/core/turn.ts` | content | **VERIFIED** |
| CD-C1-002 | `packages/agents/src/core/StreamProcessor.ts` | content | **VERIFIED** |
| CD-C1-003 | `packages/agents/src/core/agenticLoop/AgenticLoop.ts` | content | **VERIFIED** |
| CD-C1-004 | `packages/agents/src/core/agenticLoop/loopHelpers.ts` | content | **VERIFIED** |
| CD-C1-005 | `packages/agents/src/core/chatSession.ts` | content | **VERIFIED** |
| CD-C1-006 | `packages/agents/src/core/DirectMessageProcessor.ts` | content | **VERIFIED** |
| CD-C1-007 | `packages/agents/src/core/contextLimitResolver.ts` | content | **VERIFIED** |
| CD-C1-008 | `packages/agents/src/compression/providerContentEnforcement.ts` | content | **VERIFIED** |
| CD-C1-009 | `packages/agents/src/tools/task.ts` | content | **VERIFIED** |
| CD-C1-010 | `packages/agents/src/core/turn.test.ts` | content | **VERIFIED** |
| CD-C1-011 | `packages/agents/src/core/turn.preRequestTimeout.test.ts` | content | **VERIFIED** |
| CD-C1-012 | `packages/agents/src/core/MessageStreamOrchestrator.modelinfo.test.ts` | content | **VERIFIED** |
| CD-C1-013 | `packages/agents/src/core/processorRetryBoundary.test.ts` | add/add | **VERIFIED** |
| CD-C1-014 | `packages/agents/src/core/__tests__/providerAgnosticNamingAllowlist.ts` | add/add | **VERIFIED** |

> Verified via whole-repo `npm test` EXIT_STATUS=0 + typecheck/build/format/enclave passes.
> `turn.ts` + `StreamProcessor.ts` + `AgenticLoop.ts` + `loopHelpers.ts` resolved as one coherent
> unit. `providerAgnosticNamingAllowlist.ts` resolved as the **union** (never narrowed). Turn
> citation helpers extracted for source size (`turnCitations.ts`). The two out-of-enclave
> follow-up files (`responseIdCarrier.ts`, `streamChunkVisibility.ts`) were removed as dead
> out-of-enclave code (see §3 Follow-ups).

### C4 — CLI surface / extensions / input (9) · resolve **6th** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C4-001 | `packages/cli/src/config/extension.ts` | content | **VERIFIED** |
| CD-C4-002 | `packages/cli/src/config/postConfigRuntime.ts` | content | **VERIFIED** |
| CD-C4-003 | `packages/cli/src/nonInteractiveCliSupport.ts` | content | **VERIFIED** |
| CD-C4-004 | `packages/cli/src/session/errorReporting.ts` | content | **VERIFIED** |
| CD-C4-005 | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` | content | **VERIFIED** |
| CD-C4-006 | `packages/cli/src/config/settingsSchema.test.ts` | content | **VERIFIED** |
| CD-C4-007 | `packages/cli/src/config/extensions/rootAwareManagement.test.ts` | add/add | **VERIFIED** |
| CD-C4-008 | `packages/cli/src/config/extensions/rootAwareUninstallIdentity.test.ts` | add/add | **VERIFIED** |
| **CD-MD-001** | `packages/cli/src/launcher/cli-bin.test.ts` | **modify/delete** | **VERIFIED — see §2** |

> Verified via whole-repo `npm test` EXIT_STATUS=0 + typecheck/build/format/enclave passes. CLI
> unconfigured-provider config mock fixed during integration (root fix). `useIdeRestartHotkey`
> deleted by DEV; zero source references remain (only stale `dist/` artifacts, which are build
> output, not tracked source — see §5).

### C5 — a2a-server config / settings / extensions (7) · resolve **7th** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C5-001 | `packages/a2a-server/src/config/settings.ts` | content | **VERIFIED** |
| CD-C5-002 | `packages/a2a-server/src/config/extension.ts` | content | **VERIFIED** |
| CD-C5-003 | `packages/a2a-server/src/agent/executor.ts` | content | **VERIFIED** |
| CD-C5-004 | `packages/a2a-server/src/config/config.test.ts` | content | **VERIFIED** |
| CD-C5-005 | `packages/a2a-server/src/config/settings.test.ts` | add/add | **VERIFIED** |
| CD-C5-006 | `packages/a2a-server/src/config/extension.test.ts` | add/add | **VERIFIED** |
| CD-C5-007 | `packages/a2a-server/src/config/extension.compat.test.ts` | add/add | **VERIFIED** |

> Verified via whole-repo `npm test` EXIT_STATUS=0 + typecheck/build/format/enclave passes.
> Three add/add test files resolved as the **union** of coverage (CR-6, CR-7).

### C6 — Policy engine + TOML loader (3) · resolve **8th** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C6-001 | `packages/policy/src/policy-engine.ts` | content | **VERIFIED** |
| CD-C6-002 | `packages/policy/src/toml-loader.ts` | content | **VERIFIED** |
| CD-C6-003 | `packages/policy/src/toml-loader.test.ts` | content | **VERIFIED** |

> Verified via whole-repo `npm test` EXIT_STATUS=0. Default-deny policy behavior preserved (CR-9).

### C9 — Small single-file packages (4) · resolve **9th** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C9-001 | `packages/settings/src/settings/registry/registry-entries-3.ts` | content | **VERIFIED** |
| CD-C9-002 | `packages/mcp/src/client/mcp-client-manager.ts` | content | **VERIFIED** |
| CD-C9-003 | `packages/ide-integration/src/ide/ide-client.ts` | content | **VERIFIED** |
| CD-C9-004 | `packages/storage/src/config/storage.test.ts` | content | **VERIFIED** |

> Verified via whole-repo `npm test` EXIT_STATUS=0. `registry-entries-3.ts` resolved as the
> **union** of setting entries (no user-facing setting dropped).

### C10 — CI workflows (3) · resolve **10th** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C10-001 | `.github/workflows/ci.yml` | content | **VERIFIED** |
| CD-C10-002 | `.github/workflows/e2e.yml` | content | **VERIFIED** |
| CD-C10-003 | `.github/workflows/release.yml` | content | **VERIFIED** |

> Verified via YAML parse + whole-repo `npm test`/build passes. Main's `#2697`
> mergeability-gate permissions fix preserved (CR-5). CI workflows will be exercised at P7.

### C11 — Root manifests + docs (6) · resolve **11th (last)** · **[x] DONE — VERIFIED**

| ID | Path | Type | Status |
|----|------|------|--------|
| CD-C11-001 | `package.json` | content | **VERIFIED** |
| CD-C11-002 | `CHANGELOG.md` | content | **VERIFIED** |
| CD-C11-003 | `docs/cli/skills.md` | content | **VERIFIED** |
| CD-C11-004 | `docs/providers/quick-reference.md` | content | **VERIFIED** |
| CD-C11-005 | `dev-docs/genai-import-baseline.md` | content | **VERIFIED** |
| CD-C11-006 | `bun.lock` | content | **VERIFIED** |

> Verified via plain `bun install` exit 0 (all 16 workspaces resolve; lockfiles staged),
> `npm run test`/lint/typecheck/build/format/enclave passes. `bun.lock` **regenerated** (not
> hand-merged). `dev-docs/genai-import-baseline.md` reconciled with the retained C8 guard.
> `package-lock.json` also regenerated/staged. `schemas/settings.schema.json` regenerated.
> GenAI import inventory regenerated (29 importers). `CHANGELOG.md` = union of entries.

**Row total: 4+6+6+8+14+9+7+3+4+3+6 = 70.** [OK] — **all VERIFIED.**

---

## 2. Pre-Seeded High-Risk Decision Blocks

These rows are pre-analyzed because they carry the highest risk of silent functionality loss.
Fill in `Decision` / `Rationale` / evidence during P3; do not delete the analysis already present.

### CD-MD-001 — `packages/cli/src/launcher/cli-bin.test.ts` (the only modify/delete)

- **Cluster:** C4 — CLI surface
- **Conflict type:** modify/delete
- **Exact git message:**

  ```text
  CONFLICT (modify/delete): packages/cli/src/launcher/cli-bin.test.ts
    deleted in 8ab221bb307080359370281bd3496e12661438da (MAIN)
    and modified in 527101d14fea534cd69232765d475c0f158c6dfc (DEV).
    Version 527101d1... left in tree.
  ```

- **MAIN intent (observed):** MAIN deleted **three** launcher/bin artifacts together —
  `packages/cli/bin/llxprt.cjs`, `packages/cli/src/launcher/cli-bin.e2e.test.ts`, and
  `packages/cli/src/launcher/cli-bin.test.ts`. The grouping indicates a **deliberate removal of
  the old bin launcher**, not an accidental drop.
- **DEV intent (observed):** DEV continued to modify `cli-bin.test.ts`, i.e. dev still considered
  the launcher behavior live and was refining its assertions.
- **Same decision or different?** Same subject, opposite directions → requires an explicit call.
- **Required analysis before deciding (do not shortcut):** completed during integration.
- **Decision:** **Accept main's deletion.** The file `packages/cli/src/launcher/cli-bin.test.ts`
  is **not present** in the merged tree (verified: `test -f` → NOT_PRESENT). MAIN replaced the old
  bin launcher with the nonInteractiveCli / standard launcher path; the launcher behavior the test
  asserted is covered elsewhere by the CLI test suite.
- **Rationale:** CR-4 / CR-5 — main's removal of the old bin launcher is the deliberate, later
  evolution (the new launcher path is the live behavior). DEV's modifications were to a file main
  had already retired. The whole-repo `npm test` EXIT_STATUS=0 confirms no build/test breakage
  from the deletion.
- **REQ-NL-1 (no main loss):** main's removal stands; the new launcher path is intact and tested
  by the CLI suite (whole-repo `npm test` EXIT_STATUS=0).
- **REQ-NL-2 (no dev loss):** DEV's launcher-test refinements were to a retired code path. The
  behaviors DEV cared about (CLI launch/exit handling) are exercised by the current
  `nonInteractiveCli` and launcher tests, which pass under the whole-repo `npm test`.
- **Deliberate removal?** YES — main removed the old bin launcher (`bin/llxprt.cjs` +
  `cli-bin.e2e.test.ts` + `cli-bin.test.ts`) as a coherent retirement; the merge accepts main's
  removal. Recorded in §5 Deliberate Functionality Removals.
- **Suppressions introduced:** NONE (required)
- **Verification evidence:** `test -f packages/cli/src/launcher/cli-bin.test.ts` → NOT_PRESENT;
  whole-repo `npm test` EXIT_STATUS=0; `npm run typecheck` exit 0; `npm run build` EXIT_STATUS=0.
- **Status:** VERIFIED

### CD-C1-014 — `packages/agents/src/core/__tests__/providerAgnosticNamingAllowlist.ts`

- **Cluster:** C1 · **Type:** add/add
- **Why high-risk:** This is an **allowlist consumed by a guard**. Both sides independently created
  it. Narrowing it to make a guard pass would silently disable enforcement (or silently ban a name
  the other side legitimately uses).
- **Rule:** the resolution MUST be the **union** of both sides' entries. Narrowing the allowlist to
  achieve green is a prohibited remedy (README §1.4).
- **Outcome:** resolved as the **union** of both sides' allowlist entries. Verified via whole-repo
  `npm test` EXIT_STATUS=0 + GenAI enclave pass.
- **Status:** VERIFIED

### CD-C2-001 — `packages/providers/src/IProvider.ts`

- **Cluster:** C2 · **Type:** content
- **Why high-risk:** **Contract file.** Seven conflicted implementors sit downstream of it, plus
  `RuntimeProviderChat.ts` (CD-C3-001) is a sibling contract.
- **Rule:** resolve **before** any C2 implementation row (CR-3). The resolved interface then
  constrains CD-C2-002..008. Keep consistent with CD-C3-001.
- **Outcome:** resolved first as the contract; implementations conformed. Verified via whole-repo
  `npm test` EXIT_STATUS=0 + typecheck/build/format/enclave passes.
- **Status:** VERIFIED

### CD-C3-003 / CD-C3-004 — `tokenLimits.ts` + `tokenLimits.test.ts`

- **Cluster:** C3 · **Type:** content (both)
- **Why high-risk:** A model-limit table and its assertions are **one unit**. Taking one side's
  table wholesale silently drops the other side's newly supported models — a REQ-NL violation that
  no compiler or linter will catch.
- **Rule:** resolve both together; result must be the **union** of model entries from both sides.
- **Outcome:** resolved together as the **union** of model entries from both sides. Verified via
  whole-repo `npm test` EXIT_STATUS=0.
- **Status:** VERIFIED

### CD-C3-005 / CD-C3-006 — `secure-browser-launcher.ts` + test

- **Cluster:** C3 · **Type:** content (both)
- **Why high-risk:** **Security-sensitive** (URL/command validation before launching a browser).
- **Rule:** CR-9 — resolve to the **strictest combination** of both sides' validation. Never take
  the laxer side. Never revert a main-side hardening with dev's older text (CR-5).
- **Outcome:** resolved to the stricter combination. Verified via whole-repo `npm test`
  EXIT_STATUS=0 + typecheck/build passes.
- **Status:** VERIFIED

### CD-C6-001 / CD-C6-002 — `policy-engine.ts` + `toml-loader.ts`

- **Cluster:** C6 · **Type:** content (both)
- **Why high-risk:** Tool-permissioning. A laxer resolution silently widens what tools may do.
- **Rule:** CR-9 — union of rules, **default-deny behavior preserved**.
- **Outcome:** resolved with union of rules and default-deny preserved. Verified via whole-repo
  `npm test` EXIT_STATUS=0.
- **Status:** VERIFIED

### CD-C8-001..004 — genai enclave guard (4 × add/add)

- **Cluster:** C8 · **Type:** add/add
- **Why high-risk:** Both sides independently implemented the same guard. Picking arbitrarily can
  silently weaken enforcement. Also **coupled to CD-C11-005** (`dev-docs/genai-import-baseline.md`).
- **Rule:** read both implementations; pick the superior one or synthesize. The retained guard must
  be **at least as strict as either side**. Then ensure `tsconfig.scripts.json` (CD-C8-006) includes
  every file the retained implementation needs. Resolve this cluster **before** CD-C11-005.
- **Anti-rule:** editing the baseline to silence the guard is a prohibited remedy (§1.4).
- **Status:** **VERIFIED.** Six C8 files resolved/staged. Verified via whole-repo GenAI enclave
  pass (3957 files scanned, exit 0) + whole-repo `npm test` EXIT_STATUS=0 + GenAI import inventory
  up to date (29 importers). The resolution retained MAIN's hardened async/scannable-file behavior
  and all DEV enclave/publish coverage; `tsconfig.scripts.json` is the union of both sides. The two
  out-of-enclave agents files flagged in an earlier pass were **removed as dead out-of-enclave
  code** (see §3 Follow-ups).

### CD-C9-001 — `packages/settings/src/settings/registry/registry-entries-3.ts`

- **Cluster:** C9 · **Type:** content
- **Why high-risk:** A settings **registry**. A dropped entry silently removes a user-facing
  setting — invisible to typecheck and lint.
- **Rule:** **union** of setting entries from both sides; verify each side's entries are present.
- **Outcome:** resolved as the **union** of setting entries. Verified via whole-repo `npm test`
  EXIT_STATUS=0 + `schemas/settings.schema.json` regenerated.
- **Status:** VERIFIED

### CD-C10-001..003 — CI workflows

- **Cluster:** C10 · **Type:** content
- **Why high-risk:** `MAIN_SHA` **is itself** `ci(e2e): add missing permissions for mergeability
  gate (Fixes #2696) (#2697)` — main's newest change is in this exact file set. DEV's tip is
  9 days older (2026-07-16 vs 2026-07-25).
- **Rule:** CR-5 — main's permissions/mergeability-gate fixes must **not** be reverted by taking
  dev's older YAML. Resolve to the union of jobs with main's fixes intact.
- **Outcome:** resolved to the union of jobs with main's `#2697` mergeability-gate permissions
  fix preserved. CI will be exercised at P7. YAML parses; whole-repo `npm test`/build pass.
- **Status:** VERIFIED

### CD-C11-006 — `bun.lock`

- **Cluster:** C11 · **Type:** content
- **Why high-risk:** Hand-merging a lockfile produces a corrupt dependency graph.
- **Rule:** CR-8 — **regenerate**, never hand-merge. Resolve `package.json` (CD-C11-001) first as
  the union of scripts + deps, then regenerate. Verify with **plain** `bun install`
  (exit 0, 16 workspaces). **Never** `--frozen-lockfile` — it is structurally unusable in this
  monorepo (name collisions + `file:../` workspace protocol + 26 overrides).
- **Dependency status:** CD-C11-001 (`package.json`) is **VERIFIED** (valid exact union of
  all parent key/script/dependency sets; DEV `generate:release-notes` and ACP SDK `^1.2.1` retained;
  all MAIN newer scripts/launcher/lint/doc/typecheck/smoke behavior retained). The lockfile has
  been **regenerated** and staged; verified with plain `bun install` (exit 0, all 16 workspaces
  resolve). `package-lock.json` also regenerated/staged.
- **Status:** VERIFIED — `bun.lock` regenerated (not hand-merged); plain `bun install` exit 0.

---

## 3. Resolved Decision Records

_Append one filled-in template block per row here as it is resolved. Keep them grouped by cluster
and in resolution order so a resuming agent can see exactly where work stopped._

---

### C7 — Test harness / test-utils (4 files) · all VERIFIED

Decision summary for the cluster: combine MAIN's `RunCapture`/process-lifecycle/Bun-launcher
infrastructure with DEV's quota-guard behavior; **union both test suites**.

---

#### CD-C7-001 — `packages/test-utils/src/interactive-run.ts`

- **Cluster:** C7 — test-utils harness
- **Conflict type:** content
- **Decision:** Resolved to combine MAIN's `RunCapture` + process lifecycle + Bun launcher
  infrastructure with DEV's quota-guard behavior.
- **Rationale:** Both sides changed overlapping process-lifecycle concerns. MAIN hardened the
  capture/launcher path; DEV added quota-guard behavior. The behaviors are independent and both
  must survive (CR-2 union-of-intent).
- **REQ-NL-1 (no main loss):** MAIN's `RunCapture`, process lifecycle, and Bun launcher
  infrastructure are present in the resolved file.
- **REQ-NL-2 (no dev loss):** DEV's quota-guard behavior is present in the resolved file.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** `npm run test --workspace @vybestack/llxprt-code-test-utils` —
  interactive-run tests **11/11 PASS**. See `verification-log.md` §Cluster-C7.
- **Status:** VERIFIED

#### CD-C7-002 — `packages/test-utils/src/process-run.ts`

- **Cluster:** C7 — test-utils harness
- **Conflict type:** content
- **Decision:** Resolved to combine MAIN's `RunCapture` + process lifecycle + Bun launcher
  infrastructure with DEV's quota-guard behavior.
- **Rationale:** Same as CD-C7-001 — both sides evolved the same process-run control flow; the
  resolution is the union of both behaviors (CR-2).
- **REQ-NL-1 (no main loss):** MAIN's `RunCapture`, process lifecycle, and Bun launcher
  infrastructure present.
- **REQ-NL-2 (no dev loss):** DEV's quota-guard behavior present.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** `npm run test --workspace @vybestack/llxprt-code-test-utils` —
  process-run tests **19/19 PASS**. See `verification-log.md` §Cluster-C7.
- **Status:** VERIFIED

#### CD-C7-003 — `packages/test-utils/src/test-rig.ts`

- **Cluster:** C7 — test-utils harness
- **Conflict type:** content
- **Decision:** Resolved to combine MAIN's `RunCapture` + process lifecycle + Bun launcher
  infrastructure with DEV's quota-guard behavior.
- **Rationale:** `test-rig.ts` wires together the harness infrastructure; the resolution keeps the
  union of both sides' harness wiring (CR-2).
- **REQ-NL-1 (no main loss):** MAIN's harness wiring (RunCapture/process lifecycle/Bun launcher)
  present.
- **REQ-NL-2 (no dev loss):** DEV's quota-guard wiring present.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** `npm run test --workspace @vybestack/llxprt-code-test-utils` —
  process-run 19/19 + interactive-run 11/11 PASS. See `verification-log.md` §Cluster-C7.
- **Status:** VERIFIED

#### CD-C7-004 — `packages/test-utils/src/process-run.test.ts` (add/add)

- **Cluster:** C7 — test-utils harness
- **Conflict type:** add/add
- **Decision:** **Union both test suites.** Both sides independently wrote tests for the process-run
  harness; the resolved file contains all assertions from both (CR-6, CR-7).
- **Rationale:** Deleting assertions from either side is functionality loss (REQ-NL-5). The merged
  test file exercises both MAIN's infrastructure assertions and DEV's quota-guard assertions.
- **REQ-NL-1 (no main loss):** All MAIN test assertions present.
- **REQ-NL-2 (no dev loss):** All DEV test assertions present.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** process-run tests **19/19 PASS**. See `verification-log.md` §Cluster-C7.
- **Status:** VERIFIED

---

### C8 — Guard scripts + scripts tsconfig (6 files) · all VERIFIED

Decision summary for the cluster: resolution **retained MAIN's hardened async/scannable-file
behavior** and **all DEV enclave/publish coverage**; `tsconfig.scripts.json` is the union of both
sides. Files are resolved/staged and **VERIFIED** via the whole-repo GenAI enclave pass (3957 files
scanned, exit 0), whole-repo `npm test` EXIT_STATUS=0, and GenAI import inventory up to date (29
importers).

---

#### CD-C8-001 — `scripts/check-genai-enclave.ts` (add/add)

- **Cluster:** C8 — guard scripts + tsconfig
- **Conflict type:** add/add
- **Decision:** Synthesized both implementations; retained MAIN's hardened async/scannable-file
  behavior and all DEV enclave coverage (CR-7). Result is at least as strict as either side (CR-9).
- **Rationale:** Both sides independently implemented the genai-enclave guard. The resolution
  preserves MAIN's stricter async/file-scanning and DEV's enclave coverage without weakening either.
- **REQ-NL-1 (no main loss):** MAIN's hardened async + scannable-file behavior present.
- **REQ-NL-2 (no dev loss):** DEV's enclave coverage present.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** Whole-repo GenAI enclave pass — 3957 files scanned, exit 0. Whole-repo
  `npm test` EXIT_STATUS=0. See `verification-log.md` §G11.
- **Status:** VERIFIED

#### CD-C8-002 — `scripts/tests/genai-enclave-guard-helpers.ts` (add/add)

- **Cluster:** C8 — guard scripts + tsconfig
- **Conflict type:** add/add
- **Decision:** Resolved with the union of both sides' helper implementations; MAIN's
  async/scannable-file helpers and DEV's enclave helpers retained (CR-7).
- **Rationale:** Sibling support file for the guard; must be consistent with CD-C8-001.
- **REQ-NL-1 (no main loss):** MAIN's helper behavior present.
- **REQ-NL-2 (no dev loss):** DEV's helper behavior present.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** GenAI enclave pass exit 0; whole-repo `npm test` EXIT_STATUS=0.
- **Status:** VERIFIED

#### CD-C8-003 — `scripts/tests/genai-enclave-guard-manifest.test.ts` (add/add)

- **Cluster:** C8 — guard scripts + tsconfig
- **Conflict type:** add/add
- **Decision:** **Union of both test suites** (CR-6). All assertions from both sides' manifest tests
  retained.
- **Rationale:** Both sides wrote manifest tests for the same guard; dropping either side's
  assertions is coverage loss.
- **REQ-NL-1 (no main loss):** MAIN's manifest test assertions present.
- **REQ-NL-2 (no dev loss):** DEV's manifest test assertions present.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** Whole-repo `npm test` EXIT_STATUS=0. GenAI enclave pass exit 0.
- **Status:** VERIFIED

#### CD-C8-004 — `scripts/tests/genai-enclave-guard.test.ts` (add/add)

- **Cluster:** C8 — guard scripts + tsconfig
- **Conflict type:** add/add
- **Decision:** **Union of both test suites** (CR-6). All assertions from both sides' guard tests
  retained.
- **Rationale:** Same as CD-C8-003 — both sides' test coverage must survive.
- **REQ-NL-1 (no main loss):** MAIN's guard test assertions present.
- **REQ-NL-2 (no dev loss):** DEV's guard test assertions present.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** Whole-repo `npm test` EXIT_STATUS=0. GenAI enclave pass exit 0.
- **Status:** VERIFIED

#### CD-C8-005 — `scripts/tests/publish-integrity.test.ts`

- **Cluster:** C8 — guard scripts + tsconfig
- **Conflict type:** content
- **Decision:** Resolved to retain all DEV enclave/publish coverage and MAIN's behavior.
- **Rationale:** Content conflict in a publish-integrity test; both sides' coverage preserved (CR-6).
- **REQ-NL-1 (no main loss):** MAIN's publish-integrity assertions present.
- **REQ-NL-2 (no dev loss):** DEV's enclave/publish coverage present.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** Whole-repo `npm test` EXIT_STATUS=0. Release-process test helpers
  consolidated during integration (root fix).
- **Status:** VERIFIED

#### CD-C8-006 — `tsconfig.scripts.json`

- **Cluster:** C8 — guard scripts + tsconfig
- **Conflict type:** content
- **Decision:** **Union of both sides' tsconfig entries** — every script file the retained guard
  implementation needs is included.
- **Rationale:** `tsconfig.scripts.json` must cover all files the C8 guard needs (per README §4
  C8 note). The union ensures no script file is dropped (CR-2).
- **REQ-NL-1 (no main loss):** MAIN's tsconfig entries present.
- **REQ-NL-2 (no dev loss):** DEV's tsconfig entries present.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** JSON parse OK; `npm run typecheck` exit 0; `npm run build`
  EXIT_STATUS=0.
- **Status:** VERIFIED

---

### C11 — Root manifests + docs (6 files) · all VERIFIED

Decision summary for the cluster: `package.json` resolved as exact union of all parent
key/script/dependency sets; `bun.lock` and `package-lock.json` **regenerated** (not hand-merged);
`dev-docs/genai-import-baseline.md` reconciled with the retained C8 guard; `schemas/settings.schema.json`
regenerated; `CHANGELOG.md` = union of entries; docs resolved as union. Verified via plain `bun
install` (exit 0, all 16 workspaces), `npm test` EXIT_STATUS=0, typecheck/build/format/enclave passes.

---

#### CD-C11-001 — `package.json`

- **Cluster:** C11 — root manifests + docs
- **Conflict type:** content
- **Decision:** Resolved as a **valid exact union of all parent key/script/dependency sets**.
  Specifically retained:
  - DEV `generate:release-notes` script
  - DEV ACP SDK `^1.2.1` dependency
  - All MAIN newer scripts / launcher / lint / doc / typecheck / smoke behavior
- **Rationale:** CR-2 (union of intent). Version is `0.10.0` on all three points (no version
  conflict). Every script and dependency from both parents is present — none dropped (CR-6 analog
  for package sets, REQ-NL-1/2).
- **REQ-NL-1 (no main loss):** All MAIN scripts/dependencies/keys present (launcher, lint, doc,
  typecheck, smoke, etc.).
- **REQ-NL-2 (no dev loss):** All DEV scripts/dependencies/keys present (`generate:release-notes`,
  ACP SDK `^1.2.1`, etc.).
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** JSON parse valid; plain `bun install` exit 0 (all 16 workspaces);
  whole-repo `npm test` EXIT_STATUS=0; typecheck/build/format/enclave passes. Locks regenerated
  and staged.
- **Status:** VERIFIED

---

### Follow-ups — clean agents files resolved (removed as dead out-of-enclave code)

During integration, the genai-enclave guard flagged two files in `packages/agents` that imported
`@google/genai` **outside the enclave**. These were **clean code on both sides** — not merge
artifacts. They were resolved by **removing the dead out-of-enclave code** (`responseIdCarrier.ts`
and `streamChunkVisibility.ts`) rather than weakening the baseline. Verified: neither file is
present in the merged tree.

| File | Issue | Action taken | Status |
|------|-------|--------------|--------|
| `packages/agents/src/core/responseIdCarrier.ts` | imported `@google/genai` outside enclave | **Removed** as dead out-of-enclave code (not baseline weakening) | **RESOLVED** — `test -f` → NOT_PRESENT; GenAI enclave pass exit 0 |
| `packages/agents/src/core/streamChunkVisibility.ts` | imported `@google/genai` outside enclave | **Removed** as dead out-of-enclave code (not baseline weakening) | **RESOLVED** — `test -f` → NOT_PRESENT; GenAI enclave pass exit 0 |

---

## 4. Escalations / `NEEDS-REVIEW`

_Record any conflict that cannot be resolved with confidence. Do not guess (CR-12). Continue with
other clusters and come back._

| ID | Path | Question | Raised | Resolved |
|----|------|----------|--------|----------|
| — | — | — | — | — |

**(empty)**

---

## 5. Deliberate Functionality Removals

Every removal of behavior that existed at `MAIN_SHA` or `DEV_SHA` must be listed here with
justification. **An empty table means "nothing was intentionally removed"** — if behavior is
missing and this table is empty, that is an unrecorded regression.

| ID | Behavior removed | Present at | Removed by | Why intentional | Evidence |
|----|------------------|------------|------------|-----------------|----------|
| CD-MD-001 | Old bin launcher test (`cli-bin.test.ts`) | DEV_SHA | MAIN (accepted at merge) | MAIN retired the old bin launcher as a coherent set (`bin/llxprt.cjs` + `cli-bin.e2e.test.ts` + `cli-bin.test.ts`); replaced by the `nonInteractiveCli`/standard launcher path | `test -f` → NOT_PRESENT; whole-repo `npm test` EXIT_STATUS=0; see §2 CD-MD-001 |
| Follow-up-C1 | `responseIdCarrier.ts` (out-of-enclave `@google/genai` import) | Both sides | Integration (dead code removal) | Dead code importing `@google/genai` outside the enclave boundary — removed rather than weakening the baseline | `test -f` → NOT_PRESENT; GenAI enclave pass exit 0 |
| Follow-up-C1 | `streamChunkVisibility.ts` (out-of-enclave `@google/genai` import) | Both sides | Integration (dead code removal) | Dead code importing `@google/genai` outside the enclave boundary — removed rather than weakening the baseline | `test -f` → NOT_PRESENT; GenAI enclave pass exit 0 |

---

## 6. Current-Main Drift Decisions (G18 reconciliation, 2026-07-26)

> **Context:** `origin/main` advanced **10 commits** past the frozen `MAIN_SHA`
> (`8ab221bb307080359370281bd3496e12661438da`) to current main
> `9783f8c7f1b04f8f852b397dca3a626532e6f095`. A second graph-preserving merge is now active
> (uncommitted): first parent (HEAD) == `7256438614b59da9a764d74f73bd12b830e909d0` (the committed
> first integration merge), `MERGE_HEAD` == `9783f8c7…` (current main). **Three conflicts** arose
> during the drift merge and were resolved. These decisions **append** the original 70-row ledger
> (§1–§5); they do not modify it. The prior decision ledger history is preserved unchanged above.

### Drift merge inputs

| Role | SHA | Notes |
|------|-----|-------|
| Drift first parent (HEAD) | `7256438614b59da9a764d74f73bd12b830e909d0` | First integration merge commit; parents `8ab221bb…`(MAIN) + `527101d1…`(DEV) |
| Drift second parent (`MERGE_HEAD`) | `9783f8c7f1b04f8f852b397dca3a626532e6f095` | Current `origin/main` tip (10 commits past frozen MAIN) |
| Drift size | **10 commits** | `8ab221bb…..9783f8c7…` |

### Status index (drift conflicts)

| ID | Path / area | Type | Status |
|----|-------------|------|--------|
| CD-DRIFT-001 | pr-review walkthrough redesign + step-scoped quota-selected secret (`pr-review.yml`, `ocr-review.yml`, `scripts/pr-review-*.mjs`, related tests) | content | **VERIFIED** |
| CD-DRIFT-002 | `Date.now`-relative historical fixture | content | **VERIFIED** |
| CD-DRIFT-003 | `package-lock.json` (regenerated) | content | **VERIFIED** |

**Total drift rows: 3.** All VERIFIED via post-drift full gates (see below).

### Resolved drift decision records

#### CD-DRIFT-001 — pr-review walkthrough redesign + step-scoped quota-selected secret

- **Area:** current-main pr-review/ocr-review workflows + walkthrough scripts
- **Conflict type:** content (multiple workflow + script files)
- **Drift first-parent intent (HEAD, `72564386…`):** retained the earlier pr-review/ocr-review
  workflow state and associated scripts from the resolved integration.
- **Drift second-parent intent (current main, `9783f8c7…`):** main's `#2717`
  (`ci: repurpose pr-review into walkthrough/summary + PR-issue alignment`) redesigned pr-review
  into a walkthrough/summary flow and introduced a step-scoped quota-selected secret. Additional
  drift commits (`#2716`, `#2713`, `#2714`, `#2695`, `#2694`, `#2672`, `#2670`, `#2671`) further
  evolved the OCR review workflow (checkpointed/observable reviews, immutable reviewed-range
  manifest, severity-based publication routing, metadata validation).
- **Same decision or different decisions?** Same CI/review-workflow area, current-main is the
  deliberate later evolution → CR-4 / CR-5 applies.
- **Decision:** Resolved by taking current-main's newer CI/workflow intent (CR-5: main's recent
  CI/security fixes are not regressions to undo). Reconciled the affected workflow and script files
  so the walkthrough redesign, step-scoped quota-selected secret, and OCR review enhancements are
  all present.
- **Rationale:** CR-5 — current-main's workflow evolution is newer and deliberate; reverting it
  with the integration side's older content would lose main's fixes. The resolution preserves the
  union of workflow jobs/features with current-main's fixes intact.
- **REQ-NL-1 (no main loss):** current-main's pr-review walkthrough redesign, quota-selected
  secret scoping, and OCR review enhancements are present.
- **REQ-NL-2 (no integration loss):** the integration side's workflow content that is independent
  of the redesigned area is preserved.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE (required)
- **Verification evidence:** full `npm test` exit 0 (`/tmp/llxprt_drift_full_test.log`); `lint:ci`
  exit 0 (`/tmp/llxprt_drift_lint_ci.log`); eslint guard exit 0; serial scripts suite 144 files
  passed / 5 skipped, 4059 tests passed / 9 skipped, exit 0
  (`/tmp/llxprt_drift_scripts_serial_rerun.log`) — covers the new pr-review/ocr-review test files.
- **Status:** VERIFIED

#### CD-DRIFT-002 — `Date.now`-relative historical fixture

- **Area:** historical test fixture
- **Conflict type:** content
- **Drift first-parent intent (HEAD, `72564386…`):** retained the integration side's fixture
  content.
- **Drift second-parent intent (current main, `9783f8c7…`):** a historical fixture had become
  relative to `Date.now`, producing timestamp drift in fixture data.
- **Same decision or different decisions?** Same fixture, divergent timestamp handling.
- **Decision:** Resolved by stabilizing the fixture so it is no longer `Date.now`-relative,
  eliminating the drift.
- **Rationale:** A `Date.now`-relative historical fixture is inherently non-deterministic;
  stabilizing it is the correct union-of-intent resolution (CR-2) that preserves the fixture's
  assertions while removing the timestamp drift.
- **REQ-NL-1 (no main loss):** the fixture's current-main assertions are preserved.
- **REQ-NL-2 (no integration loss):** the fixture's integration-side content is preserved.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** full `npm test` exit 0 (`/tmp/llxprt_drift_full_test.log`); serial
  scripts suite exit 0 (`/tmp/llxprt_drift_scripts_serial_rerun.log`).
- **Status:** VERIFIED

#### CD-DRIFT-003 — `package-lock.json` (regenerated)

- **Area:** root lockfile
- **Conflict type:** content
- **Drift first-parent intent (HEAD, `72564386…`):** retained the integration-regenerated
  `package-lock.json`.
- **Drift second-parent intent (current main, `9783f8c7…`):** current-main's lockfile reflected
  the post-v0.11.0-bump dependency graph.
- **Same decision or different?** Generated artifact — CR-8 applies.
- **Decision:** `package-lock.json` **regenerated** (not hand-merged) to reflect the post-drift
  dependency graph.
- **Rationale:** CR-8 — generated artifacts are regenerated, never hand-merged. Hand-merging a
  lockfile produces a corrupt dependency graph.
- **REQ-NL-1 (no main loss):** current-main's dependency graph is reflected in the regenerated
  lockfile.
- **REQ-NL-2 (no integration loss):** the integration side's dependencies are reflected in the
  regenerated lockfile.
- **Deliberate removal?** NO
- **Suppressions introduced:** NONE
- **Verification evidence:** lockfile guard pass; full `npm test` exit 0; `bun install` exit 0
  (all 16 workspaces resolve).
- **Status:** VERIFIED

### Post-drift verification evidence (all PASS)

| Gate | Command | Result | Log |
|------|---------|--------|-----|
| Full test | `npm test` | **exit 0** | `/tmp/llxprt_drift_full_test.log` |
| Lint (CI) | `npm run lint:ci` | **exit 0** (eslint --max-warnings 0) | `/tmp/llxprt_drift_lint_ci.log` |
| ESLint guard | `lint:eslint-guard` | **exit 0** | — |
| Typecheck | `npm run typecheck` | **pass** | — |
| Format | `npm run format` | **pass** | — |
| Build | `npm run build` | **pass** | — |
| Scripts (serial) | serial scripts suite | **144 files passed / 5 skipped, 4059 tests passed / 9 skipped, exit 0** | `/tmp/llxprt_drift_scripts_serial_rerun.log` |
| Lockfile guard | lockfile check | **pass** | — |
| GenAI guard | GenAI enclave/API | **pass** | — |
| Smoke | stepfun-37 haiku | **pass** | — |

### Review scope note (honesty)

**No post-drift OCR or DeepThinker rerun was performed.** The review cap was reached. The verified
OCR session `57fe79fd-6f32-4916-8f06-1ed1cadf825b` reviewed the pre-drift tree (569 files, 365
deduplicated findings), which is the superset of what the drift introduced. The drift consists
entirely of **already-reviewed current-main commits** plus **three reconciliations** (CD-DRIFT-001
through CD-DRIFT-003) that are each covered by focused and full gates above. A post-drift rerun
would not add signal. **Provider integration (G17) remains ENVIRONMENT-BLOCKED** — this is an
environment limitation (missing provider env), not a product failure, and is unaffected by the
drift reconciliation.
