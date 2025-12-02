# Phase 20: Final Integration Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P20`

## Prerequisites

- Required: Phase 19 completed
- Verification: Integration tests exist and partially pass
- Expected files from previous phase: Integration test files
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This is the final phase. It completes any remaining integration wiring to make all tests pass and verifies the complete end-to-end workflow.

## Requirements Implemented (Expanded)

### REQ-INT-001: Complete Integration

**Implementation**:
- Ensure all integration points are properly wired
- Verify provider works with actual CLI workflow
- Confirm no regressions in existing functionality

## Implementation Tasks

### 1. Verify Export Chain

Ensure the complete export chain works:

```
packages/core/src/providers/openai-vercel/index.ts
  → packages/core/src/providers/index.ts
    → packages/core/src/index.ts (if applicable)
```

### 2. Verify BaseProvider Compatibility

Ensure OpenAIVercelProvider properly extends BaseProvider and implements all required methods:

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P20
// @requirement:REQ-INT-001

// Verify these methods work correctly:
// - getAuthToken() from BaseProvider
// - Settings integration
// - Configuration handling
```

### 3. Final Wiring Checks

Files that may need updates and their exact purposes:

**Core Package**:
- `packages/core/src/providers/ProviderManager.ts` - Provider instantiation and routing
- `packages/core/src/providers/index.ts` - Public exports

**CLI Package**:
- `packages/cli/src/providers/providerManagerInstance.ts` - Singleton provider manager for CLI
- `packages/cli/src/ui/commands/providerCommand.ts` - `/provider` command (verify completions)

**Configuration**:
- `packages/core/src/config/defaults.ts` - Default model for openaivercel (if applicable)

### Semantic Verification Checklist (5 Behavioral Questions)

Answer these 5 questions to verify the complete integration:

1. **Does INPUT -> OUTPUT work as specified?**
   - [ ] `--provider openaivercel` argument -> provider is active
   - [ ] `--keyfile ~/.synthetic_key` argument -> API key is loaded
   - [ ] `--model "hf:zai-org/GLM-4.6"` argument -> model is set
   - [ ] `--prompt "Hello"` argument -> gets response (with valid key)

2. **Can I trigger this behavior manually?**
   - [ ] Run: `node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"`
   - [ ] Verify response is received from provider

3. **What happens with edge cases?**
   - [ ] No API key -> clear error before API call
   - [ ] Invalid model -> helpful error message
   - [ ] Rate limit -> error with provider context

4. **Does round-trip/integration work?**
   - [ ] Tool call -> tool result -> response with context
   - [ ] Multi-turn conversation preserves history
   - [ ] Switching providers preserves conversation

5. **Is the feature observable in the system?**
   - [ ] All tests pass (`npm run test`)
   - [ ] CI passes (`npm run ci:test`)
   - [ ] Build succeeds (`npm run build`)
   - [ ] Smoke test works: `node scripts/start.js --profile-load synthetic --prompt "just say hi"`

## Verification Commands

### Full Test Suite

```bash
# Run ALL provider tests
npm run test -- packages/core/src/providers/openai-vercel/

# Run CLI integration tests
npm run test -- packages/cli/src/providers/__tests__/

# Run full CI suite
npm run ci:test

# Type checking
npm run typecheck

# Linting
npm run lint

# Format check
npm run format

# Build
npm run build
```

### Manual Verification

**IMPORTANT**: All verification must use command-line arguments, NOT interactive slash commands. Agents cannot use /slash commands in interactive mode.

```bash
# Test with synthetic profile settings
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"

# Test basic prompt
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "Hello, can you hear me?"

# Test profile loading (alternative)
node scripts/start.js --profile-load synthetic --prompt "just say hi"
```

### Semantic Verification Checklist

- [ ] Provider works with `--provider openaivercel` argument
- [ ] API key loads from file with `--keyfile ~/.synthetic_key` argument
- [ ] Base URL can be set with `--base-url` argument
- [ ] Model can be set with `--model` argument
- [ ] Simple prompt gets response via `--prompt` argument (with valid API key)
- [ ] Tool calls work correctly
- [ ] Streaming works correctly
- [ ] Error messages are helpful

**CLI Test Command**:
```bash
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"
```

## Success Criteria

### Structural Verification

- [ ] All tests pass
- [ ] TypeScript compiles without errors
- [ ] Linting passes
- [ ] Build succeeds

### Behavioral Verification

- [ ] User can switch to openaivercel provider
- [ ] User can configure API key
- [ ] User can list models
- [ ] User can get responses (with valid key)
- [ ] Tool calls work end-to-end
- [ ] Error messages identify provider

### Integration Verification

- [ ] Works with HistoryService
- [ ] Works with ToolScheduler
- [ ] Works with existing CLI commands
- [ ] No regressions in other providers

## Final Checklist

Before marking implementation complete:

```bash
# 1. All tests pass
npm run test -- packages/core/src/providers/openai-vercel/
# Expected: All pass

# 2. CI test suite passes
npm run ci:test
# Expected: All pass

# 3. Type checking passes
npm run typecheck
# Expected: No errors

# 4. Linting passes
npm run lint
# Expected: No errors

# 5. Format check
npm run format
# Expected: No changes needed

# 6. Build succeeds
npm run build
# Expected: No errors

# 7. Manual smoke test
node scripts/start.js --profile-load synthetic --prompt "just say hi"
# Expected: Works without errors
```

## Plan Markers Verification

```bash
# Check all files have plan markers
grep -r "@plan:PLAN-20251127-OPENAIVERCEL" packages/core/src/providers/openai-vercel/
# Expected: Multiple matches in each file

# Check requirement markers
grep -r "@requirement:REQ-" packages/core/src/providers/openai-vercel/
# Expected: Multiple matches

# Verify pseudocode references
grep -r "@pseudocode" packages/core/src/providers/openai-vercel/
# Expected: References to pseudocode files
```

## Failure Recovery

If any verification fails:
1. Review failing test output
2. Check related phase implementation
3. Verify type compatibility
4. Fix issues and re-run verification
5. Do NOT proceed until all checks pass

## Related Files

- All files in `packages/core/src/providers/openai-vercel/`
- `packages/core/src/providers/ProviderManager.ts`
- `packages/core/src/providers/index.ts`
- `packages/cli/src/providers/providerManagerInstance.ts`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P20.md`
Contents:

```markdown
Phase: P20
Completed: YYYY-MM-DD HH:MM

## Final Verification Results

### Test Results
- Unit tests: PASS/FAIL [count]
- Integration tests: PASS/FAIL [count]
- CI suite: PASS/FAIL

### Quality Checks
- TypeScript: PASS/FAIL
- Linting: PASS/FAIL
- Build: PASS/FAIL

### Manual Verification
- /provider openaivercel: PASS/FAIL
- /key command: PASS/FAIL
- /models command: PASS/FAIL
- Basic prompt: PASS/FAIL

### Regression Check
- Existing providers: PASS/FAIL
- Existing tests: PASS/FAIL

## Files Created/Modified

### New Files
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
- packages/core/src/providers/openai-vercel/utils.ts
- packages/core/src/providers/openai-vercel/errors.ts
- packages/core/src/providers/openai-vercel/index.ts
- packages/core/src/providers/openai-vercel/__tests__/*.test.ts

### Modified Files
- packages/core/src/providers/ProviderManager.ts
- packages/core/src/providers/index.ts

## Requirements Coverage

| REQ-ID | Covered | Tested | Verified |
|--------|---------|--------|----------|
| REQ-OAV-001 | YES | YES | YES |
| REQ-OAV-002 | YES | YES | YES |
| REQ-OAV-003 | YES | YES | YES |
| REQ-OAV-004 | YES | YES | YES |
| REQ-OAV-005 | YES | YES | YES |
| REQ-OAV-006 | YES | YES | YES |
| REQ-OAV-007 | YES | YES | YES |
| REQ-OAV-008 | YES | YES | YES |
| REQ-OAV-009 | YES | YES | YES |
| REQ-INT-001 | YES | YES | YES |

## Implementation Complete

All phases completed. OpenAIVercelProvider is ready for use.
```

---

## Plan Complete

Upon successful completion of Phase 20, the OpenAI Vercel Provider implementation is complete with:

1. **Full IProvider implementation**
2. **Vercel AI SDK integration**
3. **Tool ID normalization**
4. **Message format conversion**
5. **Streaming and non-streaming generation**
6. **Error handling with custom error types**
7. **Model listing**
8. **Provider registration**
9. **CLI command integration**
10. **Complete test coverage**

Users can now use the provider via command-line arguments:
```bash
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"
```

Available CLI arguments:
- `--provider openaivercel` - Select the OpenAI Vercel provider
- `--keyfile path/to/keyfile` - Load API key from file  
- `--model "model-name"` - Set the model to use
- `--base-url "https://custom.api.com/v1"` - Set custom API endpoint
- `--prompt "message"` - Send a prompt in non-interactive mode

**IMPORTANT**: Interactive slash commands (`/provider`, `/key`, `/keyfile`, etc.) only work in interactive mode. For agent testing and automation, always use command-line arguments.
