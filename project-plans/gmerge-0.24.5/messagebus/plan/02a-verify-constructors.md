# Phase 02a: Verify Standardized Constructors

## Phase ID
`PLAN-20260303-MESSAGEBUS.P02a`

## Prerequisites
- Phase 02 completed

## Verification Tasks

### 1. All createInvocation methods accept messageBus
```bash
# Find all createInvocation definitions
grep -rn "createInvocation" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" | grep "messageBus"
# Count should match total createInvocation definitions
```

### 2. Agent invocations accept messageBus
```bash
grep -n "messageBus" packages/core/src/agents/local-invocation.ts
grep -n "messageBus" packages/core/src/agents/remote-invocation.ts
grep -n "messageBus" packages/core/src/agents/delegate-to-agent-tool.ts
grep -n "messageBus" packages/core/src/agents/subagent-tool-wrapper.ts
```

### 3. Full test suite
```bash
npm run typecheck
npm run test
npm run lint
```

## Success Criteria
- Every `createInvocation()` method accepts `messageBus` parameter
- All agent invocations accept `messageBus`
- All tests pass

## Failure Recovery
Compare against upstream `90be9c35876d` diff if tests fail.

## Phase Completion Marker
```bash
echo "PLAN-20260303-MESSAGEBUS.P02a COMPLETE"
```
