# Phase 16: Full Codebase Migration

## Phase ID
`PLAN-20250120-DEBUGLOGGING.P16`

## Prerequisites
- Phase 15 completed (OpenAI provider migrated)
- Verification: No if(DEBUG) in OpenAI provider

## Implementation Tasks

### Files to Modify (All Remaining Providers and Services)

#### UPDATE All Gemini Provider Files

**Files to update:**
- `packages/core/src/providers/gemini/GeminiProvider.ts`
- `packages/core/src/providers/gemini/streaming.ts`
- `packages/core/src/providers/gemini/tools.ts`

Replace all `if (DEBUG)` patterns with:
```typescript
/**
 * @plan PLAN-20250120-DEBUGLOGGING.P16
 * @requirement REQ-INT-001.2
 */
import { DebugLogger } from '../../debug';
const logger = new DebugLogger('llxprt:gemini:[component]');
```

#### UPDATE All Anthropic Provider Files

**Files to update:**
- `packages/core/src/providers/anthropic/AnthropicProvider.ts`
- `packages/core/src/providers/anthropic/streaming.ts`
- `packages/core/src/providers/anthropic/tools.ts`

Replace patterns with appropriate namespaces:
- `llxprt:anthropic:provider`
- `llxprt:anthropic:streaming`
- `llxprt:anthropic:tools`

#### UPDATE Core Services

**Files to update:**
- `packages/core/src/services/memoryService.ts` → `llxprt:core:memory`
- `packages/core/src/services/contextService.ts` → `llxprt:core:context`
- `packages/core/src/services/toolScheduler.ts` → `llxprt:core:scheduler`
- `packages/core/src/services/loopDetectionService.ts` → `llxprt:core:loopdetect`

#### UPDATE CLI Components

**Files to update:**
- `packages/cli/src/index.ts` → `llxprt:cli:main`
- `packages/cli/src/ui/commands/index.ts` → `llxprt:cli:commands`
- `packages/cli/src/ui/renderer.ts` → `llxprt:cli:renderer`

### Migration Pattern

For each file:
1. Import DebugLogger
2. Create logger with appropriate namespace
3. Replace `if (DEBUG)` with `logger.debug()`
4. Use lazy evaluation for expensive operations
5. Add plan marker comment

Example migration:
```typescript
// BEFORE:
if (process.env.DEBUG) {
  console.log('Expensive operation:', JSON.stringify(largeObject));
}

// AFTER:
logger.debug(() => `Expensive operation: ${JSON.stringify(largeObject)}`);
```

### Clean Break

NO backward compatibility - users must use new format:
- `DEBUG=llxprt:*` (standard debug format)
- NOT `DEBUG=1` (old pattern - no longer supported)

## Final Verification

```bash
# No if(DEBUG) patterns remain
grep -r "if.*DEBUG\|process.env.DEBUG" packages --include="*.ts" | grep -v test | grep -v debug/
# Expected: 0 occurrences

# Count new logger usage
grep -r "DebugLogger\|logger.debug" packages --include="*.ts" | wc -l
# Expected: 50+ occurrences

# All tests pass
npm test
# Expected: All pass

# Performance benchmark
npm run benchmark:debug
# Expected: Zero overhead when disabled

# File output working
DEBUG=llxprt:* npm run dev
ls -la ~/.llxprt/debug/
# Expected: Log files created
```

## Migration Cleanup

After verification:
1. Update documentation to show new DEBUG=llxprt:* format
2. Add migration guide for users switching from DEBUG=1

## Success Criteria
- All if(DEBUG) patterns replaced
- Every component has debug logging
- All tests pass
- Performance goals met
- File output working
- REQ-INT-001 fully satisfied