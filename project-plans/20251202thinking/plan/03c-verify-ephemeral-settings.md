# Phase 03c: Verify Ephemeral Settings Registration

## Phase ID

`PLAN-20251202-THINKING.P03c`

## Prerequisites

- Required: Phase 03b completed
- Verification: `cat project-plans/20251202thinking/.completed/P03b.md`

## Purpose

Verify that reasoning ephemeral settings are correctly registered and accessible.

## Verification Tasks

### 1. Interface Verification

```bash
# Check AgentRuntimeContext.ts has reasoning in ephemerals interface
grep -A 15 "readonly ephemerals:" packages/core/src/runtime/AgentRuntimeContext.ts | grep -q "reasoning:"
echo "Exit code: $? (0 = found)"

# Check settings interface has reasoning properties
grep "reasoning\." packages/core/src/runtime/AgentRuntimeContext.ts | wc -l
# Expected: >= 7 lines (one for each setting)
```

### 2. Implementation Verification

```bash
# Check createAgentRuntimeContext has reasoning getters
grep -A 30 "const ephemerals = {" packages/core/src/runtime/createAgentRuntimeContext.ts | grep -q "reasoning:"
echo "Exit code: $? (0 = found)"

# Check defaults are defined
grep -A 10 "EPHEMERAL_DEFAULTS" packages/core/src/runtime/createAgentRuntimeContext.ts | grep -q "reasoning:"
echo "Exit code: $? (0 = found)"
```

### 3. TypeScript Compilation

```bash
npm run typecheck
# Expected: No errors
```

### 4. Unit Test (if test file exists)

```bash
# Run runtime context tests
npm test -- --run packages/core/src/runtime/
```

## Semantic Verification Checklist

### Test Case: Default Values

```typescript
// Expected behavior
context.ephemerals.reasoning.enabled() === true
context.ephemerals.reasoning.includeInContext() === false
context.ephemerals.reasoning.includeInResponse() === true
context.ephemerals.reasoning.format() === 'field'
context.ephemerals.reasoning.stripFromContext() === 'none'
context.ephemerals.reasoning.effort() === undefined
context.ephemerals.reasoning.maxTokens() === undefined
```

### Test Case: Setting Override

```typescript
// When settings contain:
settings: {
  'reasoning.includeInContext': true,
  'reasoning.stripFromContext': 'allButLast',
}
// Then:
context.ephemerals.reasoning.includeInContext() === true
context.ephemerals.reasoning.stripFromContext() === 'allButLast'
```

## Success Criteria

- [ ] All 7 reasoning settings have working getters
- [ ] Defaults match specification
- [ ] Settings can be overridden via options
- [ ] TypeScript compiles
- [ ] No regression in existing tests

## REQ-THINK-006.6 Verification Note

**Requirement**: All `reasoning.*` settings MUST be saveable via `/profile save`

**Verification Status**: This requirement is verified implicitly during this phase because:

1. **P03b Implementation**: Reasoning settings are registered in the ephemeral settings system as standard settings (not custom/special settings)
2. **Existing Profile Mechanism**: The `/profile save` command already saves all settings from the settings service, including ephemeral settings
3. **No Special Handling Required**: Since reasoning settings follow the standard ephemeral pattern, they automatically work with the existing profile save/load flow

**Explicit Verification** (optional, can be done manually after implementation):
```bash
# 1. Set some reasoning settings
/set reasoning.includeInContext true
/set reasoning.stripFromContext allButLast

# 2. Save profile
/profile save test-reasoning

# 3. Change settings
/set reasoning.includeInContext false
/set reasoning.stripFromContext none

# 4. Load profile
/profile load test-reasoning

# 5. Verify settings restored
# reasoning.includeInContext should be true
# reasoning.stripFromContext should be 'allButLast'
```

This explicit verification should be done during E2E testing (Phase 16) or manual testing, not during this structural verification phase.

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P03c.md`
