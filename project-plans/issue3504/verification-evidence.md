# Issue #3504 verification evidence

All logs under `tmp/verify3504/` (gitignored). Date: 2026-09-08.

## Focused file: packages/agents/src/core/subagent.runNonInteractive-term.test.ts

Final file state = AC1-AC5 implementation + review fixes (interactive-timeout
finally disposes scope; beforeEach guard throws Error instead of standalone
expect) + eslint compliance fixes. 13 tests (original 12 + AC5 regression).

| Check | Runs | Result | Log |
|---|---|---|---|
| Isolation determinism | 10 | 13 pass / 0 fail each, 0 nonzero exits | `matrix-final.log` |
| Under-load determinism (6 CPU burners) | 20 | 13 pass / 0 fail each, 0 nonzero exits | `matrix-final.log` |
| Post-lint-fix spot runs | 3 | 13 pass / 0 fail each | `lintfix-term{,2,3}.log` |
| Independent reviewer runs (3 iso + 1 under 4 burners) | 4 | 13 pass / 0 fail each | `review-term{,2,3}.log`, `review-term-load.log` |
| Inside full concurrent agents runner (concurrency 4, 401 files) | 1 | file passed; runner verdict `Passed 400/401 test files (1 failed)` | `verify-full-test.log` |

37 clean focused executions total, including 25 under deliberate CPU
contention — the exact #3504 failure environment.

## Root verification chain

Build-order note: root lint/typecheck resolve cross-package types from
`packages/*/dist`; always `npm run build` before lint/typecheck or stale dist
produces phantom errors (observed: 12 phantom strict-boolean-expressions in
cli + TS6305/TS2307; both vanish after fresh build; cli lint on pristine main
with fresh dist: exit 0).

| Step | Result | Log |
|---|---|---|
| `npm run build` | exit 0 | `verify-chain.log` |
| `npm run lint` (post-build, full) | exit 0 | `lint-full-postbuild.log` |
| `npm run typecheck` (post-build) | exit 0 | `typecheck-postbuild.log` |
| `npm run format` | exit 0, no tree changes | `verify-chain.log` |
| `npm run test` (all workspaces) | exit 1 — 100% attributable to pre-existing skills failures (below) | `verify-full-test.log` |
| Smoke `stepfun-37` haiku | exit 0, clean completion | `smoke.log` |

## Full-suite failure attribution (7 real failures, all pre-existing)

Proven on pristine main via stash/re-run for every file:

| File | Fails | Main proof | Log |
|---|---|---|---|
| agents `skillReloadDeclaration.behavior.test.ts` | 5 tests | identical 0 pass / 5 fail on main | `skillreload-main.log` |
| core `extensionSkillRefresh.test.ts` | 1 (`rediscovers once for a batch of concurrent loads`) | identical on main | `core-skills-main.log` |
| core `skillManager.test.ts` | 1 (`should filter disabled skills in getSkills but not in getAllSkills`) | identical on main | `core-skills-main.log` |

Filed/commented as #3611. Remaining `(fail)` lines in the suite log (4x
`fails`/`hangs` with sub-ms durations) are deliberate fixtures spawned by
passing timeout-classification meta-tests, not real failures.

## Lint policy exception

File is 1045 lines (838 counted vs max-lines 800). Sanctioned pattern:
tagged block `eslint-policy-allow-off: #3504` in eslint.config.js with a
bounded raise to `max: 900` mirroring the #3240 precedent (rule stays
'error' — further growth re-fails lint and forces the deferred split).
`jest/no-standalone-expect` resolved by throwing an Error in beforeEach
instead of a bare expect.

## Compliance review (cycle 1 of ≤2)

Verdict: AC1-AC6 all MEET, findings NONE. Log paths in review outputs
(`review-term*.log`). Non-findings noted deliberately: belt-and-braces
rejection absorbers; un-awaited `runRejection` in finally (anti-hang by AC3).

## OCR review (2 cycles, zai-anthropic glm-5.3, model verified in manifests)

Round 1 (`ocr-branch.json`, 4 comments):

- [0] max-lines 'off' → bounded raise 900 (#3240 precedent): **Fixed**
  (adopted, mirrored precedent format).
- [1] extract shared cleanup helper across 6 finally sites: **Rejected** —
  sites have deliberately different shapes (conditional resolve,
  unconditional dispose, optional chaining); late-cycle churn of verified
  safety-critical code for style; invariant enforced by beforeEach guard +
  regression test.
- [2] bound the settlement `await`s with the settled-observer pattern:
  **Deferred to #3612** — hang mode is pre-existing (not a regression),
  fix adds ~50 lines to an over-cap file and re-opens all hardened sites.
- [3] split the file instead of overriding: **Rejected** — contradicts
  policy-sanctioned tagged raise + AC6; kernel (unbounded growth) resolved
  by the bounded raise.

Round 2 (`ocr-round2.json`, 3 comments — findings-verification only):

- Helper-extraction repeat: **Rejected** (as round 1 [1]).
- Threshold-raise-is-weakening (x2): raise **stands** — mirrors the #3240
  precedent merged on main; reviewer acknowledged the precedent. Legitimate
  kernel adopted: the split follow-up was untracked → **filed #3613** and
  referenced in the eslint banner ("split tracked in #3613").

Follow-ups filed from review: #3612 (bounded settlement waits), #3613
(file split + drop the override).
