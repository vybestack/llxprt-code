# PLAN-20251028-STATELESS6 Compliance Review

**Review Date:** 2025-10-28
**Reviewer:** Claude (Sonnet 4.5)
**Standards:** dev-docs/PLAN.md, dev-docs/PLAN-TEMPLATE.md, dev-docs/RULES.md

---

## Executive Summary

**Overall Status:** ⚠️ **CONDITIONALLY ACCEPTABLE WITH CRITICAL GAPS**

PLAN-20251028-STATELESS6 demonstrates **STRONG integration analysis** and correctly avoids building features in isolation. The plan identifies specific existing files to modify, lists exact code to remove, and shows clear integration pathways. However, the plan suffers from **execution gaps** that prevent immediate implementation:

### ✅ Strengths
- Excellent integration planning (specific files, line numbers, old code removal)
- Correct TDD sequencing (tests before implementation)
- Proper phase numbering and verification steps
- Clear requirements with traceability markers

### ❌ Critical Gaps
1. **VAGUE TEST STRATEGY** - Abstract descriptions without concrete test code
2. **WEAK PSEUDOCODE REFERENCES** - Implementation phases don't cite specific line numbers
3. **MISSING VERIFICATION COMMANDS** - No pseudocode compliance or marker checks in verification phases
4. **INCOMPLETE PSEUDOCODE DETAIL** - Complex logic areas need algorithmic detail

---

## 1. Integration Requirements Compliance

### ✅ PASSES Integration Analysis (MOST CRITICAL)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Lists specific existing files that will use the feature | ✅ PASS | integration-map.md lists geminiChat.ts, subagent.ts with specific lines |
| Identifies exact code to be replaced/removed | ✅ PASS | Line 609: `setModel` mutation, Config.getProviderManager() calls |
| Shows how users will access the feature | ✅ PASS | Internal refactoring; users access via existing CLI/commands |
| Includes migration plan for existing data | ✅ PASS | Config adapter bridge (step 008) for backward compatibility |
| Has integration test phases | ✅ PASS | P09 integration TDD, P11 hardening phase |
| Feature CANNOT work without modifying existing files | ✅ PASS | Requires GeminiChat constructor changes, SubAgentScope refactor |
| **If feature builds in isolation, REJECT** | ✅ PASS | Cannot build in isolation - requires modifying core classes |

**Integration Verdict:** ✅ **STRONG PASS**

The plan correctly identifies the "what needs to change" with surgical precision:
- `packages/core/src/core/geminiChat.ts` (lines 561, 1177, 1775, 2480 for provider manager)
- `packages/core/src/core/subagent.ts` (line 609 for setModel removal)
- `packages/core/src/telemetry/loggers.ts` (API signature refactor)

This is NOT an isolated feature trap. The plan forces integration by changing constructor signatures.

---

## 2. Pseudocode Compliance

### ⚠️ PARTIAL COMPLIANCE

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Pseudocode files have numbered lines | ✅ PASS | Steps 001-010 in geminiChat-runtime-view.md |
| Implementation phases reference line numbers | ❌ FAIL | Phases say "steps 001-004" not "Line 005.3: Build provider adapter" |
| Verification checks pseudocode was followed | ❌ FAIL | No verification commands compare implementation to pseudocode |
| No unused pseudocode files | ✅ PASS | Single pseudocode file, all steps referenced |

**Critical Issues:**

1. **Implementation phases are too vague:**
   ```markdown
   # CURRENT (P06)
   Create TypeScript scaffolding (pseudocode steps 001–004)

   # REQUIRED
   - Line 001: Define ReadonlySettingsSnapshot interface with compressionThreshold field
   - Line 002: Define ToolRegistryView with listToolNames/getToolMetadata methods
   - Line 003: Define GeminiRuntimeView with readonly state/history/ephemerals/telemetry/provider/tools
   ```

2. **Verification phases miss pseudocode compliance:**
   ```bash
   # MISSING FROM P08a
   # Compare implementation with pseudocode
   claude --dangerously-skip-permissions -p "
   Compare packages/core/src/core/subagent.ts with
   analysis/pseudocode/geminiChat-runtime-view.md steps 007.1-007.8
   Verify every numbered line is implemented
   Report to pseudocode-compliance.json
   "
   ```

3. **Complex logic needs more detail:**
   - Step 005.4 "Build telemetry adapter" - how does enrichment work algorithmically?
   - Step 007.5 "Instantiate content generator via bridge" - what is the bridge signature?

**Pseudocode Verdict:** ⚠️ **NEEDS IMPROVEMENT** - Good structure, weak enforcement

---

## 3. Test Strategy Compliance

### ⚠️ PARTIAL COMPLIANCE - TOO ABSTRACT

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Tests expect real behavior | ✅ PASS | No reverse testing patterns detected |
| No testing for NotYetImplemented | ✅ PASS | Stub phase allows empty returns OR throws |
| ≥30% property-based tests | ⚠️ MENTIONED | test-strategy.md mentions fast-check but no concrete generators |
| Behavioral assertions (toBe, toEqual) | ⚠️ MENTIONED | test-strategy.md has examples but no actual test specs |
| Integration tests verify end-to-end flow | ✅ PASS | P09 includes foreground + subagent dual runtime scenario |

**Critical Issues:**

1. **Test strategy lacks concrete test code:**
   ```typescript
   // CURRENT - test-strategy.md
   "Verify SubAgentScope constructs runtime view using subagent settings snapshot"

   // REQUIRED - Actual test specification
   it('should construct runtime view from subagent profile without mutating config @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-001.1', async () => {
     const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });
     const setModelSpy = vi.spyOn(foregroundConfig, 'setModel');
     const subagentProfile = { modelConfig: { model: 'gemini-2.0-flash-thinking-exp' }, ... };

     const scope = await SubAgentScope.create('sub', subagentProfile, foregroundConfig);

     expect(setModelSpy).not.toHaveBeenCalled();
     expect(foregroundConfig.getModel()).toBe('gemini-2.0-flash-exp');
     expect(scope['runtimeView'].state.model).toBe('gemini-2.0-flash-thinking-exp');
   });
   ```

2. **Property-based testing examples are generic:**
   ```typescript
   // CURRENT - test-strategy.md
   "Property: generated compression thresholds respected by view.ephemerals"

   // REQUIRED - Specific fast-check generator
   import * as fc from 'fast-check';

   it.prop([fc.double({ min: 0.1, max: 1.0 })])(
     'should respect compression threshold override @plan PLAN-20251028-STATELESS6.P07',
     (threshold) => {
       const view = createGeminiRuntimeView({
         state,
         settings: { compressionThreshold: threshold }
       });
       expect(view.ephemerals.compressionThreshold()).toBe(threshold);
     }
   );
   ```

3. **Integration scenario is vague:**
   ```markdown
   # CURRENT
   "Dual runtime scenario: foreground + subagent execute sequentially"

   # REQUIRED
   Concrete scenario:
   1. Setup: foregroundConfig with model A, subagentProfile with model B
   2. Execute: foregroundChat.send("Hello"), subagentScope.run(task), foregroundChat.send("World")
   3. Assert: config.getModel() === model A (unchanged)
   4. Assert: telemetry logs contain 2 distinct runtimeId values
   5. Assert: API calls show correct models per chat instance
   ```

**Test Strategy Verdict:** ⚠️ **NEEDS CONCRETE TEST CASES** - Good categories, weak specifics

---

## 4. Verification Requirements Compliance

### ❌ FAILS Verification Completeness

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Mutation testing specified (≥80%) | ⚠️ MENTIONED | test-strategy.md mentions but P10a says "TBD" |
| Behavioral contract validation | ✅ PASS | test-strategy.md has behavioral contract template |
| Mock theater detection | ✅ PASS | test-strategy.md mentions spy detection |
| Pseudocode compliance check | ❌ FAIL | No verification phase checks pseudocode compliance |
| Marker verification | ❌ FAIL | No verification phase checks @plan/@requirement markers |

**Critical Missing Verification Commands:**

### P08a should include:
```bash
# Check pseudocode compliance
grep -A5 "007.1" packages/core/src/core/subagent.ts | grep "constructor" || echo "FAIL: Step 007.1 not implemented"
grep "setModel" packages/core/src/core/subagent.ts && echo "FAIL: Step 007.8 violated (setModel still present)" || echo "PASS: setModel removed"

# Check markers
MARKER_COUNT=$(rg "@plan PLAN-20251028-STATELESS6.P08" packages/core/src/core/subagent.ts | wc -l)
[ "$MARKER_COUNT" -ge 3 ] || echo "FAIL: Expected ≥3 @plan markers, found $MARKER_COUNT"
```

### P10a should include:
```bash
# Mutation testing with thresholds
npm run test:mutate -- --files packages/core/src/core/geminiChat.ts
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
if (( $(echo "$MUTATION_SCORE < 80" | bc -l) )); then
  echo "FAIL: Mutation score $MUTATION_SCORE% is below 80%"
  exit 1
fi

# Property test percentage
TOTAL_TESTS=$(rg -c "^\s*it\(" packages/core/src/core/test/ | awk '{s+=$1} END {print s}')
PROPERTY_TESTS=$(rg -c "it\.prop" packages/core/src/core/test/ | awk '{s+=$1} END {print s}')
PERCENTAGE=$((PROPERTY_TESTS * 100 / TOTAL_TESTS))
[ $PERCENTAGE -ge 30 ] || echo "FAIL: Only $PERCENTAGE% property tests (need ≥30%)"
```

**Verification Verdict:** ❌ **INCOMPLETE** - Missing automated compliance checks

---

## 5. Anti-Pattern Detection

### ✅ PASSES Anti-Pattern Checks

| Anti-Pattern | Status | Evidence |
|--------------|--------|----------|
| No ServiceV2 or ServiceNew files | ✅ PASS | Plan updates existing geminiChat.ts, subagent.ts |
| No parallel implementations | ✅ PASS | Single runtime view interface, no duplicates |
| No test modifications during implementation | ✅ PASS | TDD phases precede implementation phases |
| No mock-only tests | ✅ PASS | Test strategy emphasizes behavioral assertions |
| No reverse testing (NotYetImplemented) | ✅ PASS | Stub phase uses empty returns OR throws, not test expectations |
| Modify existing files, don't duplicate | ✅ PASS | P06-P10 update existing files; only NEW files are GeminiRuntimeView (doesn't exist yet) |

**Anti-Pattern Verdict:** ✅ **CLEAN** - No red flags detected

---

## 6. Plan Structure Compliance

### ✅ PASSES Structure Requirements

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Plan ID format correct | ✅ PASS | PLAN-20251028-STATELESS6 |
| Sequential phase numbering | ✅ PASS | P02-P12 (no skipped numbers) |
| All phases have verification | ✅ PASS | Every PNN has PNNa verification |
| Execution tracker present | ✅ PASS | execution-tracker.md exists |
| Requirements documented | ✅ PASS | requirements.md with REQ-STAT6-001/002/003 |

**Structure Verdict:** ✅ **COMPLIANT** - Well-organized plan structure

---

## 7. Code Markers & Traceability

### ⚠️ PARTIAL COMPLIANCE

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Plan markers required (@plan) | ✅ SPECIFIED | All phases require @plan markers |
| Requirement markers required (@requirement) | ✅ SPECIFIED | All phases require @requirement markers |
| Pseudocode line references required | ❌ NOT ENFORCED | Implementation phases don't cite specific lines |
| Verification checks markers | ❌ FAIL | Verification phases don't grep for markers |

**Traceability Verdict:** ⚠️ **WEAK ENFORCEMENT** - Specified but not verified

---

## 8. Comparison to PLAN.md Requirements

### Critical Requirements from PLAN.md:

#### ✅ Integration Requirements (Lines 110-177)
- [x] Identified all touch points with existing system
- [x] Listed specific files that will import/use the feature
- [x] Identified old code to be replaced/removed (setModel at line 609)
- [x] Planned migration path (Config adapter at step 008)
- [x] Created integration tests (P09)
- [x] User can access feature through existing UI/CLI (internal refactoring)

**RED FLAG CHECK:** "If the feature can be completely implemented without modifying ANY existing files except adding exports, it's probably built in isolation"
- **Result:** ✅ PASS - Requires modifying GeminiChat constructor, SubAgentScope refactor, telemetry API changes

#### ⚠️ Pseudocode Usage Requirements (Lines 73-107)
- [x] Pseudocode exists with numbered lines
- [x] Implementation phases reference pseudocode
- [ ] **FAIL:** Implementation phases don't cite SPECIFIC line numbers (e.g., "Line 005.3")
- [ ] **FAIL:** Verification phases don't compare implementation to pseudocode line-by-line

#### ⚠️ TDD Phase Requirements (Lines 472-561)
- [x] Tests expect REAL BEHAVIOR
- [x] NO testing for NotYetImplemented
- [x] NO reverse tests (expect().not.toThrow())
- [ ] **WEAK:** Test strategy describes categories but lacks concrete test code
- [ ] **WEAK:** No specific property-based test generators shown

#### ❌ Verification Phase Requirements (Lines 603-666)
- [ ] **FAIL:** No mutation testing verification commands in P10a (says "TBD")
- [ ] **FAIL:** No pseudocode compliance check in verification phases
- [ ] **FAIL:** No marker verification (grep @plan/@requirement counts)
- [x] Tests must pass check included

---

## 9. Recommendations for Improvement

### IMMEDIATE (Blocking Execution)

1. **Expand Test Strategy with Concrete Test Code**
   - Add actual test case code to test-strategy.md (expect statements, assertions)
   - Provide specific fast-check property generators for ephemerals
   - Detail integration test setup/teardown and assertion sequence

2. **Update Implementation Phases with Granular Pseudocode References**
   - Change P06: "Create scaffolding (steps 001-004)" → "Line 001: Define ReadonlySettingsSnapshot; Line 002: Define ToolRegistryView; ..."
   - Change P08: "Update per steps 007.1-007.8" → "Line 007.1: Change constructor signature; Line 007.8: Remove setModel call at subagent.ts:609"

3. **Add Verification Commands to All Verification Phases**
   ```bash
   # P08a
   grep "@plan PLAN-20251028-STATELESS6.P08" packages/core/src/core/subagent.ts | wc -l # Expected: ≥3
   grep -r "setModel" packages/core/src/core/subagent.ts && echo "FAIL: setModel still present"

   # P10a
   npm run test:mutate -- --files packages/core/src/core/geminiChat.ts
   # Check mutation score ≥80%
   ```

4. **Specify Mutation Testing Configuration**
   - Add exact stryker.conf.js requirements to test-strategy.md
   - Specify which files to mutate (geminiChat.ts, createGeminiRuntimeView.ts)
   - Define mutation thresholds and failure criteria

### HIGH PRIORITY (Before P06 Execution)

5. **Expand Pseudocode Detail for Complex Steps**
   - Step 005.4 telemetry enrichment: Show exact enrichment algorithm
   - Step 007.5 content generator bridge: Define bridge interface signature
   - Step 009.1 provider adapter throwing: Specify error message and type

6. **Create Concrete Integration Test Scenario**
   - Write actual integration test skeleton in test-strategy.md
   - Show setup code, execution sequence, and specific assertions
   - Define expected telemetry output structure

### MEDIUM PRIORITY (Pre-Verification)

7. **Add Expected Output Counts to Verification Commands**
   ```bash
   # P11 hardening grep commands should specify expected counts
   rg "config\.getProviderManager" packages/core/src/core/ | wc -l # Expected: 0
   rg "config\.getEphemeralSetting" packages/core/src/core/ | wc -l # Expected: 0
   ```

8. **Document Relationship to Future Plans**
   - STATELESS6 uses Config adapter bridge (step 008)
   - STATELESS7 should remove Config entirely
   - Document deprecation timeline for adapter

### LOW PRIORITY (Documentation)

9. **Expand Integration Map with Data Flow**
   - Add sequence diagram showing foreground → subagent data flow
   - Document which Config methods are replaced by which runtime view accessors

10. **Update DEEP-ANALYSIS.md Status**
    - Current status: "NOT READY TO EXECUTE"
    - After improvements: Update to "READY WITH CAVEATS" and list remaining risks

---

## 10. Compliance Score

| Category | Score | Weight | Weighted Score |
|----------|-------|--------|----------------|
| Integration Analysis | 100% | 35% | 35.0 |
| Pseudocode Compliance | 60% | 20% | 12.0 |
| Test Strategy | 60% | 20% | 12.0 |
| Verification Requirements | 40% | 15% | 6.0 |
| Anti-Pattern Avoidance | 100% | 5% | 5.0 |
| Plan Structure | 100% | 5% | 5.0 |
| **TOTAL** | | | **75.0%** |

**Letter Grade:** C+ (75%)

**Pass/Fail:** ⚠️ **CONDITIONAL PASS**

---

## 11. Final Verdict

### Status: ⚠️ CONDITIONALLY ACCEPTABLE PENDING IMPROVEMENTS

**Rationale:**

PLAN-20251028-STATELESS6 demonstrates **STRONG architectural thinking** and correctly avoids the "isolated feature trap" that plagues many plans. The integration analysis is exemplary - it identifies specific files, exact line numbers, and shows clear integration pathways. The plan structure is sound with proper TDD sequencing.

**HOWEVER**, the plan suffers from **execution specificity gaps**:

1. **Test strategy is too abstract** - describes categories but lacks concrete test code
2. **Pseudocode references are coarse-grained** - says "steps 001-004" instead of citing specific lines
3. **Verification phases lack automated compliance checks** - no marker verification, no pseudocode comparison commands

These gaps increase the risk of implementation drift and make verification subjective rather than automated.

### Recommendation: IMPROVE BEFORE EXECUTION

**Required Improvements (1-2 hours):**
1. Add 5-10 concrete test case code snippets to test-strategy.md
2. Update P06/P08/P10 to reference specific pseudocode lines (e.g., "Line 005.3")
3. Add marker verification commands to P08a/P10a
4. Add mutation testing verification to P10a

**Optional Improvements (1 hour):**
5. Expand pseudocode algorithmic detail for steps 005.4, 007.5
6. Create integration test skeleton in test-strategy.md
7. Add expected output counts to P11 verification commands

**After Improvements:**
- Re-review plan (15 minutes)
- Update compliance-report.json
- Mark plan as "READY FOR EXECUTION"

### Can Execution Proceed?

**Short Answer:** ⚠️ **YES, WITH CAUTION**

**Long Answer:** The plan's integration approach is correct and the structure is sound. An experienced developer could execute this plan by inferring the missing specifics. However, this violates the autonomous execution principle - a subagent worker should not need to infer implementation details. The plan should be self-sufficient.

**Proceed if:**
- You have experienced developers who can fill gaps during implementation
- You're willing to accept higher verification burden (manual reviews)
- You'll update the plan retroactively with learned details

**Pause if:**
- You're using autonomous workers/agents for implementation
- You want reproducible, auditable execution
- You need high confidence in verification completeness

---

## 12. Compliance Report Summary

```json
{
  "plan_id": "PLAN-20251028-STATELESS6",
  "review_date": "2025-10-28",
  "overall_status": "CONDITIONAL_PASS",
  "compliance_score": 75.0,
  "integration_analysis": "STRONG_PASS",
  "pseudocode_compliance": "NEEDS_IMPROVEMENT",
  "test_strategy": "NEEDS_CONCRETE_CASES",
  "verification_requirements": "INCOMPLETE",
  "anti_patterns": "CLEAN",
  "plan_structure": "COMPLIANT",
  "blocking_issues": [
    "Test strategy lacks concrete test code",
    "Implementation phases don't cite specific pseudocode lines",
    "Verification phases missing compliance checks"
  ],
  "recommended_action": "IMPROVE_BEFORE_EXECUTION",
  "estimated_improvement_time": "2-3 hours"
}
```

---

## Appendix A: Compliance Checklist (From PLAN.md)

### Integration Requirements (Lines 166-177)
- [x] Identified all touch points with existing system
- [x] Listed specific files that will import/use the feature
- [x] Identified old code to be replaced/removed
- [x] Planned migration path for existing data
- [x] Created integration tests that verify end-to-end flow
- [x] User can actually access the feature through existing UI/CLI

### Pseudocode Compliance (Lines 73-107)
- [x] Pseudocode has line numbers
- [ ] Implementation phases cite specific line numbers (e.g., "Line 005.3")
- [ ] Verification compares implementation to pseudocode line-by-line
- [x] No unused pseudocode files

### TDD Phase (Lines 409-561)
- [x] Tests before implementation
- [x] No NotYetImplemented patterns
- [x] No reverse testing (expect().not.toThrow())
- [ ] Concrete test cases with specific assertions
- [ ] ≥30% property-based tests (generators specified)
- [ ] Behavioral contracts with @given/@when/@then

### Verification Phase (Lines 562-666)
- [ ] Mutation testing with ≥80% score
- [ ] Property test percentage check (≥30%)
- [ ] Behavioral contract validation
- [ ] Mock theater detection
- [ ] Reverse testing detection
- [ ] Pseudocode compliance check
- [ ] Marker verification (grep @plan/@requirement)

### Anti-Patterns (Lines 1148-1164)
- [x] No ServiceV2 or ServiceNew files
- [x] No ConfigButNewVersion patterns
- [x] No parallel implementations
- [x] No test modifications during implementation
- [x] No mock-only tests

---

**Review Complete**

This plan is **75% compliant** with dev-docs/PLAN.md standards. With 2-3 hours of improvements focusing on test strategy concreteness, pseudocode granularity, and verification automation, this plan can reach **90%+ compliance** and be ready for autonomous execution.
