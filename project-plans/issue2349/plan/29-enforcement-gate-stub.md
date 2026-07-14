# Phase 29: Enforcement gate — STUB

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P29`

## Prerequisites
- Required: Phase 28 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P28" packages/agents/src`
- Expected files from previous phase: agent-loop tests migrated off `{candidates}`/Google fixtures; characterization allow-list finalized with LOCAL structural fixtures (no `@google/genai` imports — Minor 3).
- Preflight verification: Phase 0.5 completed — check 9 (AST parser available) PASS.
- Required: Phase 02 completed — the gate SKELETON (`scripts/agents-neutral-gate.ts` with parser plumbing, `checkF` structural matchers, working `--count`) and the artifacts (`dev-docs/agents-neutral-gate-allowlist.md`, `dev-docs/agents-neutral-gate-baseline.md`) ALREADY EXIST from P02. This phase EXTENDS that skeleton toward the full fail-mode gate; it does NOT create the script from scratch (Major 5).
- Pseudocode: `analysis/pseudocode/enforcement-gate.md`.

## Relationship to the P02 skeleton (Major 5 + Critical 2 — do NOT regress P02-real checks)
P02 landed the early skeleton (parser plumbing + `checkF` F1/F3/F5 + `toGeminiContent(s)` call matcher +
working `--count`/`--by-file` + allow-list/baseline artifacts) **AND REAL fail-mode bodies for the cheap
#2424 vectors `checkA_rawGenaiImports` / `checkB_bannedSymbols` / `checkC_contractAliases` /
`checkE_enumRedeclarations` behind `--enforce-imports` (Major 6)** so the shrink-ratchet was AST-precise
AND the literal #2424 import/alias/enum vectors were HARD-ENFORCED per-slice from the first migration slice.

> **Critical 2 — P29 MUST PRESERVE the P02-real checks; it may ONLY add stubs for the checks P02 GENUINELY
> DEFERRED.** P02 already implemented REAL bodies for `checkA/B/C/E` and the `checkF`/`checkG-call` COUNT
> matchers. P29 does NOT recreate, replace, or re-stub any of those. The ONLY check SIGNATURES P29 adds as
> stubs returning `[]` are the ones P02 explicitly deferred to P31: **`checkD` (round-trip symbols),
> `checkG-barrel` (`GeminiContent*` barrel imports), and `checkH` (usage keys)** — plus the full FAIL gate
> for `checkF`/`checkG-call` (their COUNT bodies from P02 stay; only their non-`--enforce-imports` HARD-FAIL
> wiring matures at P31). A P29 verification (below) FAILS if any of `checkA/B/C/E` contains `return []` or
> stops failing on the P02 negative fixtures. Re-stubbing `checkA/B/C/E` would recreate the exact #2424
> detection gap the plan closes (overview §754-768) and is FORBIDDEN.

P29→P31 EXTEND the same script: P29 adds ONLY the `checkD/checkG-barrel/checkH` stub signatures (if not
already present) and the test-gate skeleton; P30 writes the fail-mode tests; P31 implements the deferred
check bodies + CI wiring + populated allow-list + flips `--enforce-imports` into the default run. The
`--count`/`--by-file` mode, `checkF`/`checkG-call`, AND the real `checkA/B/C/E` from P02 are PRESERVED and
reused unchanged.

## Requirements Implemented (Expanded)

### REQ-012.1: Parser-based core gate
**Full Text**: `scripts/agents-neutral-gate.ts` is an AST/parser-based check over `packages/agents/src` production files detecting §8 checks (a)-(h): raw genai imports, banned Google/`Contract*` symbol imports/aliases, round-trip symbols, enum re-declarations, structural `{candidates}`/`{role,parts}` literals + `.parts` mutators, `toGeminiContent(s)` calls + `GeminiContent*` barrel imports, and Gemini usage keys outside boundary modules — with a central versioned allow-list as the single authoritative exemption mechanism.
**Behavior**:
- **GIVEN:** the P02 skeleton (real `checkA/B/C/E` + `checkF`/`checkG-call` + `--count`/`--by-file`) extended with the DEFERRED check signatures `checkD`/`checkG-barrel`/`checkH` returning `[]`, the P02-real bodies PRESERVED unchanged;
- **WHEN:** `npx tsx scripts/agents-neutral-gate.ts --dry-run`/`--count`/`--enforce-imports <fixture>` runs;
- **THEN:** the script compiles and runs; `--count`/`--by-file` still print the P02 AST-context detection; `--enforce-imports` STILL exits non-zero on each P02 (a)(b)(c)(e) negative fixture and exit 0 on the clean fixture (detection NOT regressed — Critical 2); and ONLY the EXPENSIVE fail-mode bodies (`checkD`/`checkG-barrel`/`checkH` + the `checkF`/`checkG-call` HARD-FAIL gate) remain unimplemented (they land in P31).
**Why This Matters**: establishes the full check surface as a compiling skeleton before behavioral gate
tests (P30) WITHOUT regressing the P02-real anti-#2424 detection (Critical 2).

### REQ-012.2: Central allow-list artifact
**Full Text**: `dev-docs/agents-neutral-gate-allowlist.md` records per exemption: exact file, permitted AST-context pattern, written justification. Inline comments grant NOTHING (OQ-17).
**Behavior**:
- **GIVEN:** the allow-list artifact skeleton with a structural hit whose file+AST-context matches an entry;
- **WHEN:** `--count`/the gate runs over that hit;
- **THEN:** the hit is EXEMPT (subtracted) via the central artifact entry.
- **GIVEN:** the SAME structural hit carrying only an inline `// gate-exempt` comment and NO allow-list entry;
- **WHEN:** the gate runs over it;
- **THEN:** it STILL fails (inline comments grant nothing — OQ-17).
**Why This Matters**: the single authoritative exemption mechanism, preventing the #2424 inline-comment bypass.

### REQ-012.3: Test gate
**Full Text**: `scripts/agents-neutral-test-gate.ts` bans `GenerateContentResponse`/`{candidates}` fixtures in agents test files except the named characterization allow-list (§8.1).
**Behavior**:
- **GIVEN:** an agents test file that constructs a `{candidates}` fixture or imports `@google/genai`, NOT on the named characterization allow-list;
- **WHEN:** the test gate runs (once implemented in P31);
- **THEN:** it FAILS (exit non-zero) naming the file.
- **GIVEN:** the SAME fixture in a file that IS on the named characterization allow-list;
- **WHEN:** the test gate runs;
- **THEN:** it PASSES (the characterization allow-list spares it).
**Why This Matters**: prevents Google-shaped fixtures from re-entering the test suite after migration.

## Implementation Tasks (STUB — EXTEND the P02 skeleton, do NOT recreate OR regress it)
- EXTEND `scripts/agents-neutral-gate.ts` (created in P02): add ONLY the DEFERRED check-function signatures
  `checkD_roundtripSymbols`, `checkG_barrelImports` (the `GeminiContent*` barrel-import matcher), and
  `checkH_usageKeys` as stubs returning `[]` (if not already present). **PRESERVE UNCHANGED the P02-real
  bodies:** `checkA_rawGenaiImports`, `checkB_bannedSymbols`, `checkC_contractAliases`,
  `checkE_enumRedeclarations` (real fail-mode behind `--enforce-imports`), `checkF_structuralEnvelopes`
  (F1/F3/F5 COUNT matchers), and the `toGeminiContent(s)` call form (`checkG-call`) + the working
  `--count`/`--by-file` modes + the `resolveInputFiles` input contract (`--files`/`--root`/positional —
  pseudocode lines 9-9e) that P02 landed. Do NOT set any of `checkA/B/C/E/F/G-call` to `return []`, and do
  NOT remove or regress the `resolveInputFiles` input contract. (Critical 2.)
  `@plan:PLAN-20260707-AGENTNEUTRAL.P29`, `@requirement:REQ-012.1`.
- Create `scripts/agents-neutral-test-gate.ts` — skeleton (NEW at this phase; not part of the P02 count-only skeleton). `@requirement:REQ-012.3`.
- CONFIRM/EXTEND `dev-docs/agents-neutral-gate-allowlist.md` (created in P02): headers + format spec (pseudocode lines 60-71) present; no new entries yet unless known. `@requirement:REQ-012.2`.

## Stub rules
- Compiles; ONLY the DEFERRED checks (`checkD`/`checkG-barrel`/`checkH`) return empty — the P02-real
  `checkA/B/C/E` + `checkF`/`checkG-call` + `--count`/`--by-file` are PRESERVED, NOT stubbed (Critical 2);
  NO test asserts NotYetImplemented.

## Verification Commands
```bash
npx tsx scripts/agents-neutral-gate.ts --dry-run 2>&1 | head   # runs, exits 0 (skeleton)
npx tsx scripts/agents-neutral-gate.ts --count 2>&1 | head      # prints the AST-context integer (from P02 — the target-state-approaching count, NOT 0)
test -f dev-docs/agents-neutral-gate-allowlist.md
test -f scripts/agents-neutral-test-gate.ts
grep -nE "checkA|checkB|checkC|checkD|checkE|checkG|checkH" scripts/agents-neutral-gate.ts   # all signatures present (checkA/B/C/E/F/G-call already real from P02; D/G-barrel/H stubbed here)

# ---- CRITICAL 2: P29 must NOT regress the P02-real cheap checks (A/B/C/E) back to stubs ----
# (1) None of checkA/B/C/E may contain `return []` (they are REAL from P02):
for fn in checkA_rawGenaiImports checkB_bannedSymbols checkC_contractAliases checkE_enumRedeclarations; do
  if awk "/function $fn|const $fn/{f=1} f&&/return \[\]/{found=1} f&&/^}/{f=0} END{exit found?0:1}" scripts/agents-neutral-gate.ts; then
    echo "FAIL(Critical 2): $fn was regressed to a return [] stub"; exit 1; fi
done
# (2) --enforce-imports MUST STILL exit non-zero on each P02 negative fixture (detection not regressed):
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/raw-genai-import.ts;  then echo "FAIL(Critical 2): checkA regressed"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/banned-symbol.ts;     then echo "FAIL(Critical 2): checkB regressed"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/contract-alias.ts;    then echo "FAIL(Critical 2): checkC regressed"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/finishreason-enum.ts; then echo "FAIL(Critical 2): checkE regressed"; exit 1; fi
# (3) --enforce-imports MUST STILL exit 0 on the clean fixture:
if ! npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/clean-neutral.ts; then echo "FAIL(Critical 2): clean fixture now flagged"; exit 1; fi
echo "PASS(Critical 2): P02-real checkA/B/C/E preserved (no return [] stub; still red on negatives, green on clean)"
# Only the DEFERRED checks may be stubs at P29:
grep -nE "checkD_roundtripSymbols|checkG_barrelImports|checkH_usageKeys" scripts/agents-neutral-gate.ts   # present (stubbed until P31)
```

## Success Criteria
- Both gate scripts + the allow-list artifact exist, compile, and run without crashing.
- **Critical 2:** the P02-real cheap checks `checkA_rawGenaiImports`/`checkB_bannedSymbols`/
  `checkC_contractAliases`/`checkE_enumRedeclarations` are PRESERVED (none contains `return []`; all STILL
  exit non-zero under `--enforce-imports` on the P02 negative fixtures and green on the clean fixture);
  `checkF`/`checkG-call` + `--count`/`--by-file` from P02 remain REAL. ONLY the deferred checks
  `checkD`/`checkG-barrel`/`checkH` (and the full `checkF`/`checkG-call` HARD-FAIL gate) return `[]`/are
  unwired until P31. `--count` prints the AST-context integer established in P02 (not 0).
- The new test-gate skeleton exists.
- NO test asserts `NotYetImplemented`; no `ServiceV2`; allow-list format matches pseudocode lines 60-71 (file + AST-context pattern + justification; inline comments grant nothing).

## Failure Recovery
1. If a script does not compile/run: fix the skeleton (imports, arg plumbing) — do NOT add real fail-mode detection bodies for the DEFERRED checks `checkD`/`checkG-barrel`/`checkH` yet (that is P31, TDD-driven by P30). PRESERVE the P02-real `checkA/B/C/E` + `checkF`/`checkG-call` + `--count`/`--by-file` bodies — do NOT regress them to stubs (Critical 2).
2. If any of `checkA/B/C/E` was regressed to `return []` (the Critical-2 guard failed): RESTORE its P02 real body verbatim; the cheap #2424 vectors must stay hard-enforced from the first slice.
3. If tempted to add an inline-comment exemption mechanism: DO NOT — the allow-list artifact is the single authoritative mechanism (OQ-17).
4. `git checkout --` the script/artifact files. Because P02 created the skeleton (incl. the real checkA/B/C/E), restore to the P02 state and re-extend by adding ONLY the deferred stubs (do NOT delete the P02 `checkA/B/C/E/F/G-call` + `--count`). Cannot proceed to Phase 30 until the scripts run, the Critical-2 regression guard passes, and the allow-list artifact exists.

## Phase Completion Marker
`project-plans/issue2349/.completed/P29.md`.
