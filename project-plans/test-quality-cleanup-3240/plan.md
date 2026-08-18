# Plan: Test-Quality Cleanup — false greens, structural clones, and a repeatable audit methodology

Plan ID: PLAN-20260818-TESTQUALITY
Issue: #3240 (milestone 0.11.0, type Task, label Code Quality / Modularization)
Generated: 2026-08-18
Evidence base: `research/useless-test-detection-2026-08.md` (full methodology,
not tracked — not regenerable from the scanner alone; it includes human
triage and per-file timing data), `research/test-audit-report-2026-08.md`
(summary, not tracked), `tmp/test-audit/` (raw data: findings.tsv,
triage.tsv, actionable-sites.tsv, timings.tsv, aggregate.md — not tracked).
The scanner (`bun scripts/test-audit/scan.ts`) regenerates `findings.tsv`
and `file-stats.tsv` only; the triage, timing, and aggregate artifacts were
produced by separate manual and scripted processes documented in the
research files.
The 34 actionable sites and their triage reasons are summarized in the
evidence table below. (Note: `oauth-manager.issue1468.case-11.spec.ts` was
also proactively fixed during the review cycle but was not one of the 34
triaged sites — it is tracked as a proactive improvement, not as part of
the triaged count.)

## Why we are doing this

The 2026-08 audit scanned all 2,677 test files with an AST scanner
(2,118 findings), human-equivalent triaged 175 sites with citations
(34 REAL / 27 intentional / 114 false positives), and timed all 731 flagged
files individually. Three facts drive this plan:

1. **The suite is healthy overall** — only ~1.6% of findings (34 of 2,118)
   are real, and confirmed-bad tests cost ~5 seconds of CI total. So this is
   NOT a CI-time effort and NOT a quarantine effort (a skip-experiment would
   have nothing measurable to show).
2. **The one real pattern is mock theater** — a stub is configured to return
   literal X and the assertion expects X back through a plain reference
   (57.5% confirmed-real precision, the only precise rule; generic test-smell
   heuristics measured 0–17%). These tests pass forever even if the
   production logic is wrong. They are false confidence, and they are
   concentrated: promptMemoryPolicy ×7, npm-command ×6, oauth-manager ×6.
3. **Three structural clone suites** are pure duplication that has already
   started to drift (A1's two copies differ by ~29 lines of validators that
   exist only in the core copy). A fourth candidate (useToolScheduler,
   ~2,600 duplicate lines) was identified but deferred as out of scope.

Era analysis (rename-chain corrected): HIGH-tier false-green density fell
1.75% → 0.42% across process eras, with a transient bump to 1.01% during the
bun migration. The suite is not hollowing out; the goal is to keep it that
way with a cheap quarterly check.

## What we are deleting, and why it is safe

| Item | Action | Safety evidence |
|---|---|---|
| A1 `core/src/debug/DebugLogger.test.ts` (41 tests) | Delete; replace with a symbol-identity re-export contract | Impl is a 176-byte re-export shim of `@vybestack/llxprt-code-telemetry`; the behavioral suite already exists in the telemetry package; the core copy has drifted (29 lines of test-local validators only there — stale) |
| A2 `core/src/policy/policy-engine.test.ts` (47 tests) | Delete; replace with a re-export contract | Diff is strictly one-directional: 10 workspace-only tests are newer coverage; zero tests exist only in the core copy. Nothing is lost |
| A3 `storage/.../secure-store.fallback2.test.ts` (13 tests) | Delete (merge 2 unique permission intents into `fallback.test.ts`) | 11 of 13 tests are duplicates of tests already in `fallback.test.ts`; the 2 unique permission-intent tests were merged into `fallback.test.ts` (+57 lines). Remaining coverage (envelope, legacy/corruption, missing-key) is distributed across `fallback-v2.test.ts`, `dual-mode.test.ts`, `integration.test.ts`, `envelope-codec.test.ts`, `basic.test.ts`, and `fallback-behavior.test.ts` in the same package |
| 34 confirmed REAL test sites | Rewrite assertions to derived/transformed properties | Each row in the audit's actionable-sites.tsv carries a triage reason; the 34 sites span: `promptMemoryPolicy.test.ts` ×7, `npm-command.test.ts` ×6, `oauth-manager.spec.ts` + `issue1468.case-{10,12,13}` ×7, `auth-integration.spec.ts` ×3, `config.b2.test.ts` ×3, `tokenUsagePrivacy.test.ts` ×1, `ConversationCache.accumTokens.test.ts` ×1 (TIMER_ASSERT), `prompt-installer.test.ts` ×1 (ALWAYS_TRUE), `FileOutput.test.ts` ×2 (ALWAYS_TRUE, core+telemetry), `useInputHistoryStore.test.ts` ×1 (MOCK_MIRROR), `slashCommandProcessor.test.tsx` ×1 (MOCK_MIRROR), `open-files-manager.test.ts` ×1 (MOCK_MIRROR), `app.test.ts` ×1 (MOCK_MIRROR). Fixes satisfy the "delete the implementation → test fails" litmus from the typescript-test-writing skill |

Supersedes: `project-plans/verification/mock-theater-detector.ts` (an earlier
text-based prototype from a prior issue's plan space; the AST scanner
in `scripts/test-audit/` replaces it — old file left untouched as historical
plan material).

## What we are adding

1. **`scripts/test-audit/scan.ts`** — the audit scanner promoted to durable
   tooling: exported functions, CLI guard (`import.meta.main`), output-dir
   argument, license header. Behavioral test over a fixture with known smells
   lives in `scripts/tests/`.
2. **Quarterly funnel (documented in the script header + this plan):**
   run scan (seconds) → triage MOCK_MIRROR hits only → watch two trend
   numbers (MOCK_MIRROR per 1k tests; HIGH/test by era, baseline 0.42%).
   **Limitation:** the scanner does not currently emit severity levels or
   era-tag metadata. Trend analysis requires manual classification of
   findings.tsv against the era boundaries (E0–E3) from the process study.
   Adding severity/era columns to the scanner output is a follow-up
   enhancement tracked separately.
3. **Skill rule** in `.llxprt/skills/typescript-test-writing/SKILL.md`:
   the concrete mirror-echo formulation ("never assert the literal a stub was
   configured with…") + scanner pointer. The existing "Direct-value mock"
   prohibition stays; the new section makes it concretely checkable.

## Phases

- Phase 1: Scaffolding — plan doc (this file), scanner promotion + fixture +
  behavioral test, skill update.
- Phase 2: Consolidations A1–A3 + core/agents fixes (promptMemoryPolicy ×7,
  config.b2 ×3, prompt-installer, telemetry/FileOutput).
- Phase 3: providers/auth/a2a/vscode/scripts fixes (oauth-manager ×6,
  auth-integration ×3, ConversationCache, open-files-manager, app.test.ts,
  npm-command ×6 incl. 2 post-catch guards).
- Phase 4: deepthinker review + full verification cycle + OCR + PR.
- Phase 5 (this issue, thinking deliverable): overlapping-tests analysis
  write-up (below).

## Overlapping layered tests — the next question (not answered by this PR)

The audit answered "are tests fake?" but not "are tests redundant across
layers?" The concern, concretely: Module A calls B calls C. TestModuleA
(integration-style) already exercises B's and C's behavior through A.
TestModuleB then re-tests the same behaviors at unit level and adds nothing;
likewise TestModuleC. This wastes maintenance effort and — worse — doubles
the surface that must be updated on every refactor, and can pin conflicting
interpretations of the same contract.

Proposed detection method (cheap, reuses what the audit built):

1. **Coverage-vector subsumption**: per test file, collect the set of
   production functions it executes (per-file coverage runs; the audit
   already did per-file timing so the harness exists). Build the
   TestModuleA ⊇ {functions of B, C} map. Candidates = test files whose
   *unique* covered-function set vs. every higher-layer test is empty.
   This is the UNIBE partial-order method with tolerance; pilot already
   proved the file-level version (A3 duplicate coverage).
2. **Assertion-target overlap**: for candidate pairs, extract what each test
   asserts (AST: the properties/fields compared). A unit test is only
   redundant if its assertion targets ⊆ the integration test's AND it adds
   no failure mode the integration test cannot reach (e.g., error paths the
   top layer swallows).
3. **LLM triage of candidate pairs only** — same funnel discipline that
   worked here: precise mechanical filter first, judgment on the residue.
4. Decision rule per redundant unit test: delete, OR narrow to the failure
   modes the integration test cannot express (usually error/edge branches),
   OR promote to the contract owner. Do NOT blanket-delete unit tests:
   layered tests intentionally overlap when each layer owns different
   failure modes.

This becomes a follow-up issue with its own plan; deliverable for #3240 is
the method write-up (this section) so the roadmap is complete.

## Verification

Per llxprt-issue-workflow: full cycle (`npm run test`, `lint`, `typecheck`,
`format`, `build`, stepfun-37 smoke), deepthinker review, OCR before push,
CI watch, CodeRabbit resolution. No merge without user approval.
