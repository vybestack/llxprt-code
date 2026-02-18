# Phase 02a: Pseudocode Verification

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P02a`

## Prerequisites

- Required: Phase 02 (pseudocode) completed
- Verification: `ls project-plans/hooksystemrefactor/analysis/pseudocode/*.md | wc -l` → 4

## Verification Commands

### Structural Checks

```bash
# 1. Line number coverage — each file must have continuous numbering
for f in project-plans/hooksystemrefactor/analysis/pseudocode/*.md; do
  FIRST=$(grep -oE "^[0-9]+" "$f" | head -1)
  LAST=$(grep -oE "^[0-9]+" "$f" | tail -1)
  echo "$(basename $f): lines $FIRST–$LAST"
done
# Expected: meaningful ranges (not just 10:, 20:, 30:)

# 2. Every requirement group has pseudocode coverage
# DELTA-HSYS (lifecycle/wiring)
grep -q "HookSystem" project-plans/hooksystemrefactor/analysis/pseudocode/message-bus-integration.md
echo "PASS: DELTA-HSYS covered in message-bus-integration.md"

# DELTA-HEVT (mediated path)
grep -q "onBusRequest\|handleHookExecutionRequest" \
  project-plans/hooksystemrefactor/analysis/pseudocode/hook-event-handler.md
echo "PASS: DELTA-HEVT covered"

# DELTA-HRUN (common output)
grep -q "processCommonHookOutputFields" \
  project-plans/hooksystemrefactor/analysis/pseudocode/common-output-processing.md
echo "PASS: DELTA-HRUN covered"

# DELTA-HPAY (validators)
grep -qE "validateBeforeToolInput|validateAfterModel|validateNotification" \
  project-plans/hooksystemrefactor/analysis/pseudocode/validation-boundary.md
echo "PASS: DELTA-HPAY covered"

# DELTA-HBUS (translation routing)
grep -q "translateModelPayload" \
  project-plans/hooksystemrefactor/analysis/pseudocode/message-bus-integration.md
echo "PASS: DELTA-HBUS model translation covered"

# DELTA-HTEL (logging)
grep -q "emitPerHookLogs\|emitBatchSummary" \
  project-plans/hooksystemrefactor/analysis/pseudocode/common-output-processing.md
echo "PASS: DELTA-HTEL covered"

# DELTA-HFAIL (failure envelopes)
grep -q "buildFailureEnvelope\|makeEmptySuccessResult" \
  project-plans/hooksystemrefactor/analysis/pseudocode/hook-event-handler.md
echo "PASS: DELTA-HFAIL covered"

# 3. Error handling paths documented in every file
for f in project-plans/hooksystemrefactor/analysis/pseudocode/*.md; do
  grep -q "Error\|Scenario\|CATCH\|failure" "$f" && \
    echo "PASS: $(basename $f) has error paths" || \
    echo "FAIL: $(basename $f) missing error paths"
done

# 4. Integration point notes documented
grep -q "Integration Point" \
  project-plans/hooksystemrefactor/analysis/pseudocode/message-bus-integration.md
echo "PASS: Integration point notes present"
```

### Deferred Implementation Detection

```bash
# Pseudocode files should not contain TODO/FIXME markers
grep -rn "TODO\|FIXME\|HACK\|STUB\|placeholder" \
  project-plans/hooksystemrefactor/analysis/pseudocode/
# Expected: 0 matches
```

### Semantic Verification Checklist

1. **Does pseudocode provide sufficient implementation guidance?**
   - [ ] Each pseudocode step translates directly to TypeScript code
   - [ ] Method signatures (inputs/outputs) are clear
   - [ ] Error handling paths for every try/catch

2. **Are line numbers usable as references in implementation phases?**
   - [ ] hook-event-handler.md: lines 10–427 (constructor through buildFailedResponse)
   - [ ] message-bus-integration.md: lines 10–162 (HookSystem through translateModelPayload)
   - [ ] validation-boundary.md: lines 10–188 (primitives through mediated gate)
   - [ ] common-output-processing.md: lines 10–209 (processCommonHookOutputFields through executeHooksCore integration)

3. **Anti-patterns documented that prevent fraud?**
   - [ ] "DO NOT return EMPTY_SUCCESS_RESULT from catch" warning present
   - [ ] "DO NOT throw from subscription handler" warning present
   - [ ] "DO NOT validate on direct path" warning present
   - [ ] "DO NOT use console.log" warning present

4. **Contract-first: interface contracts explicit?**
   - [ ] Inputs and outputs typed for each component
   - [ ] Dependencies explicitly listed (NEVER stubbed in integration)

5. **What could go wrong during implementation?**
   - HookResult shape may differ from assumed (durationMs, hookName, etc.)
   - MessageBus subscribe signature may differ
   - Translation methods may return different shapes
   - These must all be caught by preflight (P00a), not discovered during P05+

#### Holistic Functionality Assessment

**What was produced?**
Four pseudocode documents covering the full algorithm for hook event handling,
message bus integration, validation, and common output processing. Each document
includes numbered steps, interface contracts, dependency declarations, and
anti-pattern warnings.

**Does it satisfy the requirements?**
Each pseudocode document references specific DELTA- requirements through its
coverage of the relevant algorithmic components.

**What is the algorithm flow?**
hook-event-handler.md lines 80–95 (executeHooksCore) orchestrate:
1. Plan (line 82) → 2. Guard no-match (lines 83–85) → 3. Run (line 86) →
4. Aggregate (line 87) → 5. Process common output (line 88) →
6. Emit logs (lines 89–90) → 7. Return (line 91)

**Verdict**: PASS if all numbered-line ranges are populated, anti-patterns documented,
interface contracts explicit, and error paths defined.

## Success Criteria

- 4 pseudocode files with numbered lines (not just section headers)
- Every DELTA- requirement group has corresponding pseudocode
- Anti-pattern warnings prevent known fraud patterns
- Interface contracts explicit for all components

## Failure Recovery

1. Identify which pseudocode section is incomplete or missing line numbers
2. Add numbered steps to the appropriate file
3. Re-run all verification checks

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P02a.md`

```markdown
Phase: P02a
Completed: YYYY-MM-DD HH:MM
Pseudocode Files Verified: 4/4
All Requirements Covered: YES/NO
Verdict: PASS/FAIL
```
