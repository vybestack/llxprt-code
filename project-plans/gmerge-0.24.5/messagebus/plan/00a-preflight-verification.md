# Phase 00a: Preflight Verification

## Phase ID
`PLAN-20260303-MESSAGEBUS.P00a`

## Prerequisites
- Branch `gmerge/0.24.5` checked out
- Clean working tree (no uncommitted changes)
- All tests passing: `npm run test`

## Requirements Implemented
None — this is a verification-only phase.

## Implementation Tasks

Verify the following exist and are accessible:

### 1. MessageBus interface
```bash
cat packages/core/src/confirmation-bus/message-bus.ts | head -40
```
Confirm: `MessageBus` interface exported with `publish()` and `subscribe()` methods.

### 2. Config service locator
```bash
grep -n "getMessageBus\|setMessageBus" packages/core/src/config/config.ts
```
Confirm: Both methods exist in Config class.

### 3. setMessageBus shim in ToolRegistry
```bash
grep -n "setMessageBus" packages/core/src/tools/tool-registry.ts
```
Confirm: Dead `setMessageBus()` stub exists.

### 4. Current test baseline
```bash
npm run test 2>&1 | tail -5
```
Confirm: All tests pass.

### 5. Scope validation
```bash
grep -rln "getMessageBus\|setMessageBus\|messageBus" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" | wc -l
```
Confirm: ~33 production files reference MessageBus.

## Verification Commands
```bash
npm run typecheck
npm run test
```

## Success Criteria
- MessageBus interface found at expected location
- Config.getMessageBus() exists (will be removed in Phase 3)
- ToolRegistry.setMessageBus() shim exists (will be removed in Phase 3)
- All tests pass (baseline)

## Failure Recovery
If tests fail BEFORE any changes, this is a pre-existing issue. Do NOT proceed. Report to user.

## Structural Verification Checklist

- [ ] MessageBus interface exists at `packages/core/src/confirmation-bus/message-bus.ts`
- [ ] MessageBus exports `publish()` and `subscribe()` methods
- [ ] `Config.getMessageBus()` exists (will be removed in Phase 3)
- [ ] `Config.setMessageBus()` exists (will be removed in Phase 3)
- [ ] `ToolRegistry.setMessageBus()` stub exists (will be removed in Phase 3)
- [ ] All tests pass (baseline established)
- [ ] TypeScript compiles without errors
- [ ] ~33 production files reference MessageBus

## Semantic Verification Checklist

**Behavioral Verification Questions**:

1. **Does the MessageBus interface support the required methods?**
   - [ ] Verified `publish()` method signature
   - [ ] Verified `subscribe()` method signature
   - [ ] Confirmed PolicyEngine integration exists

2. **Is the service locator pattern currently functional?**
   - [ ] `config.getMessageBus()` returns a valid MessageBus instance
   - [ ] Tools can call `config.getMessageBus()` when needed
   - [ ] MessageBus is properly initialized in Config

3. **Are tests actually passing?**
   - [ ] Ran `npm run typecheck` — PASS
   - [ ] Ran `npm run test` — PASS
   - [ ] Ran `npm run lint` — PASS

4. **Is the scope estimate accurate?**
   - [ ] Production file count matches actual grep results (33 files)
   - [ ] Reference count is substantiated (717 lines)

## Phase Completion Marker

**Create**: `project-plans/gmerge-0.24.5/messagebus/.completed/P00a.md`

**Contents**:
```markdown
# Phase 00a: Preflight Verification — COMPLETED

**Completed**: YYYY-MM-DD HH:MM
**Files Verified**: $(grep -rln 'messageBus\|MessageBus' packages/core/src/ --include='*.ts' | grep -v test | wc -l | tr -d ' ') production files in scope

## Verification Results

### MessageBus Interface
- Location: packages/core/src/confirmation-bus/message-bus.ts
- Methods: publish(), subscribe(), requestConfirmation(), etc.
- Status: [OK] Verified

### Service Locator (Current State)
- Config.getMessageBus(): EXISTS (to be removed Phase 3)
- Config.setMessageBus(): EXISTS (to be removed Phase 3)  
- ToolRegistry.setMessageBus(): EXISTS (to be removed Phase 3)
- Status: [OK] Verified

### Test Baseline
```
[Paste npm run test output summary here]
```

### Scope Validation
```bash
# Production files: 33
grep -rln "messageBus\|MessageBus" packages/core/src/ --include="*.ts" | grep -v test | wc -l

# Test files: 24
grep -rln "messageBus\|MessageBus" packages/core/src/ --include="*.ts" | grep test | wc -l

# Total references: 717
grep -rn "messageBus\|MessageBus" packages/core/src/ --include="*.ts" | wc -l
```

## Proceed to Phase 01
All prerequisites met. Ready to begin Phase 1 (Optional Parameters).
```
