# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P00a`

## Purpose

Verify ALL assumptions about dependencies, types, call paths, and test infrastructure BEFORE writing any code. This phase prevents the most common planning failures: missing dependencies, wrong types, and impossible call patterns.

## Prerequisites

- None (this is the first phase)
- Read design.md and requirements.md in full

## Verification Tasks

### 1. Dependency Verification

Verify all libraries referenced in the plan exist:

```bash
# Core dependencies
npm ls @google/genai
npm ls fast-levenshtein
npm ls diff
npm ls vitest

# Verify package.json entries
grep -E "@google/genai|fast-levenshtein|diff|vitest" packages/core/package.json
```

**Expected Output:**
- All dependencies show installed versions
- No "UNMET PEER DEPENDENCY" or missing package errors

### 2. Type/Interface Verification

Verify the key types and interfaces exist and match assumptions:

```bash
# ToolCallRequestInfo and ToolCallResponseInfo (should be in turn.ts)
grep -A 30 "interface ToolCallRequestInfo\|interface ToolCallResponseInfo" packages/core/src/core/turn.ts

# Config class
grep -A 20 "export class Config" packages/core/src/config/Config.ts

# ToolRegistry class
grep -A 10 "export class ToolRegistry" packages/core/src/tools/tool-registry.ts

# Part type from @google/genai
grep -r "from '@google/genai'" packages/core/src --include="*.ts" | head -5

# ContextAwareTool interface
grep -A 15 "interface ContextAwareTool" packages/core/src/tools/tool-context.ts

# PolicyEngine
grep -A 10 "PolicyEngine" packages/core/src/policy --include="*.ts" | head -10

# MessageBus types
grep -A 10 "MessageBusType" packages/core/src/confirmation-bus/types.ts
```

**Expected Output:**
- ToolCallRequestInfo and ToolCallResponseInfo exist in turn.ts
- Config class exists with policyEngine, messageBus, toolRegistry properties
- ToolRegistry exists with getTool, getAllTools methods
- Part type is imported from @google/genai
- ContextAwareTool interface exists
- PolicyEngine exists with evaluate method
- MessageBusType enum exists

### 3. Call Path Verification

Verify the code paths described in the plan actually exist:

```bash
# coreToolScheduler.ts exists and is ~2139 lines
wc -l packages/core/src/core/coreToolScheduler.ts

# Key methods exist in coreToolScheduler
grep -E "schedule\(|launchToolExecution|publishBufferedResults|attemptExecutionOfScheduledCalls|convertToFunctionResponse|buildInvocation" packages/core/src/core/coreToolScheduler.ts | head -10

# executeToolWithHooks exists
grep -A 5 "export.*executeToolWithHooks" packages/core/src/core/coreToolHookTriggers.ts

# Tool hook triggers exist
grep -E "triggerBeforeToolHook|triggerAfterToolHook|triggerToolNotificationHook" packages/core/src/core/coreToolHookTriggers.ts

# doesToolInvocationMatch exists in tool-utils
grep "export.*doesToolInvocationMatch" packages/core/src/utils/tool-utils.ts

# toolOutputLimiter exists
grep -A 5 "limitOutputTokens" packages/core/src/utils/toolOutputLimiter.ts

# fileUtils exists
ls packages/core/src/utils/fileUtils.ts
```

**Expected Output:**
- coreToolScheduler.ts is ~2000-2200 lines
- All key methods exist in coreToolScheduler
- executeToolWithHooks exists
- Hook triggers exist
- doesToolInvocationMatch exists
- toolOutputLimiter exists
- fileUtils.ts exists

### 4. Test Infrastructure Verification

Verify test files and patterns:

```bash
# Main test file exists
ls packages/core/src/core/coreToolScheduler.test.ts

# Test file size (should be substantial)
wc -l packages/core/src/core/coreToolScheduler.test.ts

# Test patterns
grep -E "describe\(|it\(|test\(" packages/core/src/core/coreToolScheduler.test.ts | head -10

# Verify Vitest is configured
grep -r "vitest" packages/core/vitest.config.ts

# Check if tests run
npm test -- --run coreToolScheduler.test.ts 2>&1 | head -20
```

**Expected Output:**
- coreToolScheduler.test.ts exists
- Test file has substantial content (>500 lines)
- Test patterns use describe/it/test
- Vitest is configured
- Tests can be executed

### 5. File Structure Verification

Verify the target directories exist:

```bash
# Core directories
ls -la packages/core/src/core/
ls -la packages/core/src/utils/
ls -la packages/core/src/tools/

# Verify no scheduler directory exists yet
ls packages/core/src/scheduler/ 2>&1 || echo "Good: scheduler/ does not exist yet"

# Check generateContentResponseUtilities exists
ls packages/core/src/utils/generateContentResponseUtilities.ts

# Check fileUtils exists
ls packages/core/src/utils/fileUtils.ts

# Check tool-utils exists
ls packages/core/src/utils/tool-utils.ts
```

**Expected Output:**
- Core directories exist
- scheduler/ does NOT exist yet (will be created)
- generateContentResponseUtilities.ts exists
- fileUtils.ts exists
- tool-utils.ts exists

## Preflight Verification Checklist

Create this checklist and verify each item:

### Dependencies Verified
- [ ] @google/genai: Version found
- [ ] fast-levenshtein: Version found
- [ ] diff: Version found
- [ ] vitest: Version found

### Types Verified
- [ ] ToolCallRequestInfo: Exists in turn.ts
- [ ] ToolCallResponseInfo: Exists in turn.ts
- [ ] Config: Exists with policyEngine, messageBus, toolRegistry
- [ ] ToolRegistry: Exists with getTool, getAllTools
- [ ] Part: Imported from @google/genai
- [ ] ContextAwareTool: Interface exists
- [ ] PolicyEngine: Exists with evaluate
- [ ] MessageBusType: Enum exists

### Call Paths Verified
- [ ] coreToolScheduler.ts: ~2139 lines
- [ ] schedule(): Method exists
- [ ] launchToolExecution: Method exists
- [ ] publishBufferedResults: Method exists
- [ ] attemptExecutionOfScheduledCalls: Method exists
- [ ] convertToFunctionResponse: Method exists (inline in scheduler)
- [ ] buildInvocation: Method exists
- [ ] executeToolWithHooks: Exists in coreToolHookTriggers
- [ ] Hook triggers: All three exist
- [ ] doesToolInvocationMatch: Exists in tool-utils
- [ ] limitOutputTokens: Exists in toolOutputLimiter

### Test Infrastructure Verified
- [ ] coreToolScheduler.test.ts: Exists
- [ ] Test file size: >500 lines
- [ ] Test patterns: describe/it/test found
- [ ] Vitest configured: Yes
- [ ] Tests runnable: npm test works

### File Structure Verified
- [ ] Core directories exist: Yes
- [ ] scheduler/ does NOT exist: Correct
- [ ] generateContentResponseUtilities.ts: Exists
- [ ] fileUtils.ts: Exists
- [ ] tool-utils.ts: Exists

## Blocking Issues Found

List any issues that MUST be resolved before proceeding:

**[Fill in after running verification commands]**

## Verification Gate

**This phase MUST pass before ANY implementation phase begins.**

- [ ] All dependencies verified
- [ ] All types match expectations
- [ ] All call paths are possible
- [ ] Test infrastructure ready
- [ ] File structure correct

**IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.**

## Phase Completion

After completing verification:

1. Document any discrepancies in "Blocking Issues Found" section
2. If issues found, update affected phase files in the plan
3. Create completion marker: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P00a.md`
4. Update execution-tracker.md with completion status

## Structural Verification Checklist

- [ ] All dependency commands (`npm ls`) completed without errors
- [ ] All type/interface grep searches found expected declarations
- [ ] All call path searches found expected method signatures
- [ ] All test infrastructure files exist
- [ ] All core directories exist
- [ ] File line counts match expected ranges (coreToolScheduler.ts ~2000-2200 lines, test file >500 lines)
- [ ] All grep patterns returned results (no empty output for required searches)
- [ ] No "UNMET PEER DEPENDENCY" or missing package errors
- [ ] scheduler/ directory does NOT exist yet

## Semantic Verification Checklist

- [ ] Dependencies are installed and functional (not just listed in package.json)
- [ ] Type interfaces include all required properties (e.g., Config has policyEngine, messageBus, toolRegistry)
- [ ] Method signatures match expected behavior (e.g., schedule(), executeToolWithHooks())
- [ ] Test file contains actual test cases (not just empty describe blocks)
- [ ] Vitest configuration is complete and valid
- [ ] Tests can actually execute (npm test runs without configuration errors)
- [ ] Import paths for types are correct (@google/genai package exports Part type)
- [ ] No version conflicts between dependencies
- [ ] Build tooling is correctly configured

## Success Criteria

This phase passes when:

1. All verification commands execute successfully
2. All types exist and match assumptions from design.md
3. All call paths are confirmed to exist
4. Test infrastructure is ready
5. No blocking issues remain

## Failure Recovery

If this phase fails:

1. Document blocking issues in the "Blocking Issues Found" section
2. Update affected phase files based on discrepancies found
3. Do not proceed to Phase 01 until all verification gates pass
4. If critical dependencies are missing, install them before proceeding

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P00a.md`

Contents:
```markdown
Phase: P00a
Completed: [TIMESTAMP]
Verification Results:
  - Dependencies: [PASS/FAIL]
  - Types: [PASS/FAIL]
  - Call Paths: [PASS/FAIL]
  - Test Infrastructure: [PASS/FAIL]
  - File Structure: [PASS/FAIL]
Blocking Issues: [List any issues found]
Gate Status: [PASSED/FAILED]
```

## Notes for Coordinator

This is a verification-only phase. No implementation is performed. The output is a report of what exists and what needs to be created. Use this report to validate the plan before starting Phase 01.
