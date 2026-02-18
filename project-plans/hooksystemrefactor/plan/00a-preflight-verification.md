# Phase 00a: Preflight Verification

## Phase ID
`PLAN-20250218-HOOKSYSTEM.P00a`

## Purpose
Verify ALL assumptions before writing any code. This phase prevents the most common
planning failures: missing types, impossible call patterns, wrong interface shapes.

---

## 1. Dependency Verification

### Required packages already in project

```bash
# Verify vitest is available (test runner)
npm ls vitest
# Expected: vitest@x.x.x in dependency tree

# Verify fast-check is available (property-based testing)
npm ls fast-check
# Expected: fast-check@x.x.x in dependency tree

# Verify TypeScript strict mode is enabled
grep -r '"strict": true' packages/core/tsconfig.json
# Expected: match found
```

| Dependency | Command | Status |
|------------|---------|--------|
| vitest | `npm ls vitest` | [ ] |
| fast-check | `npm ls fast-check` | [ ] |
| TypeScript strict | grep tsconfig | [ ] |

---

## 2. Type / Interface Verification

### 2.1 HookEventName enum

```bash
grep -A 20 "HookEventName" packages/core/src/hooks/types.ts
# Expected: enum with BeforeTool, AfterTool, BeforeAgent, AfterAgent,
#           BeforeModel, AfterModel, BeforeToolSelection, Notification,
#           SessionStart, SessionEnd
```

### 2.2 AggregatedHookResult

```bash
grep -A 15 "AggregatedHookResult" packages/core/src/hooks/*.ts
# Expected: interface with hookResults[], success, allOutputs[], errors[], totalDuration
```

### 2.3 EMPTY_SUCCESS_RESULT constant

```bash
grep -rn "EMPTY_SUCCESS_RESULT" packages/core/src/hooks/
# Expected: declared in hookEventHandler.ts or types.ts; currently returned by reference
```

### 2.4 SessionStartSource / SessionEndReason enums

```bash
grep -rn "SessionStartSource\|SessionEndReason" packages/core/src/hooks/
# Expected: both enum definitions found in types.ts
```

### 2.5 Config.getWorkingDir() vs getTargetDir()

```bash
grep -rn "getWorkingDir\|getTargetDir" packages/core/src/
# Expected: getWorkingDir() exists on Config; determine which is currently used in hook code
```

### 2.6 MessageBus interface shape

```bash
grep -A 20 "interface MessageBus\|class MessageBus" packages/core/src/
# Expected: subscribe(channel, handler) and publish(channel, payload) methods present
```

### 2.7 DebugLogger interface shape

```bash
grep -A 15 "interface DebugLogger\|class DebugLogger" packages/core/src/
# Expected: log(category: string, record: unknown) or similar method present
```

### 2.8 HookPlanner, HookRunner, HookAggregator, HookTranslator

```bash
grep -rn "class HookPlanner\|class HookRunner\|class HookAggregator\|class HookTranslator" packages/core/src/hooks/
# Expected: all four classes found in hooks directory
```

### 2.9 HookTranslator model translation methods

```bash
grep -rn "translateBeforeModel\|translateAfterModel\|translateBeforeToolSelection" packages/core/src/hooks/
# Expected: methods exist on HookTranslator for each model event type
```

| Type | Expected Shape | Match? |
|------|----------------|--------|
| HookEventName | enum with 10 values | [ ] |
| AggregatedHookResult | hookResults, success, allOutputs, errors, totalDuration | [ ] |
| EMPTY_SUCCESS_RESULT | constant, currently returned by reference | [ ] |
| SessionStartSource | enum | [ ] |
| SessionEndReason | enum | [ ] |
| Config.getWorkingDir() | method exists | [ ] |
| MessageBus | subscribe + publish methods | [ ] |
| DebugLogger | log(category, record) method | [ ] |
| HookPlanner | createPlan(eventName, input) | [ ] |
| HookRunner | execute(plan) -> results | [ ] |
| HookAggregator | aggregate(results) -> AggregatedHookResult | [ ] |
| HookTranslator | translateBeforeModel*, translateAfterModel*, translateBeforeToolSelection* | [ ] |

---

## 3. Call Path Verification

### 3.1 Existing fire*Event call sites

```bash
grep -rn "fire.*Event\|fireBeforeTool\|fireAfterTool\|fireSession" packages/core/src/core/coreToolHookTriggers.ts
# Expected: direct calls to fire*Event methods; these must continue working
```

### 3.2 Current hookEventHandler.ts structure

```bash
wc -l packages/core/src/hooks/hookEventHandler.ts
grep -n "class \|METHOD\|async \|function " packages/core/src/hooks/hookEventHandler.ts | head -40
# Expected: existing methods include fire*Event, possibly executeHooksCore or inline variants
```

### 3.3 Current hookSystem.ts structure

```bash
wc -l packages/core/src/hooks/hookSystem.ts
grep -n "class \|constructor\|dispose\|setHook\|getAll" packages/core/src/hooks/hookSystem.ts | head -30
# Expected: HookSystem class with constructor; may lack dispose(), setHookEnabled(), getAllHooks()
```

### 3.4 Current EMPTY_SUCCESS_RESULT usage (fraud pattern to eliminate)

```bash
grep -rn "return EMPTY_SUCCESS_RESULT\|return.*EMPTY_SUCCESS" packages/core/src/hooks/hookEventHandler.ts
# Expected: one or more return sites that Phase A/D will replace
```

### 3.5 Existing hook test files

```bash
ls packages/core/src/hooks/*.test.ts 2>/dev/null || echo "No test files found"
# Expected: hooks-caller-application.test.ts and hooks-caller-integration.test.ts exist
```

| Call Path | Evidence | Possible? |
|-----------|----------|-----------|
| fire*Event in coreToolHookTriggers.ts | grep output | [ ] |
| HookSystem constructs HookEventHandler | grep output | [ ] |
| EMPTY_SUCCESS_RESULT returned by reference | grep output | [ ] |
| HookTranslator used in fireBeforeModel etc. | grep output | [ ] |

---

## 4. Test Infrastructure Verification

```bash
# Verify existing hook tests run
cd packages/core && npm test -- --grep "hook" 2>&1 | tail -20
# Expected: tests pass; count of passing tests > 0

# Verify vitest config
cat packages/core/vitest.config.ts 2>/dev/null || cat packages/core/vitest.config.js 2>/dev/null
# Expected: test configuration present

# Verify fast-check usage pattern in project
grep -rn "fc\." packages/core/src --include="*.test.ts" | head -5
# Expected: fast-check already used OR confirm we need to import it fresh
```

| Infrastructure | File Exists? | Patterns Work? |
|----------------|-------------|----------------|
| hooks-caller-application.test.ts | [ ] | [ ] |
| hooks-caller-integration.test.ts | [ ] | [ ] |
| vitest config | [ ] | [ ] |
| fast-check available | [ ] | [ ] |

---

## 5. Critical Pre-Implementation Checks

### 5.1 getWorkingDir() audit (Rule TY4)

```bash
# Check which config method is used for cwd in current hook code
grep -rn "getWorkingDir\|getTargetDir" packages/core/src/hooks/
# If getTargetDir is used, Phase A must fix this before any other phase
```

**IF `getWorkingDir()` is absent from Config**: STOP. Record as BLOCKING-ISSUE-001 in §6 below.
Add phase 00b to the plan that implements `getWorkingDir()` on Config before proceeding to P03.
Do NOT proceed to any implementation phase until this is resolved.

### 5.2 String vs HookEventName enum audit (Rule TY1)

```bash
grep -rn "eventName.*string\|: string.*event" packages/core/src/hooks/hookEventHandler.ts
# Expected: internal routing uses string; Phase A converts to HookEventName enum
```

### 5.3 hookBusContracts.ts does NOT already exist

```bash
ls packages/core/src/hooks/hookBusContracts.ts 2>/dev/null && echo "EXISTS" || echo "DOES NOT EXIST"
# Expected: DOES NOT EXIST (Phase B creates it)
```

### 5.4 hookValidators.ts does NOT already exist

```bash
ls packages/core/src/hooks/hookValidators.ts 2>/dev/null && echo "EXISTS" || echo "DOES NOT EXIST"
# Expected: DOES NOT EXIST (Phase C creates it)
```

---

## 6. Blocking Issues

Document any issues found that require plan modification before proceeding:

```
Issue 1: [description]
  Impact: [which phases affected]
  Resolution: [required plan change]
```

---

## Verification Gate

- [ ] All dependencies verified (vitest, fast-check, TypeScript strict)
- [ ] All types match plan expectations
- [ ] All call paths verified (fire*Event, hookSystem, HookEventHandler constructor)
- [ ] Test infrastructure ready (existing tests pass)
- [ ] getWorkingDir() vs getTargetDir() audited
- [ ] EMPTY_SUCCESS_RESULT return sites identified
- [ ] hookBusContracts.ts confirmed absent
- [ ] hookValidators.ts confirmed absent
- [ ] No blocking issues found (or plan updated to address them)

**IF ANY CHECKBOX IS UNCHECKED: STOP and resolve before proceeding to Phase P03.**

## Phase Completion Marker

Create: `project-plans/hooksystemrefactor/.completed/P00a.md`

```markdown
Phase: P00a
Completed: YYYY-MM-DD HH:MM
Blocking Issues Found: [list or "none"]
All Verifications Passed: YES/NO
```
