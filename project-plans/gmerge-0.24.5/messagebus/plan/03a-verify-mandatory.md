# Phase 03a: Final Verification — Mandatory MessageBus Injection

## Phase ID
`PLAN-20260303-MESSAGEBUS.P03a`

## Prerequisites
- Phase 03 completed

## Verification Tasks

### 1. No service locator usage
```bash
result=$(grep -rn "config\.getMessageBus\|config\.setMessageBus" packages/ --include="*.ts" | grep -v "\.d\.ts" | wc -l)
if [ "$result" -ne 0 ]; then echo "FAIL: $result service locator references remain"; exit 1; fi
echo "PASS: No service locator usage"
```

### 2. No setMessageBus shim
```bash
result=$(grep -rn "setMessageBus" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" | wc -l)
if [ "$result" -ne 0 ]; then echo "FAIL: $result setMessageBus references remain"; exit 1; fi
echo "PASS: No setMessageBus shim"
```

### 3. Config class clean
```bash
result=$(grep -n "messageBus\|MessageBus" packages/core/src/config/config.ts | wc -l)
if [ "$result" -ne 0 ]; then echo "FAIL: Config still references MessageBus"; exit 1; fi
echo "PASS: Config class clean"
```

### 4. Full verification suite
```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

## Success Criteria
- All 4 structural checks pass (zero unwanted references)
- Full verification suite passes

## Failure Recovery
If structural checks fail, find remaining references and fix them. If tests fail, check that all test constructors provide MessageBus via `createMockMessageBus()`.

## Phase Completion Marker
```bash
echo "PLAN-20260303-MESSAGEBUS.P03a COMPLETE — MessageBus DI refactoring DONE"
echo "Service locator removed, all injection mandatory, $(grep -rln 'messageBus\|MessageBus' packages/core/src/ --include='*.ts' | grep -v test | wc -l | tr -d ' ') production files now use constructor injection"
```
