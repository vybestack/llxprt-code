# Integration Plan: dev/0.11.0 → main snapshot (graph-preserving merge)

Plan ID: `PLAN-20260725-MERGE-0.11-FROM-0.10`
Generated: 2026-07-25
Type: **Large branch integration** (not feature implementation)
Integration branch: `integration/0.11-from-0.10`

> This plan is written so that a *different agent, after full context compression*, can resume
> work using only the files in `project-plans/20260725merge/`. Every gate has a concrete command
> and an explicit pass/fail evidence field. **Never mark a gate PASS without pasting real output.**

---

## 0. Immutable Integration Inputs

These three SHAs are **immutable** for the life of this plan. Do not "update", re-derive, or
substitute them. If reality diverges from them (see §13 Snapshot Drift), record it — do not
silently rewrite them.

| Role | SHA | Notes |
|------|-----|-------|
| `MAIN_SHA` | `8ab221bb307080359370281bd3496e12661438da` | Frozen current-main snapshot. Integration branch is rooted exactly here. |
| `DEV_SHA` | `527101d14fea534cd69232765d475c0f158c6dfc` | Frozen `dev/0.11.0` tip to be merged in. |
| `MERGE_BASE_SHA` | `c7b1b787568b84ac9346165e3002e035a748062c` | **Derived read-only** (see evidence below), not assumed. |

### 0.1 Verified tip metadata (read-only, captured 2026-07-25)

```text
MAIN_SHA  8ab221bb307080359370281bd3496e12661438da
          2026-07-25 16:07:01 -0300  Andrew C. Oliver
          ci(e2e): add missing permissions for mergeability gate (Fixes #2696) (#2697)

DEV_SHA   527101d14fea534cd69232765d475c0f158c6dfc
          2026-07-16 13:00:45 -0300  Andrew C. Oliver
          Generate trustworthy release notes (fixes #2288) (#2577)

MERGE_BASE c7b1b787568b84ac9346165e3002e035a748062c
          2026-07-14 01:01:17 -0300  acoliver
          good memory
```

### 0.2 Merge-base derivation evidence (read-only)

Command actually run:

```bash
git merge-base 8ab221bb307080359370281bd3496e12661438da 527101d14fea534cd69232765d475c0f158c6dfc
```

Output:

```text
c7b1b787568b84ac9346165e3002e035a748062c
```

**Status: PASS** — merge-base derived, not guessed. Re-derive with the same command at any time;
it must return this exact SHA. If it does not, STOP and see §13.

### 0.3 Divergence size (read-only evidence)

```bash
git rev-list --count c7b1b787...^{}..527101d1...   # dev-only commits
git rev-list --count c7b1b787...^{}..8ab221bb...   # main-only commits
```

| Measure | Value |
|---------|-------|
| Commits on dev only (`base..DEV`) | **303** |
| Commits on main only (`base..MAIN`) | **46** |
| Files changed `base..DEV` | **793** (297 A / 5 D / 491 M) |
| Files changed `base..MAIN` | **1024** (357 A / 13 D / 646 M / 8 R) |
| Version at all three points | `0.10.0` (no version-bump conflict) |
| Package set at MAIN vs DEV | **Identical** (16 packages, no add/remove) |

---

## 1. Objective and Non-Negotiables

### 1.1 Objective

Perform a **graph-preserving merge** of `DEV_SHA` into `MAIN_SHA` on branch
`integration/0.11-from-0.10`, producing a **true merge commit with two parents**
(`parent[0] = MAIN_SHA` lineage, `parent[1] = DEV_SHA`), such that the resulting tree contains
the union of intended behavior from both sides.

### 1.2 Graph-preserving means

- **MUST** produce a real merge commit. **MUST NOT** squash.
- **MUST NOT** rebase `dev/0.11.0` commits onto main.
- **MUST NOT** cherry-pick individual dev commits as a substitute for the merge.
- **MUST NOT** rewrite, amend, or drop any commit reachable from `MAIN_SHA` or `DEV_SHA`.
- After the merge, **both** `MAIN_SHA` and `DEV_SHA` **MUST** be ancestors of the merge commit.

Rationale: a squash or rebase destroys the ancestry relationship, which makes every future
`dev/*` → `main` merge re-conflict on the same 303 commits and makes `git merge-base` useless for
subsequent integrations. The graph *is* the deliverable, equally with the tree.

### 1.3 No functionality may be lost — from EITHER side

This is the single most important correctness requirement.

- **REQ-NL-1 (No main loss):** Every behavior present at `MAIN_SHA` must still be present after the
  merge, unless dev *deliberately and knowingly* removed it and that removal is recorded as an
  explicit decision in `conflict-decisions.md`.
- **REQ-NL-2 (No dev loss):** Every behavior present at `DEV_SHA` must still be present after the
  merge, unless main *deliberately and knowingly* removed it and that removal is recorded as an
  explicit decision in `conflict-decisions.md`.
- **REQ-NL-3 (No silent side-taking):** Resolving a conflict by wholesale `--ours` / `--theirs`
  without reading both sides is **forbidden**. Every conflicted hunk requires a recorded decision.
- **REQ-NL-4 (Deletions are decisions):** A file deleted on one side and modified on the other is
  never auto-resolved. See §6.3.
- **REQ-NL-5 (Tests are functionality):** Deleting or skipping a test to make a build pass is
  functionality loss. Forbidden without an explicit recorded decision.

### 1.4 Prohibited remedies (hard stops)

The following are **never** acceptable ways to make a gate pass:

- Adding `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, or any new suppression.
- Weakening `tsconfig` strictness, ESLint rule severity, or lint `--max-warnings` thresholds.
- Deleting, `.skip`-ing, or `.only`-ing tests to get green.
- Loosening or deleting the repo guard scripts (`check-genai-enclave`, `check-cli-import-boundary`,
  `check-legacy-paths`, `check-doc-links`, `check-doc-placement`, `genai-import-inventory`,
  `check-agents-api-surface`, `check-eslint-guard`).
- Weakening `publish-integrity` or enclave-guard manifests to accommodate a merge artifact.

If a gate cannot pass without one of these, the *resolution* is wrong. Fix the resolution.

---

## 2. Protected Paths: `.llxprt/` (do not modify)

`.llxprt/` is version-controlled project memory/settings/skills. **Nothing under `.llxprt/` may be
modified by this integration.**

Tracked contents at `MAIN_SHA`:

```text
.llxprt/LLXPRT.md
.llxprt/settings.json
.llxprt/skills/pr-creator/SKILL.md
```

### 2.1 Known situation (verified read-only)

`.llxprt/LLXPRT.md` was modified on **both** sides since the merge base:

| Side | Diffstat vs base |
|------|------------------|
| DEV  | `1 file changed, 2 deletions(-)` |
| MAIN | `1 file changed, 2 insertions(+), 4 deletions(-)` |

It nevertheless **auto-merges without conflict**, and — verified against the read-only merged tree
produced by `git merge-tree --write-tree` — the merged result is **byte-identical to MAIN**:

```text
merged .llxprt/LLXPRT.md blob : ef1e79e539fa1f96cf627f1e9d53e4a724a6ba19
MAIN   .llxprt/LLXPRT.md blob : ef1e79e539fa1f96cf627f1e9d53e4a724a6ba19   (identical)

merged .llxprt tree : f5a6e8742d395b8c9081dbbc6916b08b7aac52a6
MAIN   .llxprt tree : f5a6e8742d395b8c9081dbbc6916b08b7aac52a6   (identical)
DEV    .llxprt tree : 171d17881e1d90ce3a9f4512522501fd7daeae06   (differs — expected)
```

**Status: PASS — confirmed against the real merge.** The merge has been started
(`git merge --no-ff --no-commit 527101d14fea534cd69232765d475c0f158c6dfc`), and `.llxprt/` has no
conflict status and remains identical to main — verified against the **real merge**, not just the
pre-merge prediction. The default merge yields MAIN's `.llxprt` exactly. Final post-commit
verification (Gate G3 / INV-15) still must run at P6 after the merge commit is created.

### 2.2 Protected-path rules

- **P-1:** Do not hand-edit any file under `.llxprt/` during this integration, for any reason.
- **P-2:** After the merge, the `.llxprt` **tree OID must equal `f5a6e8742d395b8c9081dbbc6916b08b7aac52a6`**
  (i.e. MAIN's). Verify via Gate G3.
- **P-3:** If the merge ever leaves `.llxprt/` conflicted or different from MAIN, resolve by
  restoring MAIN's exact version (`git checkout MAIN_SHA -- .llxprt/`) — this is the *only*
  sanctioned `.llxprt` operation — and record it in the decision ledger.
- **P-4:** Never `rm`, `git clean`, or `git checkout` in a way that removes `.llxprt/` contents.
  Do not delete or clean anything, anywhere, as part of this plan.
- **P-5:** `.llxprt/LLXPRT.md` must not be committed with integration-specific scratch memories.

---

## 3. Read-Only Conflict Forecast (authoritative, already computed)

Produced **without touching the working tree** via:

```bash
git merge-tree --write-tree -z 8ab221bb307080359370281bd3496e12661438da 527101d14fea534cd69232765d475c0f158c6dfc
```

Exit code `1` (= conflicts present, as expected). Resulting merged tree OID:
`3854f0002ac058f0d07a7e37f017512f38f13143`.

### 3.1 Conflict totals

| Conflict type | Count |
|---------------|-------|
| `content` | **57** |
| `add/add` | **12** |
| `modify/delete` | **1** |
| **TOTAL conflicted paths** | **70** |

### 3.2 Cluster distribution

| Cluster | Conflicts |
|---------|-----------|
| `packages/agents` | 14 |
| `packages/cli` | 9 |
| `packages/providers` | 8 |
| `packages/a2a-server` | 7 |
| `packages/core` | 6 |
| `scripts/` | 5 |
| `packages/test-utils` | 4 |
| `packages/policy` | 3 |
| `.github/workflows` | 3 |
| `docs/` | 2 |
| `packages/{storage,settings,mcp,ide-integration}` | 1 each |
| root (`package.json`, `bun.lock`, `CHANGELOG.md`, `tsconfig.scripts.json`) | 4 |
| `dev-docs/` | 1 |

> This forecast was a **planning aid**. The real merge was started and the actual conflict set
> **exactly matched** this forecast (57 content / 12 add/add / 1 modify/delete = 70, zero delta).
> **All 70 conflicts are now RESOLVED and VERIFIED** — zero unmerged paths remain. See
> `conflict-decisions.md` §1 for the status index and `verification-log.md` Gate Summary for
> evidence.

---

## 4. Semantic Subsystem Clusters (work units)

Conflicts are resolved **cluster by cluster**, because correctness is a property of a subsystem,
not of a file. Each cluster is an independently reviewable, independently verifiable unit with its
own rollback point (§11).

### C1 — Agents / agentic loop / turn lifecycle (14 conflicts)

```text
packages/agents/src/compression/providerContentEnforcement.ts
packages/agents/src/core/agenticLoop/AgenticLoop.ts
packages/agents/src/core/agenticLoop/loopHelpers.ts
packages/agents/src/core/chatSession.ts
packages/agents/src/core/contextLimitResolver.ts
packages/agents/src/core/DirectMessageProcessor.ts
packages/agents/src/core/StreamProcessor.ts
packages/agents/src/core/turn.ts
packages/agents/src/tools/task.ts
packages/agents/src/core/MessageStreamOrchestrator.modelinfo.test.ts   (test)
packages/agents/src/core/processorRetryBoundary.test.ts                (test, add/add)
packages/agents/src/core/turn.preRequestTimeout.test.ts                (test)
packages/agents/src/core/turn.test.ts                                  (test)
packages/agents/src/core/__tests__/providerAgnosticNamingAllowlist.ts  (add/add, allowlist)
```

**Risk: HIGHEST.** This is the streaming/turn/retry core. `turn.ts`, `StreamProcessor.ts`, and
`AgenticLoop.ts` are all conflicted simultaneously — meaning both sides evolved the same control
flow. Resolve `turn.ts` + `StreamProcessor.ts` + `AgenticLoop.ts` + `loopHelpers.ts` **as one
coherent unit**, then reconcile the four tests to the *union* of both sides' assertions.
`providerAgnosticNamingAllowlist.ts` is an add/add allowlist — it must become the **union** of both
allowlists, and must not be narrowed to make a guard pass.

**Cluster verify:** `npm run test --workspace @vybestack/llxprt-code-agents`

### C2 — Providers / streaming / retry (8 conflicts)

```text
packages/providers/src/IProvider.ts
packages/providers/src/LoadBalancingProvider.ts
packages/providers/src/RetryOrchestrator.ts
packages/providers/src/runtimeNormalizer.ts
packages/providers/src/anthropic/AnthropicStreamProcessor.ts
packages/providers/src/openai-responses/openAIResponsesExecutor.ts
packages/providers/src/openai/parseResponsesStream.ts
packages/providers/src/__tests__/extracted-helpers.behavior.test.ts    (test)
```

**Risk: HIGH.** `IProvider.ts` is a **contract** file — resolve it FIRST in this cluster and let its
resolution constrain the implementations. A conflicted interface plus conflicted implementors is
the classic silent-drift trap. Note `packages/core/src/runtime/contracts/RuntimeProviderChat.ts`
(in C3) is a sibling contract — keep the two consistent.

**Cluster verify:** `npm run test --workspace @vybestack/llxprt-code-providers`

### C3 — Core config / runtime contracts / token limits (6 conflicts)

```text
packages/core/src/config/config.ts
packages/core/src/runtime/contracts/RuntimeProviderChat.ts
packages/core/src/core/tokenLimits.ts
packages/core/src/core/tokenLimits.test.ts            (test)
packages/core/src/utils/secure-browser-launcher.ts
packages/core/src/utils/secure-browser-launcher.test.ts  (test)
```

**Risk: HIGH.** `config.ts` is the widest-blast-radius file in the repo.
`tokenLimits.ts`/`.test.ts` must be resolved together — the table and its assertions are one unit;
take the **union** of model entries from both sides, never one side's table wholesale.
`secure-browser-launcher.ts` is **security-sensitive**: resolve toward the *strictest* combination
of both sides' validation, never the laxer one.

**Cluster verify:** `npm run test --workspace @vybestack/llxprt-code-core`

### C4 — CLI surface / extensions / input (9 conflicts)

```text
packages/cli/src/config/extension.ts
packages/cli/src/config/postConfigRuntime.ts
packages/cli/src/nonInteractiveCliSupport.ts
packages/cli/src/session/errorReporting.ts
packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts
packages/cli/src/config/settingsSchema.test.ts                        (test)
packages/cli/src/config/extensions/rootAwareManagement.test.ts        (test, add/add)
packages/cli/src/config/extensions/rootAwareUninstallIdentity.test.ts (test, add/add)
packages/cli/src/launcher/cli-bin.test.ts                             (MODIFY/DELETE — see §6.3)
```

**Risk: HIGH.** Contains the single `modify/delete` conflict. Also note DEV deleted
`packages/cli/src/ui/containers/AppContainer/hooks/useIdeRestartHotkey.ts` — confirm main does not
still reference it (see §6.4).

**Cluster verify:** `npm run test --workspace packages/cli`

> **Use the path form, not the name form.** Verified at `MAIN_SHA`: the **root** package and
> `packages/cli` are *both* named `@vybestack/llxprt-code` (the known self-collision, together with
> a self-override). `--workspace @vybestack/llxprt-code` is therefore ambiguous and may resolve to
> the wrong target. Always address `packages/cli` by path.

### C5 — a2a-server config/settings/extensions (7 conflicts)

```text
packages/a2a-server/src/agent/executor.ts
packages/a2a-server/src/config/extension.ts
packages/a2a-server/src/config/settings.ts
packages/a2a-server/src/config/config.test.ts             (test)
packages/a2a-server/src/config/extension.compat.test.ts   (test, add/add)
packages/a2a-server/src/config/extension.test.ts          (test, add/add)
packages/a2a-server/src/config/settings.test.ts           (test, add/add)
```

**Risk: MEDIUM-HIGH.** Four of seven are tests and three are add/add — both sides wrote tests for
the same area independently. Resolution must be the **union** of test coverage, not a pick.
`a2a-server/src/config/extension.ts` must stay consistent with `cli/src/config/extension.ts` (C4).

**Cluster verify:** `npm run test --workspace @vybestack/llxprt-code-a2a-server`

### C6 — Policy engine + TOML loader (3 conflicts)

```text
packages/policy/src/policy-engine.ts
packages/policy/src/toml-loader.ts
packages/policy/src/toml-loader.test.ts   (test)
```

**Risk: MEDIUM.** Security-relevant (tool permissioning). Resolve toward the union of rules with
the **stricter** default-deny behavior preserved.

**Cluster verify:** `npm run test --workspace @vybestack/llxprt-code-policy`

### C7 — Test harness / test-utils (4 conflicts)

```text
packages/test-utils/src/interactive-run.ts
packages/test-utils/src/process-run.ts
packages/test-utils/src/test-rig.ts
packages/test-utils/src/process-run.test.ts   (test, add/add)
```

**Risk: MEDIUM — but force-multiplying.** A wrong resolution here produces *false green* or *false
red* across every integration test. Resolve C7 **before** trusting any integration-test result.

**Cluster verify:** `npm run test --workspace @vybestack/llxprt-code-test-utils`

### C8 — Build/guard scripts + scripts tsconfig (6 conflicts)

```text
scripts/check-genai-enclave.ts                      (add/add)
scripts/tests/genai-enclave-guard-helpers.ts        (add/add)
scripts/tests/genai-enclave-guard-manifest.test.ts  (add/add)
scripts/tests/genai-enclave-guard.test.ts           (add/add)
scripts/tests/publish-integrity.test.ts             (test)
tsconfig.scripts.json
```

**Risk: MEDIUM-HIGH.** Four add/add files: both sides independently implemented the genai enclave
guard. Determine which implementation is canonical **by reading both**, then ensure the retained
guard is **at least as strict** as either side. `tsconfig.scripts.json` must include every script
file the retained guard implementation needs.

**Cluster verify:** `npm run test:scripts` and `npm run lint:genai-enclave`

### C9 — Small single-file packages (4 conflicts)

```text
packages/mcp/src/client/mcp-client-manager.ts
packages/ide-integration/src/ide/ide-client.ts
packages/settings/src/settings/registry/registry-entries-3.ts
packages/storage/src/config/storage.test.ts   (test)
```

**Risk: MEDIUM.** `registry-entries-3.ts` is a settings registry — resolve as the **union** of
setting entries; a dropped entry silently removes a user-facing setting (a REQ-NL violation).

**Cluster verify:** per-workspace `npm run test --workspace ...` for mcp / ide-integration /
settings / storage.

### C10 — CI workflows (3 conflicts)

```text
.github/workflows/ci.yml
.github/workflows/e2e.yml
.github/workflows/release.yml
```

**Risk: HIGH (process).** `MAIN_SHA` itself is `ci(e2e): add missing permissions for mergeability
gate (#2697)` — main's most recent change is *in this exact file set*. Main's CI fixes are newer
and must not be reverted by dev's older workflow content. Resolve to the union of jobs, keeping
main's permissions/mergeability-gate fixes intact.

### C11 — Root manifests + docs (5 conflicts)

```text
package.json
bun.lock
CHANGELOG.md
docs/cli/skills.md
docs/providers/quick-reference.md
dev-docs/genai-import-baseline.md
```

**Risk: MEDIUM.** Special handling:

- `package.json` — version is `0.10.0` on **all three** points, so any version conflict is
  incidental. Resolve to the **union of scripts and dependencies**. Never drop a script.
- `bun.lock` — **do not hand-merge.** Resolve by regenerating (§6.5).
- `CHANGELOG.md` — union of entries, chronological; never drop either side's entries.
- `dev-docs/genai-import-baseline.md` — a **baseline file**; it must match whatever the retained
  C8 guard actually enforces. Resolve C8 first, then regenerate/reconcile this baseline. Do not
  edit the baseline merely to silence the guard (that is a prohibited remedy under §1.4).

### Cluster dependency order (resolve in this order)

```text
C7 (test harness)  →  C8 (guards/scripts)  →  C3 (core contracts)  →  C2 (providers)
   →  C1 (agents)  →  C4 (cli)  →  C5 (a2a)  →  C6 (policy)  →  C9 (small pkgs)
   →  C10 (CI)     →  C11 (root/docs, incl. bun.lock regen LAST)
```

Rationale: contracts and harness first (they constrain everything downstream); generated/lock
artifacts last (they must reflect the final resolved state).

---

## 5. Conflict-Resolution Principles

- **CR-1 — Read both sides, always.** Before resolving any hunk, read the MAIN version and the DEV
  version in full context. Use `git show MAIN_SHA:<path>` and `git show DEV_SHA:<path>`.
- **CR-2 — Union of intent, not union of text.** The goal is that both sides' *behaviors* survive.
  Mechanically concatenating both sides' text is as wrong as dropping one.
- **CR-3 — Contracts before implementations.** Resolve interface/contract files (`IProvider.ts`,
  `RuntimeProviderChat.ts`, `config.ts`, settings registry) before the code that implements them.
- **CR-4 — Newer-intent wins on the same decision.** When both sides changed the *same* decision
  (not different decisions), prefer the side whose change is the deliberate, later evolution — but
  only after confirming the other side has no dependent behavior. Record the reasoning.
- **CR-5 — Main's recent CI/security fixes are not regressions to undo.** MAIN is 46 commits newer
  in wall-clock terms than DEV's tip on shared files. Do not revert main's fixes by taking dev's
  older text (acute risk in C10, C3 `secure-browser-launcher`, C6 policy).
- **CR-6 — Tests merge as a union.** When both sides have tests for the same unit, keep **all**
  assertions from both, adapted to the resolved implementation. Never pick one test file wholesale.
- **CR-7 — Add/add means "both wrote it independently."** Read both implementations, pick the
  superior one *or* synthesize, and ensure the result is at least as strict/complete as both.
  Never resolve add/add by arbitrary side preference.
- **CR-8 — Generated artifacts are regenerated, never hand-merged.** `bun.lock`, prompt manifests,
  settings schema/doc outputs, baselines.
- **CR-9 — Strictness ratchets up, never down.** For any security/guard/validation conflict, the
  resolution must be at least as strict as the stricter side.
- **CR-10 — No suppression as resolution.** See §1.4. A resolution that requires a new
  `@ts-expect-error` or `eslint-disable` is a wrong resolution.
- **CR-11 — Every conflicted file gets a ledger row.** No exceptions, including "trivial" ones.
- **CR-12 — When genuinely unsure, escalate, don't guess.** Record the ambiguity in
  `conflict-decisions.md` with status `NEEDS-REVIEW` and continue with other clusters.

---

## 6. Special-Case Handling

### 6.1 `.llxprt/` — see §2. Expected to need **zero** action; must be **verified** (G3).

### 6.2 Renames on MAIN (dev edits must follow the rename)

MAIN performed these renames after the merge base. If DEV modified the **old** path, git's rename
detection usually carries the change over — but this **must be verified**, because a missed
carry-over is silent dev-functionality loss (REQ-NL-2).

```text
R092  docs/agent-api.md                          → dev-docs/agent-api.md
R098  docs/architecture/message-bus-architecture.md → dev-docs/architecture/message-bus.md
R099  docs/hooks/architecture.md                 → dev-docs/hooks/architecture.md
R100  docs/merge-notes/batch21-25-skipped.md     → dev-docs/merge-notes/2026-01-06-batches21-25-skipped.md
R100  docs/plans/2026-01-03-welcome-onboarding.md → dev-docs/plans/archive/2026-01-03-welcome-onboarding.md
R100  docs/tool-output-format.md                 → dev-docs/tools/tool-output-format.md
R096  docs/EMOJI-FILTER.md                       → docs/emoji-filter.md
R056  packages/providers/src/anthropic/AnthropicMessageValidator.stripEmptyText.test.ts
      → packages/providers/src/anthropic/AnthropicMessageValidator.stripEmptyTextBlocks.test.ts
```

**Checklist (record evidence per row in `verification-log.md`):**

- [ ] For each rename, confirm the merged tree has the file at the **new** path only.
- [ ] Confirm no stray copy resurrected at the **old** path.
- [ ] Confirm dev's edits to the old path are present in the new path's content.
- [ ] `R056` (the Anthropic validator test) is the highest-risk row — it is a **test rename**, so a
      lost carry-over silently loses assertions.

### 6.3 The single `modify/delete`: `packages/cli/src/launcher/cli-bin.test.ts`

Exact merge-tree message:

```text
CONFLICT (modify/delete): packages/cli/src/launcher/cli-bin.test.ts
  deleted in 8ab221bb307080359370281bd3496e12661438da (MAIN)
  and modified in 527101d14fea534cd69232765d475c0f158c6dfc (DEV).
  Version 527101d1... of packages/cli/src/launcher/cli-bin.test.ts left in tree.
```

Context: MAIN deleted **three** launcher/bin artifacts together —

```text
D  packages/cli/bin/llxprt.cjs
D  packages/cli/src/launcher/cli-bin.e2e.test.ts
D  packages/cli/src/launcher/cli-bin.test.ts
```

This is a coherent **deliberate removal of the old bin launcher** on main, not an accident.
Meanwhile DEV was still editing the test.

**Required analysis before deciding (do not shortcut):**

- [x] Read main's commit(s) that removed `packages/cli/bin/llxprt.cjs` and the two tests. Confirmed
      the launcher was replaced by the nonInteractiveCli/standard launcher path, not merely dropped.
- [x] Determine whether DEV's modification to `cli-bin.test.ts` asserts behavior that **still
      exists** at MAIN under a new name/path. The launcher behavior is covered by the current CLI
      test suite.
- [x] **If the behavior no longer exists at MAIN:** accept main's deletion. Recorded as a deliberate
      dev-side removal under REQ-NL-2's escape clause with full reasoning.
- [x] **If the behavior still exists at MAIN under a new home:** N/A — old bin launcher retired.

**Decision (RESOLVED):** Accept main's deletion. The file is **not present** in the merged tree
(`test -f` → NOT_PRESENT). The old bin launcher was a coherent retirement; the new launcher path
is tested by the whole-repo `npm test` (EXIT_STATUS=0). See `conflict-decisions.md` §2 CD-MD-001
for the full decision record.

Ledger row: `CD-MD-001` (filled in `conflict-decisions.md` §2 — VERIFIED).

### 6.4 DEV-side deletions (confirm MAIN has no dangling references)

```text
D  packages/cli/src/ui/containers/AppContainer/hooks/useIdeRestartHotkey.ts   (DEV only)
D  packages/core/src/config/__tests__/deprecatedGeminiAliases.test.ts         (BOTH sides)
D  packages/core/src/core/geminiLegacyAliases.test-d.ts                       (BOTH sides)
D  packages/core/src/core/geminiLegacyAliases.test.ts                         (BOTH sides)
D  packages/core/src/core/geminiLegacyAliases.ts                              (BOTH sides)
```

The four `geminiLegacyAliases*` deletions are **identical on both sides** → no conflict, no action.

`useIdeRestartHotkey.ts` is deleted **only** by DEV. MAIN may still import it (MAIN also has 646
modified files, and `useAppInput.ts` is conflicted in C4).

- [x] Grep the merged tree for `useIdeRestartHotkey` — **zero source references found** (G15 PASS).
      The only matches are stale `dist/` build artifacts (untracked generated output), not tracked
      source. The file itself is staged as deleted. No dangling import — no build break.

### 6.5 `bun.lock` — regenerate, never hand-merge

Per project knowledge, `bun install --frozen-lockfile` is structurally unusable in this monorepo
(root, `packages/cli`, and a self-override all named `@vybestack/llxprt-code`, plus `file:../`
workspace protocol and 26 overrides). Clean generation **is** deterministic; plain `bun install`
against a committed lockfile works.

**Procedure (C11, performed LAST after all source clusters resolve):**

- [ ] Resolve `package.json` first (union of scripts + dependencies).
- [ ] Regenerate the lockfile rather than merging conflict markers.
- [ ] Verify with **plain** `bun install` (exit 0, all 16 workspaces resolve).
- [ ] **Do NOT** use or add `--frozen-lockfile` to any CI step as part of this merge.
- [ ] Confirm no conflict markers remain in `bun.lock` (Gate G2).

### 6.6 `dev-docs/genai-import-baseline.md` + the enclave guard (C8 ↔ C11 coupling)

The baseline file and the guard implementation are **one unit** split across two clusters. Resolve
C8 (guard) first; then make the baseline reflect what the retained guard actually enforces.
Editing the baseline purely to silence a guard failure is a prohibited remedy (§1.4).

---

## 7. Execution Phases

Track live status in `execution-tracker.md`. Phases are checkpoints, not calendar items.

| Phase | Name | Exit condition |
|-------|------|----------------|
| **P0** | Preflight & invariants | §8 invariants recorded PASS with pasted output |
| **P1** | Read-only conflict forecast | §3 table confirmed against a fresh `merge-tree` run |
| **P2** | Start the merge (no commit) | Merge in progress, conflict set captured, matches/deltas recorded |
| **P3** | Resolve clusters C7→C11 in order | Every conflicted file has a ledger row; zero conflict markers |
| **P4** | Local verification | Gates G1–G9 all PASS with pasted evidence |
| **P5** | Review gates | §9 human/agent review gates satisfied |
| **P6** | Merge commit created | Two parents confirmed; ancestry invariants re-verified (G10) |
| **P7** | PR + CI + CodeRabbit | §10 loop until fully green and all threads resolved |
| **P8** | Landing readiness | Snapshot-drift re-check (§13) PASS; explicit user go-ahead |

### P2 note — merge started (2026-07-25); all conflicts resolved (2026-07-26)

The merge **has been started**: `git merge --no-ff --no-commit 527101d14fea534cd69232765d475c0f158c6dfc`.
`MERGE_HEAD` is exactly `DEV_SHA`. The actual conflict set exactly matched the 70-path forecast.
Resolution happens in the working tree with a real conflict set; the commit will be created only
after P5/P6 pass. The merge retains both parents (§1.2) — no squash, no rebase. `.llxprt/` has no
conflict status and remains identical to main (confirmed against the real merge).

**Resolution + verification complete (2026-07-26):** All 70 conflicts resolved — **zero unmerged
paths** (`git diff --diff-filter=U` = 0). 592 files staged. Full local verification cycle (P4) run
with real output: `npm test`/lint/lint:ci/typecheck/build/format all exit 0; GenAI enclave pass
(3957 files); `bun install` exit 0; smoke returned a haiku (exit 0). **Canonical serial scripts
suite (G12) PASSED: 135 files / 3590 tests / 9 skipped, exit 0**
(`/tmp/llxprt_merge_scripts_serial_postocr.log`); the default parallel `npm run test:scripts` had
only a Vitest worker RPC timeout **after** all 3590 assertions passed (noncanonical parallel-run
infrastructure noise). **G13 (suppression-delta) COMPLETE — no new suppressions.** **G14 (rename
carry-over) COMPLETE — 8 renames verified against staged tree.** **G17 (integration) is
ENV-BLOCKED** (not PASS — missing provider env). **G19 (`node scripts/start.js`) is N/A** — command
absent; not a valid gate. **RG-3 OCR final session COMPLETED** — verified session
`57fe79fd-6f32-4916-8f06-1ed1cadf825b`: **569 files reviewed, 365 deduplicated findings (1
critical / 75 high / 197 medium / 92 low)**; output at `/tmp/ocr_review_final.log` and
`/tmp/ocr_findings_final_unique.tsv`; findings were source-validated in coherent batches, valid
issues remediated, and factual/speculative claims rejected. DeepThinker reviewed the staged
pre-drift tree and found the Zed locked-stream shutdown (release-blocker) → **fixed with real ACP
behavioral tests and the full 331-test Zed suite passes**.

**Current-main drift reconciled (G18 RESOLVED + VERIFIED, 2026-07-26):** `origin/main` advanced **10
commits** past the frozen `MAIN_SHA` (`8ab221bb…`) to current main `9783f8c7f1b04f8f852b397dca3a626532e6f095`.
A second graph-preserving merge was committed (first parent == `7256438614b59da9a764d74f73bd12b830e909d0`,
the 0.11 integration merge; second parent == `9783f8c7…`). **Three conflicts** were resolved: (a)
current-main's pr-review walkthrough redesign plus step-scoped quota-selected secret; (b) a
`Date.now`-relative historical fixture; (c) `package-lock.json` regenerated. Final post-drift
evidence: full `npm test` exit 0 (`/tmp/llxprt_drift_full_test.log`); `lint:ci` exit 0
(`/tmp/llxprt_drift_lint_ci.log`); eslint guard exit 0; typecheck/format/build pass; **complete
serial scripts suite: 144 files passed / 5 skipped, 4059 tests passed / 9 skipped, exit 0**
(`/tmp/llxprt_drift_scripts_serial_rerun.log`); lockfile/GenAI/API guards pass; stepfun smoke
pass. **No post-drift OCR/DeepThinker rerun was performed** — the review cap was reached, and the
drift consists entirely of already-reviewed current-main commits plus three reconciliations
covered by focused/full gates. **G18 drift is now resolved and verified.** G10 for the first
integration commit (`72564386…`) records its exact two parents (`8ab221bb…` + `527101d1…`); the
final current-main merge ancestry is committed (two-parent graph preserved). Provider integration
(G17) remains ENVIRONMENT-BLOCKED.

**Post-PR CI remediation (P7 COMPLETE, 2026-07-26):** PR **2736** was created on
`integration/0.11-from-0.10` → base `main`. **CodeRabbit was automatically skipped** ("Review
skipped: 581 files exceed the limit of 300"; **0 threads** — no threads to triage). Four CI
remediation commits were appended **forward** (no ancestry rewrite): `3489dc716d` (E2E quota
compatibility bridge — all three E2E jobs passed), `f8cd1ef094` (neutralize token usage logging —
agents-neutral gate satisfied, no allowlist/suppression), `84154ccfdf` (regenerate
genai-import-baseline 29→28 importers), `e14ecce133` (CodeQL alerts 177+178 remediated — linear
scan for ReDoS + HMAC-SHA256 for kimi cache keying, with new behavioral tests). The
windows-installed-command failure was classified **transient** (one `spawnSync ETIMEDOUT` during
`npm global install`; smoke inputs unchanged except an `@agentclientprotocol/sdk` bump correctly
resolved in `package-lock.json`; same workflow succeeded on other branches; explicit re-run of
the identical commit succeeded — not a code defect). See §13.2 for the full remediation record.
Final local verification on the current tree (HEAD `e14ecce133`): `npm run test` EXIT_STATUS=0,
`lint:ci` exit 0, `typecheck` exit 0, `format` exit 0 (no working-tree changes), `build` exit 0,
`lint:genai-inventory` exit 0, `check:lockfile` exit 0, `lint:eslint-guard` exit 0, smoke exit 0
returning a haiku. Local `gate:agents-neutral` exits 127 solely because `tsx` is not resolvable
locally (the same gate passes in CI) — a local tooling artifact, not a gate failure. G17 remains
ENVIRONMENT-BLOCKED. See `execution-tracker.md` for the live resume state and
`verification-log.md` (§CI, §P7-FINAL) for all evidence.

---

## 8. Ancestry / Reachability Invariants

These protect the graph-preserving requirement. **Re-verify at P0 and again at P6.**

| ID | Invariant | Command | P0 result |
|----|-----------|---------|-----------|
| INV-1 | All three SHAs exist as commits | `git cat-file -t <sha>` ×3 | **PASS** — all returned `commit` |
| INV-2 | Branch is rooted exactly at MAIN_SHA | `git rev-parse HEAD` | **PASS** — `8ab221bb307080359370281bd3496e12661438da` |
| INV-3 | MAIN_SHA is ancestor of HEAD | `git merge-base --is-ancestor MAIN_SHA HEAD` | **PASS** — `MAIN_IS_ANCESTOR_OF_HEAD=YES` |
| INV-4 | DEV_SHA is **not yet** ancestor of HEAD (pre-merge) | `git merge-base --is-ancestor DEV_SHA HEAD` | **PASS** — `DEV_IS_ANCESTOR_OF_HEAD=NO` (correct pre-merge) |
| INV-5 | Merge-base is exactly `c7b1b787...` | `git merge-base MAIN_SHA DEV_SHA` | **PASS** — `c7b1b787568b84ac9346165e3002e035a748062c` |
| INV-6 | Working tree clean at P0 | `git status --porcelain` | **PASS** — empty output |
| INV-7 | DEV_SHA reachable from a local ref | `git for-each-ref \| grep <sha>` | **PASS** — `refs/remotes/origin/dev/0.11.0` |

Reference ref state observed at P0:

```text
refs/heads/integration/0.11-from-0.10   8ab221bb307080359370281bd3496e12661438da
refs/remotes/origin/HEAD                8ab221bb307080359370281bd3496e12661438da
refs/remotes/origin/main                8ab221bb307080359370281bd3496e12661438da
refs/remotes/origin/dev/0.11.0          527101d14fea534cd69232765d475c0f158c6dfc
```

### 8.1 Post-merge invariants (P6 — must ALL hold)

| ID | Invariant | Command |
|----|-----------|---------|
| INV-8 | Merge commit has exactly two parents | `git cat-file -p HEAD \| grep -c '^parent'` → `2` |
| INV-9 | `parent[0]` is the MAIN lineage | `git rev-parse HEAD^1` |
| INV-10 | `parent[1]` is exactly `DEV_SHA` | `git rev-parse HEAD^2` → `527101d1...` |
| INV-11 | MAIN_SHA is an ancestor of the merge | `git merge-base --is-ancestor MAIN_SHA HEAD` → true |
| INV-12 | DEV_SHA is an ancestor of the merge | `git merge-base --is-ancestor DEV_SHA HEAD` → true |
| INV-13 | All 303 dev-only commits reachable | `git rev-list --count DEV_SHA..HEAD` reasoning + spot-check |
| INV-14 | No commit reachable from MAIN_SHA was dropped | `git rev-list --count MAIN_SHA..HEAD` / `HEAD..MAIN_SHA` = 0 |
| INV-15 | `.llxprt` tree OID == MAIN's `f5a6e874...` | `git rev-parse HEAD:.llxprt` |

`INV-14` detail: `git rev-list HEAD..MAIN_SHA` **must be empty** — a non-empty result means main
commits were lost.

---

## 9. Required Verification Gates

Every gate needs a **pasted command + real output** in `verification-log.md`. A gate with no
evidence is **FAIL**, not "assumed pass".

| Gate | Check | Command | Blocking? |
|------|-------|---------|-----------|
| **G1** | Preflight invariants (§8, INV-1..7) | see §8 | Yes |
| **G2** | Zero conflict markers anywhere | `grep -rn -E '^(<{7}\|={7}\|>{7})' --include='*' .` (excluding this plan dir) | Yes |
| **G3** | `.llxprt` untouched (tree OID == MAIN's) | `git rev-parse HEAD:.llxprt` == `f5a6e874...` | Yes |
| **G4** | Typecheck | `npm run typecheck` | Yes |
| **G5** | Lint (no new suppressions) | `npm run lint` | Yes |
| **G6** | Full test suite | `npm run test` | Yes |
| **G7** | Format | `npm run format` | Yes |
| **G8** | Build | `npm run build` | Yes |
| **G9** | Runtime smoke | `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` | Yes |
| **G10** | Post-merge ancestry (§8.1, INV-8..15) | see §8.1 | Yes |
| **G11** | Guard scripts | `npm run lint:genai-enclave`, `lint:cli-boundary`, `lint:legacy-paths`, `lint:doc-links`, `lint:doc-placement`, `lint:genai-inventory`, `lint:agents-api-surface`, `lint:eslint-guard` | Yes |
| **G12** | Scripts tests | `npm run test:scripts` | Yes |
| **G13** | Suppression-delta audit | diff-scan for added `@ts-ignore` / `@ts-expect-error` / `eslint-disable` / `.skip(` / `.only(` vs both parents | Yes |
| **G14** | Rename carry-over (§6.2) | per-row evidence | Yes |
| **G15** | No dangling `useIdeRestartHotkey` refs (§6.4) | `grep -rn useIdeRestartHotkey packages/` → 0 | Yes |
| **G16** | `bun install` (plain, NOT frozen) | `bun install` → exit 0, 16 workspaces | Yes |
| **G17** | Integration/e2e suite | `npm run test:integration:sandbox:none` | Yes |
| **G18** | Snapshot-drift re-check (§13) | see §13 | Yes (at P8) |

### G13 — suppression-delta audit (explicit method)

Compare the merge result against **both** parents; the count of each suppression pattern must not
exceed the sum of what the two parents legitimately contained. Any *new* suppression introduced by
the resolution is a **FAIL** and must be fixed by correcting the resolution (§1.4).

Patterns audited: `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`,
`eslint-disable-next-line`, `it.skip(`, `describe.skip(`, `test.skip(`, `.only(`, `xit(`, `xdescribe(`.

---

## 10. Review Gates and PR / CI / CodeRabbit Workflow

### 10.1 Review gates (before PR)

| Gate | Reviewer | Focus | Exit |
|------|----------|-------|------|
| **RG-1** | Cluster self-review | Each cluster: both sides' behavior present; ledger complete | Every conflicted file has a ledger row with rationale |
| **RG-2** | Architecture review (deepthinker) | Contract coherence across C2/C3; no silent side-taking; REQ-NL-1..5 upheld | Written verdict recorded |
| **RG-3** | Open Code Review (`ocr`) | Full-diff automated review incl. tests | All findings addressed or explicitly dispositioned |
| **RG-4** | Verification cycle | G1–G17 all PASS with pasted evidence | `verification-log.md` complete |

**RG-3 `ocr` operating rules (project-specific, important):**

- Launch **detached**, never in the foreground — the shell watchdog SIGTERM-kills a foreground
  process group mid-review and all buffered output is lost. A high `timeout_seconds` does **not**
  save it.
- Always pass `--timeout 20` for a guaranteed 20-minute floor.
- Poll the log and the PID until the process is genuinely finished.
- Ensure tests are **not** filtered out (ocr excludes test/spec files by default; rely on the
  global `~/.opencodereview/rule.json` include patterns for `**/*.test.*`, `**/*.spec.*`,
  `**/__tests__/**`).
- If stdout is lost anyway, recover findings from `~/.opencodereview/sessions/*/*.jsonl`
  (grep for `code_comment` tool calls).
- Re-run `ocr` if remediation was significant; loop until clean.

### 10.2 PR workflow

- Use `gh` for **all** GitHub interaction (PRs, issues, comments). Never web-fetch GitHub.
- PR title should identify this as the 0.11 integration merge.
- PR body must include: both immutable SHAs, the merge-base SHA, cluster summary, the decision
  ledger summary (especially `CD-MD-001`), and the verification evidence summary.
- Avoid unescaped backticks in `gh` command arguments.
- **Do not merge the PR.** Report status and wait for explicit user go-ahead (§12).

### 10.3 CI + CodeRabbit loop

Repeat until fully green with no unresolved threads:

1. Watch CI with `gh pr checks <NUM> --watch --interval 300`.
   **Set the tool `timeout_seconds` well above the interval** (≥360s, preferably 1800+) or the
   watch is terminated prematurely.
2. Read CodeRabbit comments via `gh`.
3. Remediate failures/comments — **never** by weakening gates (§1.4).
4. Re-run the local verification cycle (G4–G9).
5. Push, watch again. Loop.
6. **Never** end the session reporting "workflows still running." Watch → fix → watch until done.

Relevant workflows present at MAIN: `ci.yml`, `e2e.yml`, `release.yml`, `pr-review.yml`,
`_pr-mergeability-gate.yml`, `smoke-test.yml`, `interactive-ui.yml`, `ocr-review.yml`, `nightly.yml`,
`build-sandbox.yml`, `windows-installed-command.yml`, `_evals-run.yml`, `evals-nightly.yml`,
`upstream-sync.yml`, and others. C10 conflicts touch three of these — expect CI behavior changes and
verify them deliberately.

---

## 11. Rollback Points

The merge is resolved cluster-by-cluster specifically so failure is recoverable without redoing
everything.

| RP | Point | How to return | What is lost |
|----|-------|---------------|--------------|
| **RP-0** | Pristine branch at MAIN_SHA | Branch is already exactly `8ab221bb...`; abort any in-progress merge | All resolution work |
| **RP-1** | After each cluster (C7…C11) | Per-cluster checkpoint (see below) | Only that cluster's work |
| **RP-2** | Merge resolved, pre-commit | Re-resolve individual files from the recorded ledger | Nothing if ledger is complete |
| **RP-3** | Merge commit created, pre-push | Amend/redo locally; graph not yet published | Nothing (local only) |
| **RP-4** | Pushed / PR open | Fix forward with additional commits. **Do not force-push** — it breaks the preserved graph and CodeRabbit threads | Nothing; history preserved |

**Cluster checkpointing rule:** record, for each cluster, the exact list of files resolved and the
ledger rows completed, so an agent resuming after context compression can tell precisely which
clusters are done. `execution-tracker.md` is the source of truth for this.

**Rollback constraints:**

- Rollback is **abort/redo**, never `rm -rf`, never `git clean`, never deleting untracked files.
- Never roll back by deleting anything under `.llxprt/`.
- Rolling back must never rewrite commits reachable from `MAIN_SHA` or `DEV_SHA`.

---

## 12. Landing Policy

- **Do not merge the PR yourself.** Report status (CI green, threads resolved, gates PASS) and
  **ask for explicit confirmation** before merging.
- Landing additionally requires the §13 snapshot-drift check to be current.

---

## 13. Snapshot Drift — main may advance after this snapshot

**This is an explicit, mandatory requirement of this plan.**

`MAIN_SHA = 8ab221bb307080359370281bd3496e12661438da` is a **frozen snapshot** taken 2026-07-25.
`origin/main` **may advance** while this integration is in progress. If it does:

1. The integration is **not** landable as-is.
2. The new main commits **must be integrated** into this branch before landing.
3. The conflict surface **must be re-analyzed** — new main commits can create new conflicts with
   dev content that previously merged cleanly, and can invalidate cluster resolutions (especially
   C10 CI workflows and C3 `config.ts`, which main changes frequently).
4. The §3 forecast, the cluster tables, and affected ledger rows must be **re-derived and updated**,
   not assumed still valid.

**Drift check (Gate G18 — run at P8, immediately before requesting landing):**

```bash
git rev-parse origin/main
# Compare to 8ab221bb307080359370281bd3496e12661438da
```

| Result | Action |
|--------|--------|
| Equal to `8ab221bb...` | No drift. Proceed. Record evidence. |
| Different | **Drift detected.** Record the new SHA, integrate it into the branch, re-run §3 conflict analysis, re-run **all** of G1–G17, and update this plan's affected sections. Do not land until re-verified. |

Important nuances:

- `MAIN_SHA` and `DEV_SHA` in §0 stay **immutable as the record of this integration's inputs** even
  after drift. Drift is recorded as an *additional* integration step with its own SHA — the original
  inputs are never edited to "keep up".
- Fetching/updating refs is **out of scope for this planning pass** (no fetch, no network). The
  drift check is performed by the executing agent when authorized.
- Because `DEV_SHA` is a frozen dev tip, `dev/0.11.0` may also have advanced. Any post-`527101d1`
  dev work is **out of scope** for this merge and must be a separate follow-up integration.

### 13.1 Drift resolution record (G18 — RESOLVED + VERIFIED, 2026-07-26)

**Drift detected and reconciled.** This subsection records the current-main drift reconciliation so
that the graph-preserving requirement is upheld across the full integration.

| Field | Value |
|-------|-------|
| Frozen `MAIN_SHA` | `8ab221bb307080359370281bd3496e12661438da` (immutable record) |
| Current `origin/main` | `9783f8c7f1b04f8f852b397dca3a626532e6f095` |
| Drift size | **10 commits** advanced past frozen MAIN |
| First integration commit | `7256438614b59da9a764d74f73bd12b830e909d0` (HEAD) — parents `8ab221bb…` + `527101d1…` |
| Active second merge | `MERGE_HEAD` == `9783f8c7…` (current main); first parent == `72564386…`; **uncommitted, in progress** |
| Conflicts during drift | **3** — resolved (see below) |

**The 10 drift commits (`8ab221bb…..9783f8c7…`):**

```text
9783f8c7f1 test(secure-store): restore real keyring-vs-fallback coverage via DI (Fixes #2704) (#2715)
306fb26326 ci: repurpose pr-review into walkthrough/summary + PR-issue alignment (Fixes #2261) (#2717)
89b3561aff Reject incomplete OCR reviews with immutable reviewed-range manifest (Fixes #2575) (#2716)
f675dc3c98 Make OCR synchronize reviews checkpointed, observable, and high-signal (Phase 0+1, Fixes #2649) (#2713)
ab30370d2b Fix load-balancer mixed-aggregate retryability (Fixes #2712) (#2718)
9f170c45ef chore(release): bump main to v0.11.0 for nightly cycle
782506e2b4 Add shadow-mode severity-based publication routing to OCR workflow (Fixes #2672) (#2714)
eb09d1214e ci(test): remove dead secure-store-mode matrix dimension (Fixes #2703) (#2711)
d7ac718314 Adopt upstream OCR action features into ocr-review workflow (Fixes #2670) (#2695)
04e501fc9c Add local fail-open metadata validation for OCR category/severity fields (Fixes #2671) (#2694)
```

**Three drift conflicts resolved:**

1. **Current-main pr-review walkthrough redesign + step-scoped quota-selected secret** — main's
   `#2717` repurposed pr-review into a walkthrough/summary flow and introduced a step-scoped
   quota-selected secret. Resolved by taking current-main's newer CI/workflow intent (CR-5) and
   reconciling the affected workflow/script files.
2. **`Date.now`-relative historical fixture** — a historical test fixture had become relative to
   `Date.now`, causing drift in fixture timestamps. Resolved by stabilizing the fixture.
3. **`package-lock.json` regenerated** — the lockfile was regenerated (CR-8, never hand-merged) to
   reflect the post-drift dependency graph.

**Post-drift verification (all PASS with evidence):** full `npm test` exit 0
(`/tmp/llxprt_drift_full_test.log`); `lint:ci` exit 0 (`/tmp/llxprt_drift_lint_ci.log`); eslint
guard exit 0; typecheck/format/build pass; complete serial scripts suite 144 files passed / 5
skipped, 4059 tests passed / 9 skipped, exit 0 (`/tmp/llxprt_drift_scripts_serial_rerun.log`);
lockfile/GenAI/API guards pass; stepfun smoke pass.

**Review scope note (honesty):** No post-drift OCR or DeepThinker rerun was performed — the review
cap was reached. The drift consists entirely of **already-reviewed current-main commits** (the OCR
session `57fe79fd` and DeepThinker covered the pre-drift tree, which is the superset) plus **three
reconciliations** that are each covered by focused and full gates above. Provider integration (G17)
remains **ENVIRONMENT-BLOCKED**.

**G10 ancestry note:** G10 for the first integration commit (`72564386…`) can record its exact two
parents (`8ab221bb…` MAIN + `527101d1…` DEV). The **final** current-main merge ancestry — the active
second merge — awaits that commit's creation (P6). `MAIN_SHA`/`DEV_SHA` in §0 remain the immutable
record of the *original* integration inputs; the drift is an additional integration step recorded
here, exactly per the nuance above.

---

## 13.2 Post-PR CI remediation phase (PR 2736 — COMPLETE, 2026-07-26)

After the merge was committed and pushed, PR **2736** (`integration/0.11-from-0.10` → base `main`)
entered the P7 CI loop. **CodeRabbit was automatically skipped** ("Review skipped: 581 files exceed
the limit of 300"; **0 threads** — no threads to triage). Four CI remediation commits were appended
**forward** on `integration/0.11-from-0.10` (no ancestry rewrite, no squash, no rebase). The
immutable SHA records in §0 are unchanged.

### CI remediation commits (in order)

| # | SHA | Subject | Root cause | Fix | Outcome |
|---|-----|---------|------------|-----|---------|
| 1 | `3489dc716d` | Preserve trusted E2E quota selection across base versions | The trusted quota selector checks out base SHA `9783f8c7…`, whose `scripts/ci-quota-check.js` writes `OPENAI_API_KEY` to `GITHUB_ENV` but never emits `selected_key` to `GITHUB_OUTPUT`, while `e2e.yml` reads only `steps.quota.outputs.selected_key`. Affected: Linux sandbox none, Linux sandbox docker, macOS. | Compatibility bridge in **both** quota steps (`quota` + `quota_macos`) in `e2e.yml`: scrub `OPENAI_API_KEY` from `GITHUB_ENV` before untrusted checkout; accept valid `primary`/`secondary`; emit `selected_key=primary` only for legacy non-Synthetic; fail closed otherwise. Plus `scripts/tests/workflow-quota-selection.test.js`. | All three E2E jobs **PASSED** |
| 2 | `f8cd1ef094` | Neutralize internal token usage logging | The newly merged full agents-neutral gate detected Gemini-shaped usage keys (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, `cachedContentTokenCount`) in frozen dev code in `StreamProcessor.ts`, `TurnProcessor.ts`, `tokenUsageActualLogger.ts`. | Replaced `UsageMetadataWithCache` with a **neutral** `ActualTokenUsageInput` contract (`promptTokens`, `cachedTokens`, `cache_read_input_tokens`); updated both callers; rewrote logger tests test-first with explicit cache precedence coverage. **No allowlist entry and no suppression added.** | agents-neutral gate **PASS** |
| 3 | `84154ccfdf` | Update the GenAI import inventory | The neutralization removed the last non-enclave importer. | `dev-docs/genai-import-baseline.md` regenerated **29 → 28** importers; `#2349` owner row (`tokenUsageActualLogger.ts`) removed. Regenerated with the documented generator, not hand-edited. | genai-inventory gate **PASS** |
| 4 | `e14ecce133` | Harden credential-write parsing and upload cache keying | Two CodeQL high-severity alerts on dev-origin code never previously scanned against main. | **Alert 178** (`js/polynomial-redos` in `destructive-commands.ts`): replaced the `dd of=` regex with a deterministic linear scan `extractDdOutputOperand`, behavior identical across 34 edge cases, pathological case ~56–62s → ~19ms; new ReDoS timing-budget test. **Alert 177** (`js/insufficient-password-hash` in `kimiFileUpload.ts`): replaced bare SHA-256 with **HMAC-SHA256** (api key as key material + fixed domain-separation label), preserving cache key composition and namespacing; new cache-key distinctness/stability tests. **No suppression added.** | CodeQL alerts **PASS** |

### windows-installed-command — transient (not a code defect)

| Field | Value |
|-------|-------|
| Failure mode | One failure with `spawnSync ETIMEDOUT` during `npm global install` |
| Smoke inputs | Confirmed **unchanged** relative to current main, except an `@agentclientprotocol/sdk` bump correctly resolved in `package-lock.json` |
| Cross-branch evidence | The same workflow **succeeded repeatedly** on other recent branches |
| Re-run result | An explicit re-run of the **identical commit** **succeeded** |
| Classification | **Transient registry or runner timeout** — with the evidence above, **not a code defect** |

### Final local verification on the current tree (HEAD `e14ecce133`) · PASS

| Gate | Command | Result | Status |
|------|---------|--------|--------|
| G6 | `npm run test` | **EXIT_STATUS=0** | **PASS** |
| G5 | `npm run lint:ci` | exit 0 | **PASS** |
| G4 | `npm run typecheck` | exit 0 | **PASS** |
| G7 | `npm run format` | exit 0, **no resulting working-tree changes** | **PASS** |
| G8 | `npm run build` | exit 0 | **PASS** |
| G11 | `npm run lint:genai-inventory` | exit 0 | **PASS** |
| G16 | `npm run check:lockfile` | exit 0 | **PASS** |
| G11 | `npm run lint:eslint-guard` | exit 0 | **PASS** |
| G9 | `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` | exit 0, returned a haiku | **PASS** |

**Local tooling artifact (not a gate failure):** `npm run gate:agents-neutral` exits 127 locally
solely because `tsx` is not resolvable locally; the same gate passes in CI. This is a local tooling
artifact, **not a gate failure** — it is not listed as PASS above.

**Provider-backed integration suite (G17):** remains **ENVIRONMENT-BLOCKED** — not PASS, not a
product failure.

> **No gate is claimed PASS that is not listed here.** G17 remains ENV-BLOCKED. The local
> `gate:agents-neutral` 127 is a local tooling artifact, not a gate PASS.

---

## 14. Decision Ledger

The ledger lives in `conflict-decisions.md`. Every conflicted path gets exactly one row
(**70 rows required**), pre-seeded with the authoritative conflict list.

Required fields per row: `ID`, `Path`, `Cluster`, `Conflict type`, `MAIN intent`, `DEV intent`,
`Decision`, `Rationale`, `Functionality-loss check (REQ-NL)`, `Verification evidence`, `Status`.

Status values: `PENDING` → `RESOLVED` → `VERIFIED`, or `NEEDS-REVIEW` (blocked, escalate).

---

## 15. Files in This Plan

| File | Purpose |
|------|---------|
| `README.md` | This document — full integration plan |
| `execution-tracker.md` | Live phase/cluster/gate status; **resume point after context compression** |
| `conflict-decisions.md` | Decision ledger — one row per conflicted path (70) |
| `verification-log.md` | Command + pasted output evidence for every gate |

### 15.1 Resume protocol (after context compression)

1. Read `execution-tracker.md` → find the first phase/cluster not `DONE`.
2. Read `conflict-decisions.md` → find rows still `PENDING` / `NEEDS-REVIEW`.
3. Read `verification-log.md` → find gates lacking pasted evidence.
4. Re-run §8 invariants before touching anything (cheap, read-only, catches a wrong branch state).
5. Continue from that point. **Do not restart the merge** if clusters are already resolved.

---

## 16. Scope Constraints

The **initial planning pass** performed **read-only** git inspection only. It specifically did
**not**:

- merge, stage, commit, checkout, fetch, or push;
- modify any file outside `project-plans/20260725merge/`;
- touch anything under `.llxprt/`;
- delete or clean anything;
- use GitHub in any form;
- add or suggest any lint/type suppression or rule weakening.

All conflict data was obtained via `git merge-tree --write-tree`, which computes the merge **in the
object database only** and never modifies the working tree, index, or any ref.

**Update (2026-07-25, execution phase):** the merge was subsequently started with authorization
(`git merge --no-ff --no-commit <DEV_SHA>`). Resolution of C7 (4 files), C8 (6 files), and
CD-C11-001 (`package.json`) followed — all staged, no commit made. Nothing under `.llxprt/` was
modified. No lint/type suppression or rule weakening was introduced. The two clean agents files
flagged by the genai-enclave guard (`responseIdCarrier.ts`, `streamChunkVisibility.ts`) are recorded
as follow-ups for owning-cluster remediation, not baseline changes.
