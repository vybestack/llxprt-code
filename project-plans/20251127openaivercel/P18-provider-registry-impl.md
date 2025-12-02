# Phase 18: Provider Registry Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P18`

## Prerequisites

- Required: Phase 17 completed
- Verification: Provider registry tests fail as expected
- Expected files from previous phase: `providerRegistry.test.ts`, `providerCommand.openaivercel.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase implements the provider registration to make all tests from Phase 17 pass. This wires the OpenAIVercelProvider into the existing system.

## Requirements Implemented (Expanded)

### REQ-INT-001.1: ProviderManager Registration

**Implementation**:
- Add OpenAIVercelProvider to provider factory/registry
- Update ProviderManager switch statements
- Export provider from providers index

### REQ-OAV-001.1: Provider Selection via CLI

**Implementation**:
- Provider becomes available via `--provider openaivercel` CLI argument
- No CLI code changes needed - just provider registration

**CLI Testing Format**:
```bash
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"
```

**IMPORTANT**: All testing must use command-line arguments, NOT interactive slash commands.

## Implementation Tasks

### File: `packages/core/src/providers/ProviderManager.ts`

**Exact modification locations** (verify line numbers when implementing):

1. **Import section** (around lines 1-20):
   ```typescript
   // @plan:PLAN-20251127-OPENAIVERCEL.P18
   import { OpenAIVercelProvider } from './openai-vercel/OpenAIVercelProvider.js';
   ```

2. **Provider factory/switch statement** (search for existing provider cases):
   ```typescript
   // @plan:PLAN-20251127-OPENAIVERCEL.P18
   // @requirement:REQ-INT-001.1
   case 'openaivercel': {
     return new OpenAIVercelProvider(/* constructor args per BaseProvider pattern */);
   }
   ```

3. **Provider names array** (if exists, search for `getProviderNames` or similar):
   - Add `'openaivercel'` to the list

### File: `packages/core/src/providers/index.ts`

**Location**: Add to exports section

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P18
export { OpenAIVercelProvider } from './openai-vercel/index.js';
```

### File: `packages/core/src/providers/openai-vercel/index.ts`

**Full file content**:

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P18
// @requirement:REQ-INT-001.1

export { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
export * from './errors.js';
export * from './toolIdUtils.js';
```

### Semantic Verification Checklist (5 Behavioral Questions)

Answer these 5 questions to verify the feature actually works:

1. **Does INPUT -> OUTPUT work as specified?**
   - [ ] `ProviderManager.getProviderNames()` includes `'openaivercel'`
   - [ ] `ProviderManager.getProvider('openaivercel')` returns OpenAIVercelProvider instance

2. **Can I trigger this behavior manually?**
   - [ ] Run: `node -e "const pm = new ProviderManager(...); console.log(pm.getProviderNames())"`
   - [ ] Verify 'openaivercel' is in the list

3. **What happens with edge cases?**
   - [ ] `getProvider('openaivercel')` before any config returns uninitialized provider
   - [ ] Provider can be switched to/from other providers

4. **Does round-trip/integration work?**
   - [ ] Set provider active, then get active provider - returns correct provider
   - [ ] Provider settings are applied correctly

5. **Is the feature observable in the system?**
   - [ ] All P17 tests PASS
   - [ ] CLI `/provider` command shows openaivercel
   - [ ] Type checking passes

## Implementation Pseudocode Reference

The registration follows the existing provider pattern:

```
Per 001-tool-id-normalization.md:
- Provider uses normalizeToOpenAIToolId for outgoing tool IDs
- Provider uses normalizeToHistoryToolId for incoming tool IDs

Per 002-message-conversion.md:
- Provider converts IContent to CoreMessage via convertToVercelMessages
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist in ProviderManager
grep "@plan:PLAN-20251127-OPENAIVERCEL.P18" packages/core/src/providers/ProviderManager.ts

# Run registry tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistry.test.ts

# Run CLI command tests
npm run test -- packages/cli/src/ui/commands/__tests__/providerCommand.openaivercel.test.ts

# Run all provider tests to ensure no regressions
npm run test -- packages/core/src/providers/
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers in modified files
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/providers/ProviderManager.ts | grep openaivercel
# Expected: No matches
```

### Semantic Verification Checklist

- [ ] OpenAIVercelProvider is imported in ProviderManager
- [ ] Case 'openaivercel' added to switch statement
- [ ] Provider factory creates OpenAIVercelProvider instance
- [ ] Provider exported from providers/index.ts
- [ ] All P17 tests PASS
- [ ] TypeScript compilation passes
- [ ] No regressions in existing provider tests

## Success Criteria

- All registry tests from P17 PASS
- OpenAIVercelProvider is discoverable via ProviderManager
- Provider can be activated via setActiveProvider('openaivercel')
- No regressions in existing providers

## Fraud Prevention Checklist (TDD GREEN Phase)

Before marking this phase complete, verify:

- [ ] Implementation is MINIMAL to pass tests (no extra features)
- [ ] All P17 tests now PASS (TDD Green)
- [ ] No implementation code was written BEFORE tests
- [ ] Provider is actually instantiated (not stubbed)
- [ ] Type checking passes
- [ ] All previous tests still pass (no regressions)

### Anti-Pattern Detection

```bash
# Check for deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/providers/ProviderManager.ts | grep -i vercel
# Expected: No matches

# Verify all tests pass including previous phases
npm run test -- packages/core/src/providers/openai-vercel/
# Expected: All pass
```

## Integration Verification

```bash
# Verify provider is accessible end-to-end
node -e "
const { ProviderManager } = require('./packages/core/dist/providers/ProviderManager.js');
const pm = new ProviderManager(/* minimal config */);
const names = pm.getProviderNames();
console.log('Available providers:', names);
console.log('Has openaivercel:', names.includes('openaivercel'));
"
```

## Failure Recovery

If this phase fails:
1. Review test error messages
2. Check ProviderManager import paths
3. Verify OpenAIVercelProvider constructor signature
4. Check BaseProvider compatibility
5. Update implementation to match existing provider patterns

## Related Files

- `packages/core/src/providers/ProviderManager.ts`
- `packages/core/src/providers/index.ts`
- `packages/core/src/providers/openai-vercel/index.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P18.md`
Contents:

```markdown
Phase: P18
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/ProviderManager.ts [diff stats]
- packages/core/src/providers/index.ts [diff stats]
Tests Passing: [count from P17]
Verification:
- Provider discoverable: YES/NO
- Provider activatable: YES/NO
- No regressions: YES/NO
```
