# Phase 3: Provider Registration Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P03`

## Prerequisites

- Required: Phase 2 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts` fails with expected errors
- Expected files from previous phase: `providerRegistration.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase implements the minimal code to make the provider registration tests pass. Following TDD GREEN phase, we write only enough code to satisfy the failing tests.

## Requirements Implemented (Expanded)

### REQ-OAV-001: Provider Registration

**Full Text**: Provider must be selectable via `--provider openaivercel` CLI argument
**Implementation**:
- Create OpenAIVercelProvider class
- Implement IProvider interface
- Export from index.ts

**CLI Testing Format**:
```bash
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"
```

## Implementation Code

### File: `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P03
// @req:REQ-OAV-001

import type { IProvider, GenerationOptions, ModelInfo } from '../IProvider';
import type { IMessage, IContent } from '../../types';

export class OpenAIVercelProvider implements IProvider {
  private apiKey: string | undefined;
  private baseUrl: string | undefined;

  getId(): string {
    return 'openaivercel';
  }

  getName(): string {
    return 'OpenAI (Vercel AI SDK)';
  }

  setKey(key: string): void {
    this.apiKey = key;
  }

  async setKeyFile(path: string): Promise<void> {
    // Will be implemented in authentication phase
    throw new Error('Not yet implemented');
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  async *generateChatCompletion(
    messages: IMessage[],
    options: GenerationOptions
  ): AsyncIterable<IContent> {
    // Will be implemented in generation phases
    throw new Error('Not yet implemented');
  }

  async listModels(): Promise<ModelInfo[]> {
    // Will be implemented in model listing phase
    throw new Error('Not yet implemented');
  }
}
```

### File: `packages/core/src/providers/openai-vercel/index.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P03

export { OpenAIVercelProvider } from './OpenAIVercelProvider';
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P03" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v ".test.ts"
# Expected: No matches (we use explicit "Not yet implemented" errors instead)
```

### Semantic Verification Checklist (5 Behavioral Questions)

Answer these 5 questions to verify the feature actually works:

1. **Does INPUT -> OUTPUT work as specified?**
   - [ ] `new OpenAIVercelProvider().getId()` returns `'openaivercel'`
   - [ ] `new OpenAIVercelProvider().getName()` returns `'OpenAI (Vercel AI SDK)'`

2. **Can I trigger this behavior manually?**
   - [ ] Create a script that imports and instantiates the provider
   - [ ] Verify it doesn't throw on construction

3. **What happens with edge cases?**
   - [ ] Calling methods before configuration doesn't crash
   - [ ] Multiple instantiations work independently

4. **Does round-trip/integration work?**
   - [ ] Provider can be imported from the index.ts export
   - [ ] TypeScript types are correct

5. **Is the feature observable in the system?**
   - [ ] All P02 tests PASS
   - [ ] Type checking passes (`npm run typecheck`)

### Structural Verification Checklist

- [ ] OpenAIVercelProvider class exists
- [ ] Implements IProvider interface
- [ ] Plan markers present
- [ ] No deferred implementation markers

## Success Criteria

- All registration tests from P02 PASS
- Provider class implements IProvider interface
- Provider is exported from index.ts
- Type checking passes (`npm run typecheck`)

## Fraud Prevention Checklist (TDD GREEN Phase)

Before marking this phase complete, verify:

- [ ] Implementation is MINIMAL to pass tests (no extra features)
- [ ] All P02 tests now PASS (TDD Green)
- [ ] No implementation code was written BEFORE tests
- [ ] Methods that aren't tested yet throw "Not yet implemented"
- [ ] No logic that isn't covered by a test
- [ ] Type checking passes

### Anti-Pattern Detection

```bash
# Check for deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v ".test.ts"
# Expected: No matches (except explicit "Not yet implemented" throws)

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
# Expected: No matches

# Verify tests pass
npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts
# Expected: All pass
```

## Failure Recovery

If this phase fails:
1. Review test error messages
2. Check IProvider interface requirements
3. Verify TypeScript types match
4. Update implementation to match interface

## Related Files

- `packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts`
- `packages/core/src/providers/IProvider.ts`
- `packages/core/src/providers/anthropic/AnthropicProvider.ts` (reference)

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When implementation begins
- [ ] IN_PROGRESS → BLOCKED: If unexpected test failures
- [ ] IN_PROGRESS → COMPLETED: When all P02 tests PASS (TDD Green)
- [ ] BLOCKED → IN_PROGRESS: After issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P03.md`
Contents:

```markdown
Phase: P03
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
- packages/core/src/providers/openai-vercel/index.ts
Files Modified: [list with diff stats]
Tests Passing: [count from P02]
Test Run Output: [paste showing all P02 tests PASS]
Fraud Prevention Checklist: [all items checked]
```
