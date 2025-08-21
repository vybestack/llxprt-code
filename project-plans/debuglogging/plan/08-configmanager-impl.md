# Phase 08: ConfigurationManager Implementation

## Phase ID
`PLAN-20250120-DEBUGLOGGING.P08`

## Prerequisites
- Phase 07 completed (tests exist and fail)

## Implementation Tasks

### UPDATE `packages/core/src/debug/ConfigurationManager.ts`

Follow pseudocode from `analysis/pseudocode/ConfigurationManager.md`:

Key implementations:
- Lines 21-26: Singleton getInstance()
- Lines 28-40: Constructor with default config
- Lines 42-46: Load all configurations
- Lines 47-64: Load environment config (support DEBUG and LLXPRT_DEBUG)
- Lines 66-79: Load user config from ~/.llxprt/settings.json
- Lines 81-94: Load project config from .llxprt/config.json
- Lines 96-111: Merge configurations in priority order
- Lines 113-121: Set CLI and ephemeral configs
- Lines 123-150: Persist ephemeral to user config
- Lines 152-174: Getters and subscription management

### Critical Functionality

1. **Configuration Hierarchy** (Lines 96-108)
   - Merge in order: default → project → user → env → CLI → ephemeral
   - Later configs override earlier ones

2. **Environment Variables** (Lines 49-64)
   - Support DEBUG=llxprt:* format only
   - Support LLXPRT_DEBUG=llxprt:* format
   - No DEBUG=1 support (clean break)

3. **File Operations** (Lines 66-94, 123-150)
   - Handle missing files gracefully
   - Create directories as needed
   - Parse JSON safely

## Verification Commands

```bash
# All tests pass
npm test ConfigurationManager
# Expected: All green

# Check pseudocode compliance
grep -c "Line [0-9]" packages/core/src/debug/ConfigurationManager.ts
# Expected: 15+ line references

# Hierarchy test
DEBUG=llxprt:test npm test -- --grep "hierarchy"
# Expected: Env overrides config files
```

## Success Criteria
- All P07 tests pass
- Configuration hierarchy works
- Files load correctly
- Persistence works