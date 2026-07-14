# Phase 02a: AST gate skeleton + `--count` — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P02a`

## Prerequisites
- Required: Phase 02 completed.
- Verification: `test -f project-plans/issue2349/.completed/P02.md`

Follow `plan/verification-template.md` (semantic checklist). For this skeleton phase, verify that the
`--count` mode is genuinely AST-context-aware (not broad grep) and that the baseline is precise.

## Requirements Implemented (Expanded)

### REQ-012.1 (partial): AST-context `--count` is precise (verification)
**Full Text**: `scripts/agents-neutral-gate.ts --count` prints the integer non-exempt structural-hit
total using AST-context-aware `checkF` matchers (F1/F3/F5) + the domain-candidate EXCLUDE list, NOT a
bare-name grep.
**Behavior**:
- GIVEN the current tree;
- WHEN the verifier runs `--count` and independently inspects the three known domain-candidate sites;
- THEN those domain sites are NOT counted, and the printed integer is a precise nonzero baseline.
**Why This Matters**: guarantees the shrink-ratchet used from P07 is precise, so no slice fails for a
false positive (Major 4) and the anti-#2424 structural detection exists before the migration body (Major 5).

### REQ-012.1 (Critical 2): explicit input-scoping CLI contract is real (verification)
**Full Text**: `resolveInputFiles(argv)` (pseudocode lines 9-9e) lets `--files <path...>`/trailing positional
paths and `--root <dir>` OVERRIDE the default `packages/agents/src` scan while preserving identical AST +
allow-list semantics, so fixture-path invocations (e.g. `--enforce-imports <fixture>`) evaluate the given file.
**Behavior**:
- GIVEN: a fixture file path passed via `--files`/positional (or a fixture dir via `--root`).
- WHEN: the gate runs in `--enforce-imports`/`--count`/`--by-file` mode with that override.
- THEN: the gate evaluates EXACTLY the given file(s)/root (a vector fixture exits non-zero; the clean fixture exits 0) — NOT the default mid-migration tree; the input source only changes the file SET, not the checks.
**Why This Matters**: without this, the P02 fixture-path `--enforce-imports` assertions would be non-executable or vacuously ignore the fixture path (Critical 2).

### REQ-012.2 (partial): central allow-list is the ONLY exemption mechanism (verification)
**Full Text**: `dev-docs/agents-neutral-gate-allowlist.md` is the single authoritative exemption
mechanism; inline `// gate-exempt` comments grant nothing (OQ-17).
**Behavior**:
- GIVEN: a structural hit with only an inline `// gate-exempt` comment and NO central allow-list entry
- WHEN: `--count` runs
- THEN: it STILL counts the hit (the inline comment grants nothing)
- GIVEN: a structural hit whose file + AST context matches a central allow-list entry
- WHEN: `--count` runs
- THEN: it is subtracted from the count
**Why This Matters**: prevents the inline-comment bypass vector #2424 could have used.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the
skeleton script, confirm `--count` is AST-context-aware not broad grep, confirm domain candidates are
excluded, confirm the central allow-list is the only exemption path, and confirm the baseline integer is
recorded) and record the evidence in the completion marker. No production code is written here.

## Verification Commands
```bash
# 1. --count prints a single nonzero integer
COUNT=$(npx tsx scripts/agents-neutral-gate.ts --count); echo "baseline=$COUNT"; echo "$COUNT" | grep -qE '^[0-9]+$' && [ "$COUNT" -gt 0 ] && echo "nonzero integer OK"

# 2. AST-context, not grep: read the script and confirm it uses the TypeScript compiler API (createSourceForFile / ts.forEachChild), NOT a regex over raw text for checkF.
grep -nE "typescript|ts\.createSourceFile|forEachChild|isObjectLiteralExpression|isPropertyAccessExpression" scripts/agents-neutral-gate.ts | head

# 3. Domain candidates excluded (independently inspect the three sites, then confirm --explain omits them)
sed -n '30,36p' packages/agents/src/**/CompressionLoadBalancingProvider.ts 2>/dev/null | head
npx tsx scripts/agents-neutral-gate.ts --count --explain 2>/dev/null | grep -E "CompressionLoadBalancingProvider|CompressionProfileResolver|profilesControl" && echo "FAIL domain counted" || echo "domain excluded OK"

# 4. Inline comment grants nothing: (reason through / or add a scratch fixture) confirm the allow-list is
#    parsed for AST-context, and no code path reads an inline `// gate-exempt` to exempt a hit.
grep -nE "gate-exempt|inline" scripts/agents-neutral-gate.ts && echo "REVIEW: ensure inline comments are NOT an exemption path" || echo "no inline-exemption path"

# 5. Baseline recorded with command
grep -nE '[0-9]+' dev-docs/agents-neutral-gate-baseline.md | head
grep -nE 'agents-neutral-gate\.ts --count' dev-docs/agents-neutral-gate-baseline.md

# 6. No deferred-impl fraud in the skeleton (stubs are OK but not TODO/HACK cop-outs)
grep -rnE "TODO|FIXME|HACK|in a real|for now|will be" scripts/agents-neutral-gate.ts && echo "REVIEW deferred markers" || echo "clean"

# 7. CRITICAL 2 — the explicit input-scoping CLI contract is REAL (resolveInputFiles honored), not silently
#    ignored (which would make the fixture-path --enforce-imports assertions vacuous). Confirm the script
#    parses --files/--root/positional and re-run the P02 contract proofs:
grep -nE "resolveInputFiles|--files|--root" scripts/agents-neutral-gate.ts | head   # the input contract is present in the script
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports --files scripts/__tests__/fixtures/raw-genai-import.ts; then echo "FAIL(Critical 2): --files not scoping to the given fixture"; exit 1; fi
if ! npx tsx scripts/agents-neutral-gate.ts --enforce-imports --files scripts/__tests__/fixtures/clean-neutral.ts; then echo "FAIL(Critical 2): --files scanned the default tree, not the given clean fixture"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports --root scripts/__tests__/fixtures; then echo "FAIL(Critical 2): --root did not override the default scan root"; exit 1; fi
echo "PASS(Critical 2): input-scoping contract verified in P02a"

npm run typecheck && npm run lint:eslint-guard
```

## Success Criteria
- `--count` prints a precise nonzero integer via the TypeScript compiler API (evidence in the script:
  `ts.createSourceFile`/`forEachChild`/structural node checks), NOT a regex-over-text for `checkF`.
- The three known domain-candidate sites are NOT counted (verified independently + via `--explain`).
- The central allow-list is the only exemption path (no inline-comment exemption in the code).
- Baseline integer + command recorded in `dev-docs/agents-neutral-gate-baseline.md`.
- Stubbed fail-mode checks carry a structural "extended at P31" note, no deferred-impl TODO/HACK.
- `npm run typecheck` + `npm run lint:eslint-guard` green.

## Failure Recovery
FAIL → remediation subagent with the specific finding (grep-based checkF, domain candidate counted,
inline exemption path present, or zero/imprecise baseline). Re-verify. Do NOT proceed to Phase 03 on FAIL.

## Phase Completion Marker
Create `project-plans/issue2349/.completed/P02a.md` with the pasted outputs of every Verification
Command and a PASS/FAIL verdict with reasoning (PLAN.md §7: is the early ratchet precise and is real
anti-#2424 structural detection now in place before P07?).
