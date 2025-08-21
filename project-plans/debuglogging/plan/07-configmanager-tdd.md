# Phase 07: ConfigurationManager TDD

## Phase ID
`PLAN-20250120-DEBUGLOGGING.P07`

## Prerequisites
- Phase 06 completed (ConfigurationManager stub exists)
- Verification: `grep -r "@plan:PLAN-20250120-DEBUGLOGGING.P06" packages/core/src/debug`

## Implementation Tasks

### Files to Create

#### `packages/core/src/debug/ConfigurationManager.test.ts`

Tests must cover:
- Configuration hierarchy (CLI > env > user > project > default)
- Ephemeral settings behavior
- Settings persistence
- Configuration merging
- Singleton pattern
- Event notifications

### Required Test Scenarios

1. **Configuration Loading**
   - Load from environment variables
   - Load from user config file
   - Load from project config file
   - Handle missing/invalid configs

2. **Configuration Precedence**
   - CLI overrides everything
   - Env overrides config files
   - User config overrides project config

3. **Ephemeral Settings**
   - Set ephemeral config
   - Persist ephemeral to user config
   - Clear ephemeral after persist

4. **Property-based Tests** (30% minimum)
   - Any valid namespace format
   - Any configuration combination
   - Merge operations commutative

## Verification Commands

```bash
# Check plan markers
grep -r "@plan:PLAN-20250120-DEBUGLOGGING.P07" packages/core/src/debug
# Expected: 10+ occurrences

# Tests fail naturally
npm test ConfigurationManager
# Expected: Fail with real errors
```

## Success Criteria
- Tests cover all configuration sources
- Hierarchy testing complete
- No reverse testing
- 30% property tests