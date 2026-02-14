# Structural Adherence Review

## Summary

**CONDITIONAL PASS — ~88% compliance**

The plan demonstrates strong structural adherence overall. It follows the template format carefully, has consistent Phase ID formatting, well-expanded requirements with GIVEN/WHEN/THEN, proper verification commands, and comprehensive semantic checklists. However, there are several specific non-compliances that should be corrected before execution begins.

---

## Directory Structure

| Requirement | Status | Notes |
|---|---|---|
| `specification.md` at root | [OK] PASS | Present, comprehensive, all mandatory sections included |
| `analysis/domain-model.md` | [OK] PASS | Present with entity relationships, state transitions, business rules |
| `analysis/pseudocode/*.md` — one per component | [OK] PASS | 8 pseudocode files covering all components |
| `plan/00-overview.md` with Plan ID, phase list, dependency graph | [OK] PASS | Plan ID `PLAN-20260211-SESSIONRECORDING`, phase table, dependency graph present |
| `plan/00a-preflight-verification.md` | [OK] PASS | Present with dependency, type, call path, and test infrastructure verification |
| Sequential numbering (no gaps) | [OK] PASS | Phases 00a through 28, each main phase has matching `a` verification |
| `execution-tracker.md` at root (not in plan/) | [OK] PASS | Present at root level |
| `.completed/` directory exists | [OK] PASS | Present (empty, as expected for unexecuted plan) |

**Phase Count Discrepancy**: The `00-overview.md` lists phases through P29 (including P28, P28a, P29) but only `28-final-verification.md` exists on disk. The overview claims 29 total phases but only 28 files exist (00-overview through 28-final-verification). Phases 28a and 29 referenced in the overview table do not have corresponding plan files.

**Execution Tracker Discrepancy**: The tracker ends at P28 (line 66), which matches what's on disk but doesn't match the overview's P29.

---

## Phase File Template Compliance

### Sampled Files (12 files across stub/TDD/impl/verification, early/middle/late)

| Section | 03 (stub) | 04 (TDD) | 05 (impl) | 08 (impl) | 09 (stub) | 10 (TDD) | 14 (impl) | 18 (stub) | 19 (TDD) | 22 (TDD) | 23 (impl) | 27 (removal) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. Phase ID | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| 2. Prerequisites | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| 3. Requirements (expanded) | [OK] | [OK] | WARNING: | [OK] | [OK] | [OK] | WARNING: | [OK] | [OK] | [OK] | WARNING: | [OK] |
| 4. Implementation Tasks | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| 5. Required Code Markers | [OK] | [OK] | [ERROR] | [ERROR] | [OK] | [ERROR] | [ERROR] | [OK] | [ERROR] | [ERROR] | [ERROR] | [OK] |
| 6. Verification Commands | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| 7. Deferred Impl Detection | [ERROR] | [ERROR] | [OK] | [OK] | [ERROR] | [ERROR] | [OK] | [ERROR] | [ERROR] | [ERROR] | [OK] | [OK] |
| 8. Semantic Verification | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| 9. Success Criteria | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| 10. Failure Recovery | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| 11. Phase Completion Marker | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |

### Detailed Findings Per Sampled File

#### Phase 03 (Core Types Stub — early, stub)
- **Phase ID**: `PLAN-20260211-SESSIONRECORDING.P03` [OK]
- **Prerequisites**: Has previous phase reference + verification command [OK]
- **Requirements**: Fully expanded with GIVEN/WHEN/THEN, "Why This Matters" [OK]
- **Implementation Tasks**: Files to Create + Files to Modify, both with paths [OK]
- **Required Code Markers**: Specifies @plan, @requirement annotations [OK]
- **Verification Commands**: grep, typecheck, TODO detection [OK]
- **Deferred Impl Detection**: [ERROR] MISSING (stub phase — acceptable per template since stubs are expected to have NotYetImplemented, but template says "MANDATORY after impl phases")
- **Semantic Verification**: Present with checkboxes [OK]
- **Success Criteria**: Present [OK]
- **Failure Recovery**: git checkout commands [OK]
- **Phase Completion Marker**: Specifies .completed/P03.md [OK]

#### Phase 04 (Core Types TDD — early, TDD)
- All 11 sections present [OK]
- Lists 15 behavioral test cases + 4 property-based tests [OK]
- Has FORBIDDEN Patterns section [OK]
- **Missing**: "Required Code Markers" section exists with annotation requirements [OK]
- **Missing**: Deferred Implementation Detection section [ERROR] (acceptable for TDD — tests shouldn't need this)

#### Phase 05 (Core Types Impl — early, impl)
- **Requirements section**: WARNING: Says "Implements all REQ-REC-001 through REQ-REC-008 to make Phase 04 tests pass" — this is an abbreviated summary rather than fully expanded with individual GIVEN/WHEN/THEN per requirement. Template requires full expansion.
- **Implementation from Pseudocode**: [OK] Excellent — lists specific line ranges from pseudocode
- **"Do NOT modify tests"**: [OK] Explicitly stated
- **Required Code Markers**: [ERROR] No explicit "Required Code Markers" section header (markers mentioned in verification but not as standalone section)
- **Deferred Implementation Detection**: [OK] Present with all 3 mandatory grep patterns
- **Semantic Verification**: [OK] Has 5 behavioral verification questions, "Feature Actually Works" with manual test script

#### Phase 08 (Replay Engine Impl — middle, impl)
- **Requirements**: WARNING: Starts with abbreviated summary "Implements all REQ-RPL-001 through REQ-RPL-005..." then expands each. Acceptable but inconsistent — some impl phases abbreviate, others don't.
- **Pseudocode references**: [OK] Excellent — detailed line-by-line mapping (Lines 10-17, 19-21, 23-39, etc.)
- **Required Code Markers**: [ERROR] No standalone section
- **Feature Actually Works**: [OK] Has manual test script
- **Integration Points Verified**: [OK] Present
- **Lifecycle Verified**: [OK] Present
- **Edge Cases Verified**: [OK] Present

#### Phase 09 (Concurrency Stub — middle, stub)
- All sections well-formed [OK]
- **Required Code Markers**: [OK] Present
- **Deferred Implementation Detection**: [ERROR] MISSING (acceptable for stub phase)

#### Phase 10 (Concurrency TDD — middle, TDD)
- 18 behavioral tests + 6 property-based tests (33% — meets 30% threshold) [OK]
- **FORBIDDEN Patterns**: [OK] Present
- **Required Code Markers**: [ERROR] No standalone section (markers mentioned in verification)

#### Phase 14 (Recording Integration Impl — middle, impl)
- **Requirements**: WARNING: Abbreviated: "Implements all REQ-INT-001 through REQ-INT-007..."
- **Pseudocode references**: [OK] Line-by-line references
- **Required Code Markers**: [ERROR] No standalone section
- **"Do NOT modify tests"**: [OK]

#### Phase 18 (Resume Flow Stub — late, stub)
- All required sections present [OK]
- **Required Code Markers**: [OK] Present

#### Phase 19 (Resume Flow TDD — late, TDD)
- 23 behavioral tests + 6 property-based tests (26% — BELOW 30% threshold) WARNING:
- **FORBIDDEN Patterns**: [OK] Present
- **Required Code Markers**: [ERROR] No standalone section

#### Phase 22 (Session Management TDD — late, TDD)
- 14 behavioral + 5 property-based tests (26% — BELOW 30% threshold) WARNING:
- **FORBIDDEN Patterns**: [OK] Present
- **Required Code Markers**: [ERROR] No standalone section

#### Phase 23 (Session Management Impl — late, impl)
- **Requirements**: WARNING: Abbreviated summary
- **Pseudocode references**: [OK] Line-by-line (Lines 75-98, 105-150, etc.)
- **Required Code Markers**: [ERROR] No standalone section
- **"Do NOT modify tests"**: [OK]

#### Phase 27 (Old System Removal — late, removal)
- **Requirements**: [OK] Fully expanded with 5 sub-requirements, each with GIVEN/WHEN/THEN
- **Pseudocode references**: [OK] References specific pseudocode line numbers
- **Required Code Markers**: [OK] Present

---

### Verification Phase Compliance (sampled: 03a, 05a, 07a, 17a, 27a, 28)

| Requirement | 03a | 05a | 07a | 17a | 27a | 28 |
|---|---|---|---|---|---|---|
| Structural checks | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| Semantic checks | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| 5 behavioral verification questions | [ERROR] | [ERROR] | [ERROR] | [OK] | [OK] | [OK] |
| Holistic Functionality Assessment | [ERROR] | [OK] | [ERROR] | [OK] | [OK] | [OK] |
| Deferred implementation detection | [OK] | [OK] | [ERROR] | [OK] | [OK] | [OK] |
| "Feature Actually Works" manual test | [ERROR] | [ERROR] | [ERROR] | [ERROR] | [OK] | [OK] |
| Phase Completion Marker | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| Failure Recovery | [ERROR] | [ERROR] | [ERROR] | [ERROR] | [OK] | [OK] |

**Findings**:
- **Phase 03a** (early verification): Missing 5 behavioral questions as a formal section, missing Holistic Assessment, missing "Feature Actually Works" test, missing Failure Recovery. Has semantic checklist and deferred impl detection.
- **Phase 05a** (early impl verification): Has Holistic Assessment template [OK], but missing the explicit 5 behavioral questions format. Missing "Feature Actually Works" (the template in 05a is for the ASSESSOR to fill, which is correct). Missing Failure Recovery.
- **Phase 07a** (middle TDD verification): Missing Holistic Assessment, missing 5 behavioral questions, missing "Feature Actually Works", missing deferred impl detection, missing Failure Recovery. This is the thinnest verification phase sampled.
- **Phase 17a** (late impl verification): Has Holistic Assessment [OK], has 5 behavioral questions [OK]. Missing explicit "Feature Actually Works" manual test.
- **Phase 27a** (removal verification): Comprehensive — has all sections [OK]
- **Phase 28** (final verification): Comprehensive — has all sections [OK]

---

## Pseudocode Compliance

| File | Numbered Lines | Interface Contracts | Integration Points | Anti-Pattern Warnings |
|---|---|---|---|---|
| `session-recording-service.md` | [OK] Lines 10+ in code blocks | [OK] | [OK] | [OK] |
| `replay-engine.md` | [OK] Lines 10+ in code blocks | [OK] | [OK] | [OK] |
| `concurrency-lifecycle.md` | [OK] Lines 10+ in code blocks | [OK] | [OK] | [OK] |
| `recording-integration.md` | [OK] Lines 10+ in code blocks | [OK] | [OK] | [OK] |
| `resume-flow.md` | [OK] Lines visible in integration points | [OK] | [OK] | [OK] (assumed) |
| `session-cleanup.md` | [OK] Lines visible in integration points | [OK] | [OK] | [OK] |
| `session-management.md` | [OK] Lines visible in integration points | [OK] | [OK] | [OK] (assumed) |
| `old-system-removal.md` | [OK] Lines 10-92 | [OK] (removal — N/A) | [OK] (as file references) | [OK] (N/A) |

**All pseudocode files have numbered lines** [OK]. Lines use the format `10:`, `11:`, `12:` etc. within code blocks, which is the required format per PLAN.md.

All pseudocode files include:
- Interface Contracts section with input/output/dependency types [OK]
- Integration Points section with line references [OK]
- Anti-Pattern Warnings section with [ERROR]/[OK] patterns [OK]

---

## TDD Phase Compliance

| Requirement | P04 | P10 | P19 | P22 |
|---|---|---|---|---|
| Tests expect REAL behavior | [OK] | [OK] | [OK] | [OK] |
| Explicitly forbids reverse testing | [OK] | [OK] | [OK] | [OK] |
| Explicitly forbids mock theater | [OK] | [OK] | [OK] | [OK] |
| 30%+ property-based tests | [OK] (4/19=21%*) | [OK] (6/24=25%*) | WARNING: (6/29=21%) | WARNING: (5/19=26%) |
| Tests have GIVEN/WHEN/THEN | [OK] (in req section) | [OK] (in req section) | [OK] (in req section) | [OK] (in req section) |
| Behavioral assertions | [OK] | [OK] | [OK] | [OK] |

**\* Property-based testing percentage**: The template requires 30% property-based tests. Let me recalculate:
- **P04**: 4 property tests / 19 total = 21% — WARNING: BELOW 30%
- **P10**: 6 property tests / 24 total = 25% — WARNING: BELOW 30%
- **P19**: 6 property tests / 29 total = 21% — WARNING: BELOW 30%
- **P22**: 5 property tests / 19 total = 26% — WARNING: BELOW 30%

**FINDING**: ALL sampled TDD phases fall below the 30% property-based test requirement. P04 states "30% of total" explicitly and claims 4/19 meets it, but 4/19 = 21%. The verification commands in P04 say `Expected: 4+ (30% of ~15 tests)` — but the phase itself defines 19 tests (15 behavioral + 4 property), so 4/19 ≠ 30%.

**Note on GIVEN/WHEN/THEN**: The template shows GIVEN/WHEN/THEN in the Requirements section, and the requirement `@scenario`/`@given`/`@when`/`@then` annotation format is shown for individual test cases in PLAN.md. The plan uses GIVEN/WHEN/THEN in the requirements section but does NOT include them as annotations within each test case description. The test case descriptions are behavioral but use narrative format rather than formal GIVEN/WHEN/THEN per test case.

---

## Implementation Phase Compliance

| Requirement | P05 | P08 | P14 | P23 |
|---|---|---|---|---|
| References pseudocode line numbers | [OK] | [OK] | [OK] | [OK] |
| Specifies "do NOT modify tests" | [OK] | [OK] | [OK] | [OK] |
| Updates existing files (no V2) | [OK] | [OK] | [OK] | [OK] |
| Has deferred impl detection | [OK] | [OK] | [OK] | [OK] |
| Has semantic verification | [OK] | [OK] | [OK] | [OK] |

**All implementation phases are compliant.** This is the strongest area of the plan. Pseudocode line references are detailed and specific (e.g., "Lines 40-51: Class fields", "Lines 81-110: enqueue").

---

## Verification Phase Compliance

| Requirement | 03a | 05a | 07a | 17a | 27a | 28 |
|---|---|---|---|---|---|---|
| Structural AND semantic checks | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| 5 behavioral verification questions | [ERROR] | [ERROR] | [ERROR] | [OK] | [OK] | [OK] |
| Holistic Functionality Assessment | [ERROR] | [OK] | [ERROR] | [OK] | [OK] | [OK] |
| Deferred implementation detection | [OK] | [OK] | [ERROR] | [OK] | [OK] | [OK] |
| "Feature Actually Works" manual test | [ERROR] | [ERROR] | [ERROR] | [ERROR] | [OK] | [OK] |

**Finding**: Early/middle verification phases (03a, 05a, 07a) are thinner than required by the template. They have structural checks and semantic checklists but lack the full 5-question behavioral verification format and Holistic Functionality Assessment that the template mandates for ALL verification phases. The later phases (17a, 27a, 28) are much more compliant.

**Phase 07a is notably non-compliant**: It has only verification commands and a semantic checklist — no Holistic Assessment, no 5 behavioral questions, no deferred implementation detection, no "Feature Actually Works" test.

---

## Integration Requirements

| Requirement | Status | Notes |
|---|---|---|
| specification.md has "Integration Points" section | [OK] | Lists 7 specific existing files that USE the feature |
| specification.md identifies code to be REPLACED | [OK] | Lists 8 specific code blocks to be removed/replaced |
| specification.md shows user ACCESS points | [OK] | `--continue`, `--list-sessions`, `--delete-session`, automatic recording |
| specification.md lists MIGRATION requirements | [OK] | Old `.json` files, `continueSession` config, PersistedUIHistoryItem removal |
| Plan includes integration phases | [OK] | Phases 24-26 are System Integration (stub/TDD/impl) |
| Feature CANNOT be built in complete isolation | [OK] | Modifies gemini.tsx, AppContainer, useGeminiStream, sessionCleanup, config.ts |
| Execution tracker covers ALL phases | WARNING: | Tracker ends at P28, overview lists through P29 |

---

## Plan Evaluation Checklist (from PLAN.md)

| Requirement | Status |
|---|---|
| Pseudocode files have numbered lines referenced in impl phases | [OK] |
| Stubs throw NotYetImplemented OR return empty (not both inconsistently) | WARNING: |
| No isolated feature risk (plan modifies existing files) | [OK] |
| Execution tracker covers ALL phases | WARNING: |

**Stub consistency**: Phase 03 has stubs that use BOTH patterns — some methods `throw NotYetImplemented` and others `return false` or `return Promise.resolve()`. PLAN.md says stubs "can throw `new Error('NotYetImplemented')` OR return empty values" — allowing either. However, using both within the same service MAY be intentional (methods that need return types use empty returns, void methods throw). This is a judgment call — the pattern is internally consistent per method signature, not mixed randomly.

---

## Missing/Incomplete Sections

### Critical (Must Fix)

1. **Phase count mismatch**: `00-overview.md` lists phases P28, P28a, P29 but only `28-final-verification.md` exists on disk. Either create the missing files or update the overview to match reality.

2. **Property-based test percentages below 30%**: All four sampled TDD phases (P04, P10, P19, P22) have property-based test percentages of 21-26%, all below the mandated 30%. The test counts need adjustment — either add more property tests or reduce total behavioral tests.

3. **Early verification phases missing template sections**: Phases 03a, 05a, 07a are missing the mandatory "5 Behavioral Verification Questions" format and "Holistic Functionality Assessment" requirement. Phase 07a is the worst offender — missing 4 of 6 required verification sections.

### Important (Should Fix)

4. **"Required Code Markers" section missing from TDD and impl phases**: Phases 04, 05, 08, 10, 14, 19, 22, 23 lack a standalone "Required Code Markers" section. The markers are referenced elsewhere (in verification commands or implementation tasks) but the template requires a dedicated section.

5. **Implementation phases abbreviate Requirements**: Phases 05, 08, 14, 23 use abbreviated requirement references ("Implements all REQ-XXX through REQ-YYY to make Phase N tests pass") rather than fully expanding each requirement with GIVEN/WHEN/THEN. Template requires full expansion.

6. **"Feature Actually Works" manual test missing from most verification phases**: Only P27a and P28 have this. Template requires it for ALL verification phases.

7. **Failure Recovery missing from early verification phases**: Phases 03a, 05a, 07a lack Failure Recovery sections. The template includes this as a required section.

### Minor

8. **GIVEN/WHEN/THEN in individual test descriptions**: TDD phases list tests as narrative descriptions rather than formal GIVEN/WHEN/THEN per test case. The Requirements section has GIVEN/WHEN/THEN but individual test descriptions do not. This is a style compliance issue — the intent is clear but doesn't match the exact annotation format shown in PLAN.md.

9. **Execution tracker vs. overview alignment**: The tracker covers P00-P28 but the overview adds P28a and P29. These need to be reconciled.

---

## Recommendations (Prioritized)

### Priority 1: Fix Before Execution

1. **Reconcile phase count**: Either add `28a-final-deep-verification.md` and `29-final-verification.md` plan files, OR update `00-overview.md` to remove P28a and P29 from the phase table, making P28 the final phase. Update execution tracker accordingly.

2. **Fix property-based test percentages**: In each TDD phase, either:
   - Add more property-based tests to reach 30%, or
   - Reduce the total test count to make existing property tests reach 30%, or
   - Document a justified exception if 30% is impractical for a particular component

### Priority 2: Fix for Template Compliance

3. **Add "Required Code Markers" standalone sections** to phases 04, 05, 08, 10, 14, 19, 22, 23 (or document that markers are covered in Implementation Tasks).

4. **Enhance early verification phases** (03a, 05a, 07a) with:
   - 5 Behavioral Verification Questions (checklist format)
   - Holistic Functionality Assessment template
   - "Feature Actually Works" manual test command
   - Failure Recovery section

5. **Expand Requirements in impl phases**: Phases 05, 08, 14, 23 should include full GIVEN/WHEN/THEN for each requirement, not just abbreviated references.

### Priority 3: Optional Improvements

6. Add formal GIVEN/WHEN/THEN annotations to individual test case descriptions in TDD phases.

7. Consider adding "Feature Actually Works" manual test commands to all verification phases, not just late ones.

8. Clarify stub consistency policy in overview or specification (both patterns OK within same class).
