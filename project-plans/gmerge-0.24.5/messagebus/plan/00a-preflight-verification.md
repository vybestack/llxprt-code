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

## Phase Completion Marker
```bash
echo "PLAN-20260303-MESSAGEBUS.P00a COMPLETE: Preflight verified, $(grep -rln 'messageBus\|MessageBus' packages/core/src/ --include='*.ts' | grep -v test | wc -l | tr -d ' ') production files in scope"
```
