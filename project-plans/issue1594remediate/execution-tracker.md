<!-- @plan:PLAN-20260621-COREAPIREMED @requirement:REQ-001..REQ-007,REQ-INT-001..REQ-INT-004 -->
# Execution Tracker: Core Public Agent API Remediation

Plan ID: PLAN-20260621-COREAPIREMED
Total Phases: 48 (1 preflight + 23 worker + 23 verifier + 1 final eval)
Enables: Issue #1595 (Refactor CLI to consume core API)

> Update this file after EACH phase. A phase is not "done" until its `.completed/PNN.md` marker
> exists AND the paired verifier (`NNa`) has rendered PASS. Execution is STRICTLY sequential:
> 00a → 01 → 01a → 02 → 02a → … → 23 → 23a → 24. NEVER skip numbers. ONE phase = ONE subagent.
> NOTE: Phases 07/07a are the EARLY integration-first CLI turn-parity RED slice (authored BEFORE
> the fromConfig impl that it drives). All former phases 07→22 shifted +1 to 08→23 (final eval 24).

## Execution Status

| Phase | ID | Worker | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|--------|---------|-----------|----------|-----------|-------|
| 00a | P00a | typescriptreviewer | [x] | 2026-06-22 | 2026-06-22 | PASS | N/A | Preflight PASS (deps incl Stryker, CRIT-1/2/3, typecheck clean, vitest run-forms confirmed). Fixed stale H3 path: core/src/core/client.ts → agents/src/core/client.ts |
| 01 | P01 | typescriptexpert | [x] | 2026-06-22 | 2026-06-22 | PASS | [x] | Domain analysis (remediated: added FromConfigOptions.messageBus? CRIT-2 + n/a-for-docs clarifier) |
| 01a | P01a | typescriptreviewer | [x] | 2026-06-22 | 2026-06-22 | PASS | N/A | Verify analysis — PASS after remediation (1 valid defect fixed, 1 finding adjudicated invalid) |
| 02 | P02 | typescriptexpert | [x] | 2026-06-22 | 2026-06-22 | PASS | [x] | Pseudocode (7 components) — PASS after 3 remediation loops: fixed RuntimeProviderManager import contradiction, cleanup-flag header/body mismatch + malformed tail, and getCliRuntimeServices fabrication (real mechanism = providerState reads) |
| 02a | P02a | typescriptreviewer | [x] | 2026-06-22 | 2026-06-22 | PASS | N/A | Verify pseudocode — PASS on 4th pass (exhaustive holistic citation+behavioral+consistency audit of all 7 files; every file:line verified, fences balanced, all invariants hold) |
| 03 | P03 | typescriptexpert | [x] | 2026-06-22 | 2026-06-22 | PASS | [x] | Providers: DECLARED `providerManager?: RuntimeProviderManager` (CRIT-1 structural) + type-only import; construction unconditional (no `??`); +15/-0; typecheck clean |
| 03a | P03a | typescriptreviewer | [x] | 2026-06-22 | 2026-06-22 | PASS | [x] | Verify stub — PASS (all 6 gates + deferred-impl exit 0; messageBus seam intact; exactly 1 construction site; typecheck clean across 15 workspaces) |
| 04 | P04 | typescriptexpert | [x] | 2026-06-22 | 2026-06-22 | PASS | [x] | Providers: `providerManager?` adoption behavioral TDD — RED achieved (480-line file, 10 tests, 40% property). Load-bearing identity RED `handle.providerManager === pm` fails vs P03 unconditional construction (factory:517). Independently re-verified: 7 failed/334 passed (behavioral, not import), zero mock-theater/reverse/skip/cast. Added fast-check ^4.3.0 to providers/package.json. SYSTEMIC GATE FIX (see note below) |
| 04a | P04a | typescriptreviewer | [x] | 2026-06-22 | 2026-06-22 | PASS | [x] | Verify TDD — PASS (no remediation). All 7 gates + 4 cross-checks: 40% property (portable gate works on BSD), RED behavioral 7-failed/334-passed (no module/compile error), stub clean (0 `??`, 1 construction site = CRIT-2 genuine RED), zero seam casts (CRIT-1) |
| 05 | P05 | typescriptexpert | [x] | 2026-06-22 | 2026-06-23 | PASS | [x] | Providers: adoption `options.providerManager ?? new ProviderManager(...)` (flips P04 10/10 GREEN) + 7-site CRIT-1 widening (factory) + ADJUDICATED cross-pkg widening of 3 agents sites (createAgent.ts:222/301, agentImpl.ts:120) — P09:69-73 prereq surfaced early; only listProviders() used; INDEP-VERIFIED typecheck CLEAN all 15 ws, runtime 341/341, construction=1, zero `any`/`as` |
| 05a | P05a | typescriptreviewer | [x] | 2026-06-22 | 2026-06-22 | PASS | [x] | Pseudocode-compliance gate + semantic — PASS (no remediation). INDEP: adoption 10/10, construction=1, CRIT-1 gate PASS, cross-pkg typecheck CLEAN all 15 ws, agents widening type-only (only listProviders() used, 0 any/as), runtime 341/341, line-by-line pseudocode realized, cleanup no-disposal verified, deferred scan clean |
| 06 | P06 | typescriptexpert | [x] | 2026-06-22 | 2026-06-22 | PASS | [x] | `fromConfig` + `FromConfigOptions` (incl. `readonly config: Config` + `messageBus?: MessageBus`) stub; DECLARES `getConfig()` on Agent interface exactly once (agent.ts:333) with a NotYetImplemented stub body (agentImpl.ts:676, does NOT return deps.config — real impl deferred to P09, CRIT-2); createAgent signature unchanged. CCF-2 applied (Prettier-canonical multi-line stub + whitespace-normalized gate). typecheck+prettier clean |
| 06a | P06a | typescriptreviewer | [x] | 2026-06-22 | 2026-06-22 | PASS | [x] | Verify stub — PASS (no remediation). INDEP: full block ends OK, typecheck exit 0 all 15 ws, prettier clean all 5 files (CCF-2 verified), FromConfigOptions canonical in config-types.ts:214 w/ messageBus?, getConfig declared once + NotYetImplemented stub (not deps.config), fromConfig exported index.ts:13, createAgent.ts:71 unchanged, no parallel/dup files, 0 any/as |
| 07 | P07 | typescriptexpert | [x] | 2026-06-22 | 2026-06-23 | PASS | [x] | EARLY integration-first CLI turn-parity RED slice (3 files: cli-turn-parity.early.spec.ts + helpers/buildCliStyleConfig.ts + fixtures/parity-toolcall.jsonl; 33% property; object-form AgenticLoop Path-B reference; FakeProvider fixture). Behavioral-RED EXIT 1 / 3 failed. Boundary REGRESSION found+fixed (2 deep core type-imports rerouted via scan-exempt helper re-export; boundary.spec.ts 5/5 GREEN). CCF-3 (test-invocation) + CCF-4 (stale-dist rebuild) applied; frozen-hashes regenerated |
| 07a | P07a | typescriptreviewer | [x] | 2026-06-23 | 2026-06-23 | PASS | [x] | Verify RED-before-green — PASS. INDEP (typescriptreviewer): behavioral RED EXIT 1 / 3 failed (no module/compile/import err), boundary.spec.ts 5/5 GREEN, typecheck exit 0 all 15 ws, 33% property, all guards (mock/reverse/deep-import/object-form) clean. Coordinator post-verify: ran down 'not a function' RED → STALE pre-P06 dist via bare-specifier alias (CCF-4); `npm run build` → bare-root fromConfig=function, slice still RED w/ stronger `NotYetImplemented`; P09 can now GREEN it |
| 08 | P08 | typescriptexpert | [x] | 2026-06-23 | 2026-06-23 | PASS | [x] | `fromConfig` behavioral TDD: fromConfig.behavior.test.ts (22 tests = 15 behavioral + 7 property = 31%). Behavioral-RED EXIT 1 / 21 failed \| 1 passed (NotYetImplemented from P06 stub; 1 pass = T7b createAgent contrast anchor). Covers getConfig()/SettingsService identity, provider/model adoption, config-missing validation rejection (not stub string), runtimeId determinism, CRIT-1 adopted-manager identity + single-manager turn-drive, CRIT-2 caller-bus identity + no Config.getMessageBus, REQ-001.3 ownership (fromConfig Config NOT disposed vs createAgent contrast), caller-bus FUNCTIONAL after dispose. Reuses buildCliStyleConfig + fixtures + disposalProbe. One verifier-FAIL round: 3 defects (D1 docblock 'reverse test' literal tripped scoped scan; D2 T6b mislabeled+vacuous; D3 T7c vacuous toBeDefined) all fixed + re-verified. No deep imports (boundary 5/5), typecheck exit 0, prettier clean |
| 08a | P08a | typescriptreviewer | [x] | 2026-06-23 | 2026-06-23 | PASS | [x] | Verify TDD — PASS (after 1 remediation round). INDEP (typescriptreviewer): RED EXIT 1 / 21 failed \| 1 passed, all fromConfig tests behavioral-RED (NotYetImplemented, 0 module/compile/import err), 31% property (7/22), all anti-pattern guards 0 (mock/reverse/skip/deferred), no deep imports + boundary.spec.ts 5/5, scoped deferred/reverse scan PASS, typecheck exit 0 all 15 ws, prettier clean. Semantic: T6b title-matches-body + non-vacuous (adopted-manager identity before+after driven turn + one done); T7c real post-dispose bus usability (listenerCount survives/grows/collapses, would FAIL if torn down); no vacuous/tautological/mislabeled/reverse tests. Defects: none |
| 09 | P09 | typescriptexpert | [ ] | - | - | - | [ ] | `fromConfig` impl (cite config-injection-seam.md lines 10–78); implements real `getConfig()` (replaces P06 stub — CRIT-2); makes P07 slice GREEN |
| 09a | P09a | architect | [ ] | - | - | - | [ ] | Pseudocode-compliance gate + semantic + early-slice content-hash integrity |
| 10 | P10 | typescriptexpert | [ ] | - | - | - | [ ] | Settings surface: three ephemeral methods (stub on Agent interface+impl); references existing `getConfig` (declared P06, implemented P09) |
| 10a | P10a | architect | [ ] | - | - | - | [ ] | Verify stub |
| 11 | P11 | typescriptexpert | [ ] | - | - | - | [ ] | Settings behavioral TDD (delegation, normalization) |
| 11a | P11a | architect | [ ] | - | - | - | [ ] | Verify TDD |
| 12 | P12 | typescriptexpert | [ ] | - | - | - | [ ] | Settings impl (cite settings-surface.md lines) |
| 12a | P12a | architect | [ ] | - | - | - | [ ] | Pseudocode-compliance gate + semantic (no parallel store) |
| 13 | P13 | typescriptexpert | [ ] | - | - | - | [ ] | `getCurrentSequenceModel` behavioral TDD (delegate, rebind) |
| 13a | P13a | architect | [ ] | - | - | - | [ ] | Verify TDD |
| 14 | P14 | typescriptexpert | [ ] | - | - | - | [ ] | `getCurrentSequenceModel` impl (cite get-current-sequence-model.md) |
| 14a | P14a | architect | [ ] | - | - | - | [ ] | Pseudocode-compliance gate + semantic |
| 15 | P15 | typescriptexpert | [ ] | - | - | - | [ ] | Contract promotion TDD + non-breaking export characterization |
| 15a | P15a | architect | [ ] | - | - | - | [ ] | Verify TDD (RED is a TYPE error; no reverse tests) |
| 16 | P16 | typescriptexpert | [ ] | - | - | - | [ ] | Promote `AgentClientContract` on curated `api/index.ts` |
| 16a | P16a | architect | [ ] | - | - | - | [ ] | Pseudocode-compliance gate + semantic |
| 17 | P17 | typescriptexpert | [ ] | - | - | - | [ ] | `getRuntimeId` + no-second-manager behavioral TDD |
| 17a | P17a | architect | [ ] | - | - | - | [ ] | Verify TDD |
| 18 | P18 | typescriptexpert | [ ] | - | - | - | [ ] | `getRuntimeId` impl + adopt-runtime wiring (cite provider-runtime-seam.md) |
| 18a | P18a | architect | [ ] | - | - | - | [ ] | Pseudocode-compliance gate + semantic |
| 19 | P19 | typescriptexpert | [ ] | - | - | - | [ ] | BROADER CLI-parity integration CHARACTERIZATION / parity-expansion + verification gate (NOT RED TDD; the RED driver is P07); reuses P07 helper/fixture |
| 19a | P19a | architect | [ ] | - | - | - | [ ] | Verify integration characterization/expansion gate (real FakeProvider, parity, ≥30% property; passing suite is success) |
| 20 | P20 | typescriptexpert | [ ] | - | - | - | [ ] | Make broad parity harness green end-to-end (no production stubs remain) |
| 20a | P20a | architect | [ ] | - | - | - | [ ] | Semantic: parity proven, single terminal done; frozen-test content-hash guard |
| 21 | P21 | typescriptexpert | [ ] | - | - | - | [ ] | No-deep-import boundary scan + non-breaking characterization |
| 21a | P21a | architect | [ ] | - | - | - | [ ] | Verify boundary + non-breaking (export diff) |
| 22 | P22 | typescriptexpert | [ ] | - | - | - | [ ] | docs/agent-api.md updates (REQ-007) |
| 22a | P22a | architect | [ ] | - | - | - | [ ] | Verify docs accuracy against code |
| 23 | P23 | typescriptexpert | [ ] | - | - | - | [ ] | Full suite (test/lint/typecheck/format/build + smoke) + mutation ≥80% |
| 23a | P23a | architect | [ ] | - | - | - | [ ] | Verify gates output (independent re-run) |
| 24 | P24 | architect | [ ] | - | - | - | N/A | Final plan-quality & adequacy evaluation |

Legend: Status `[ ]` pending / `▶` in-progress / `✔` complete. "Semantic?" = whether semantic
verification (feature actually works) was performed, not just structural marker checks.

## REQ → Phase Coverage

| Requirement | Worker phases | Verifier phases | Status |
|---|---|---|---|
| REQ-001 (fromConfig; incl. REQ-001.2 `getConfig` identity DECLARED in 06, IMPLEMENTED/GREEN in 09) | 06, 08, 09 | 06a, 08a, 09a | [ ] |
| REQ-002 (settings surface — ephemeral get/set/getAll; `getConfig` identity REQ-002.2 shared with REQ-001.2, DECLARED in 06 / IMPLEMENTED in 09, not re-declared here) | 10, 11, 12 | 10a, 11a, 12a | [ ] |
| REQ-003 (getCurrentSequenceModel) | 13, 14 | 13a, 14a | [ ] |
| REQ-004 (contract promotion) | 15, 16 | 15a, 16a | [ ] |
| REQ-005 (`providerManager?` seam + getRuntimeId / adopt runtime) | 03, 04, 05, 09, 17, 18 | 03a, 04a, 05a, 09a, 17a, 18a | [ ] |
| REQ-006 (non-breaking) | 03, 05, 15, 21 (+ every impl) | 03a, 05a, 15a, 21a | [ ] |
| REQ-007 (docs) | 22 | 22a | [ ] |
| REQ-INT-001 (CLI Config adoption) | 07, 09, 19 | 07a, 09a, 19a | [ ] |
| REQ-INT-002 (turn-drive parity) | 07, 09, 19, 20 | 07a, 09a, 19a, 20a | [ ] |
| REQ-INT-003 (settings adequacy) | 11, 12, 19 | 11a, 12a, 19a | [ ] |
| REQ-INT-004 (no-deep-import) | 07, 19, 21 | 07a, 19a, 21a | [ ] |

## Gap → Closure Tracking (the six gaps)

| Gap | REQ | First proven adequate at | Closed? |
|---|---|---|---|
| C1 Config-injection seam | REQ-001, REQ-INT-001 | `getConfig()` identity DECLARED P06 + IMPLEMENTED/GREEN P09; early parity P07 (RED) → P09 impl (green; adopts CLI-style Config); broad P19/P20 | [ ] |
| C2 Agent settings/config surface | REQ-002, REQ-INT-003 | ephemeral methods P10–P12 impl; `getConfig` identity shared with C1 (DECLARED P06 / IMPLEMENTED P09, not re-declared); P19 parity (settings round-trip) | [ ] |
| C3 turn-drive via public API | REQ-INT-002 | early P07 (RED) → P09 (green); broad P19/P20 parity green | [ ] |
| H1 client-contract promotion | REQ-004 | P16 impl (curated API-barrel type export) | [ ] |
| H2 provider-runtime reachability | REQ-005, REQ-001.2 | P05 `providerManager?` seam; P09 adopt-runtime; P17/P18 getRuntimeId + no-second-manager | [ ] |
| H3 getCurrentSequenceModel stub | REQ-003 | P14 impl | [ ] |
## Cross-Cutting Fixes (apply to all downstream phases)

### CCF-1 — Property-gate BSD/GNU portability (applied 2026-06-22, during P04)

The shared "≥30% property-based CASES" gate (present in 14 plan files: 04, 04a, 07, 07a, 08, 08a,
11, 11a, 13, 13a, 17, 17a, 19, 19a) used two non-portable shell constructs that SILENTLY MISCOMPUTED
the ratio on the macOS execution host (BSD awk `version 20200816`):

1. `awk '/\bit\(|\btest\(/ {...}'` — BSD awk does NOT support the `\b` word-boundary escape, so the
   `CLASSIC_PROP_BLOCKS` counter matched ZERO blocks and the gate computed 0% even for a genuinely
   40%-property suite (proved via control test: `printf 'it(\n' | awk '/\bit\(/' ` emits nothing on
   BSD awk). This would spuriously FAIL P04a and every downstream TDD verifier (08a/13a/17a/19a) on
   this machine.
2. `TOTAL=$(grep -cE ... "$T")` / `PROP_CASE_FORMS=$(...)` — `grep -c` exits 1 on zero matches; under
   the spec's `set -e` this ABORTED the whole gate before printing (PROP_CASE_FORMS is legitimately 0
   because the suites use classic `fc.property`, not `it.prop`).

FIX (validated on real P04 file = 40% PASS, on synthetic low-prop file = correct FAIL, on synthetic
`it.prop` file = correct 50% PASS, all under `set -e`):
- Replaced every `\bWORD\(` with the POSIX-portable boundary `(^|[^A-Za-z0-9_])WORD\(` in both grep
  and awk (works identically on BSD + GNU).
- Added `|| true` to the two single-file `grep -cE` assignments (TOTAL, PROP_CASE_FORMS) so a
  legitimate zero count cannot abort under `set -e`. (The 5 multi-file forms in 07/07a/13a/19/19a pipe
  `grep -rhcE … | awk`, where the pipe already masks grep's exit, so they needed only the `\b` fix.)
The gate's STRICTNESS is unchanged — it still fails genuine sub-30% suites; only the false-negative on
BSD + the `set -e` abort were removed. Backups: /tmp/gatefix_bak/. Downstream worker/verifier phases
will now see the portable form; no per-phase action required.

### CCF-2 — `getConfig` stub gate is Prettier-hostile (applied 2026-06-22, during P06)

The P06 + P06a specs gated the `agentImpl.getConfig` NotYetImplemented stub with a LINE-BASED regex
`getConfig\(\)\s*:\s*Config\s*\{[^}]*NotYetImplemented`. Because `[^}]*` cannot span a newline, this
forced the stub onto a SINGLE line — but Prettier formats it across THREE lines
(`getConfig(): Config {⏎ throw new Error('NotYetImplemented');⏎ }`). The single-line form needed to
satisfy the grep FAILS `prettier --check` (and thus `npm run format` / P23), while the Prettier-clean
multi-line form FAILS the grep. A genuine spec/formatter contradiction (same class as MIN-4 / CCF-1).

FIX (validated: stub now passes `prettier --check`; positive gate MATCHES the multi-line stub when
whitespace-normalized; negative `return this.deps.config` guard still MATCHES a hypothetical multi-line
real impl → strictness preserved):
- Implementation: `agentImpl.getConfig` is the Prettier-canonical MULTI-LINE stub (prettier-clean).
- Both specs (06, 06a): the two `getConfig`-body greps now run against
  `IMPL_NORM=$(tr -s '[:space:]' ' ' < …/agentImpl.ts)` (all whitespace incl. newlines collapsed to
  single spaces) BEFORE matching — identical technique to the adoption-`??` gate (P05a/MIN-4). The
  positive NotYetImplemented gate and the negative deps.config guard both keep full strictness.
No other phase references this stub gate; no further per-phase action required.

### CCF-3 — Single-file test invocation is a FALSE-RESULT hazard (applied 2026-06-23, during P07)

Every TDD/parity/impl gate used `npm test --workspace <pkg> -- run <path>` (55 occurrences across 31
plan files). On this repo that form decouples the gate's EXIT status from the intended target in TWO
independent ways (both empirically reproduced):

1. **Stray `run` (false EXIT 0).** Each package `test` script is already `vitest run`, so `-- run <path>`
   appends a SECOND `run` token. vitest treats positionals as filename filters; the bare word `run`
   matches ~17 unrelated `*runtime*` files. A RED slice (which should make the gate's `STATUS -eq 0`
   check fail) instead runs those passing files → **EXIT 0** → a non-RED slice would be falsely accepted.
2. **Root-relative path under package cwd (false EXIT 1).** `npm --workspace` runs with cwd = the
   package dir, so a ROOT-RELATIVE `packages/<pkg>/…` path matches NOTHING → "No test files found,
   exiting code 1". A GREEN gate keyed on EXIT 0 would falsely fail; worse, a RED gate keyed on
   `STATUS -ne 0` would "confirm RED" while NO test ran.

This was discovered during P07's independent RED re-verification: the spec-form command reported EXIT 0
running 17 wrong files, masking the genuine behavioral RED of `cli-turn-parity.early.spec.ts`.

FIX (validated across ALL invocation shapes — single-file RED EXIT 1 / single-file GREEN EXIT 0 with
`providerManagerAdoption` reporting `10 passed` / directory / multi-file / `${SEQ[@]}` array): replace
the whole prefix `npm test --workspace <pkg> -- run ` with `npx vitest run ` (run from repo ROOT). vitest
auto-discovers the nearest package `vitest.config.ts` and resolves its RELATIVE `setupFiles:
'./test-setup.ts'` against that config's own directory — so providers tests load their setup correctly
(the `-c packages/providers/vitest.config.ts` alternative was REJECTED because, run from root, it
resolves `./test-setup.ts` against the wrong cwd → "Cannot find module …/test-setup.ts", a false-RED).
Because paths stay ROOT-RELATIVE, every `$SPEC`/`$T`/`$F`/`$SPECS`/`$DIR`/`${SEQ[@]}` variable and every
`test -f` guard is preserved verbatim — the change is a single literal substitution. 00a's prose +
canonical-command rationale were updated to teach the new form and forbid reverting. Backups:
/tmp/ccf3_bak/. Downstream worker/verifier phases will now see the portable form; no per-phase action
required.

### CCF-4 — Stale `dist/` hides NEW top-level exports under the bare-specifier alias (applied 2026-06-23, during P07a)

A NEW public export added in src (e.g. P06's `fromConfig` on the agents root barrel) can be INVISIBLE on
the bare package specifier `@vybestack/llxprt-code-agents` at test time even though it is present and
correct in source. Mechanism: the agents `vitest.config.ts` workspace-alias plugin rewrites ONLY the
bare root specifier to `packages/agents/index.ts` (and `agentsPackagePrefix` subpaths to src). But that
entry's own `export * from './src/index.js'` (and the deeper `export * from './api/index.js'`) are NOT
matched by the alias, so Vite resolves them via `package.json` `exports['.'] -> ./dist/index.js`. When
`dist/` is STALE (built before the new export existed), the bare root surfaces the OLD shape:
pre-existing symbols (e.g. `createAgent`) resolve fine, but the new symbol (`fromConfig`) resolves to
`undefined` → a test calling it fails with `TypeError: (0, fromConfig) is not a function` instead of the
intended stub behavior. PLAN.md:733-737 legitimately whitelists "not a function" as an acceptable
behavioral RED, so a verifier can PASS the phase while this trap silently lurks — and it would block the
LATER green phase (P09) from ever turning the slice GREEN (the binding would still be `undefined` after
the body is implemented).

DIAGNOSIS (layered runtime probes under the real vitest resolver): relative `import * from '../../index.js'`
(src/index.ts) AND `'../../../index.js'` (top index.ts) BOTH exposed `fromConfig = function`; the bare
specifier exposed `fromConfig = undefined` while `createAgent = function`; stale `dist/src/api/index.js`
(dated pre-P06) had `fromConfig` count 0. FIX: `npm run build --workspace @vybestack/llxprt-code-agents`
(rebuilds dist; `dist/` is GITIGNORED → zero source/git footprint). POST-BUILD: bare-root `typeof
fromConfig === 'function'`; the P07 slice remained RED (EXIT 1, 3 failed) but for the STRONGER correct
reason `Error: NotYetImplemented` (the genuine P06 stub), proving P09 can turn it GREEN.

STANDING RULE for downstream phases: any phase that (a) adds a NEW top-level export and is exercised
through the BARE package specifier, or (b) runs a directory/characterization gate that loads the bare
specifier or cross-package consumers, MUST run `npm run build` (or at least build the affected package)
BEFORE the test/verification gate. This is the same precaution already noted for P09a/P12a/P14a/P16a/
P18a/P20 re: the pre-existing core export-map (`schedulerSingleton.js`/`skillManager.js`) misses — a
single `npm run build` clears both classes.


## Completion Markers Checklist

- [ ] Every phase has a `.completed/PNN.md` marker with pasted verification output.
- [ ] Every phase's code carries `@plan:PLAN-20260621-COREAPIREMED.PNN` markers.
- [ ] Every requirement has `@requirement` markers in the corresponding code/tests.
- [ ] No phases skipped in sequence (00a → … → 24).
- [ ] Strict NN → NNa → NN+1 sequencing (per `dev-docs/COORDINATING.md`): every worker phase NN
      (NN ≥ 01) lists the PRIOR phase's VERIFIER (NN-1)a as its Prerequisite (e.g. P14 requires P13a,
      P16 requires P15a, P18 requires P17a, P20 requires P19a, P07 requires P06a) — never a bare
      worker where a verifier exists. Each verifier NNa requires its own worker NN.
- [ ] Phase 23 full suite green (test/lint/typecheck/format/build + smoke haiku via `ollamakimi`).
- [ ] Phase 23 mutation ≥80% on changed production files.
- [ ] Phase 24 `plan-evaluation.json` shows `builds_in_isolation:false`, `enables_1595:true`, all
      gaps closed.
