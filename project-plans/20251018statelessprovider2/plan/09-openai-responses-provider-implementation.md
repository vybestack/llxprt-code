# Phase 09: OpenAI/Responses Provider Implementation

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P09`

## Prerequisites

- Required: Phase 08a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P08a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Failing OpenAI/Responses stateless tests
  - Pseudocode document `openai-responses-stateless.md`

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/openai/OpenAIProvider.ts`
  - Implement runtime-scoped client cache keyed by runtime ID + base URL + auth token
  - Remove reliance on instance fields (`_cachedClient`, `_cachedClientKey`)
  - Ensure all state derived from `GenerateChatOptions`
  - Reference pseudocode lines for each block

- `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts`
  - Mirror stateless handling for streaming responses
  - Ensure no instance-level mutations occur

- `packages/core/src/providers/openai/getOpenAIProviderInfo.ts`
  - Update helpers to read from runtime context instead of provider instance

- `packages/core/src/providers/openai/__tests__/openai.stateless.test.ts`  
- `packages/core/src/providers/openai-responses/__tests__/openaiResponses.stateless.test.ts`
  - Remove expected failures, ensure tests pass

- Update any shared helpers (e.g., `packages/core/src/test-utils/runtime.ts`) to support runtime-scoped caches

### Required Code Markers

```typescript
/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P09
 * @requirement REQ-SP2-001
 * @pseudocode openai-responses-stateless.md lines X-Y
 */
```

## Verification Commands

### Automated Checks

```bash
npm test -- --run openai.stateless
npm test -- --run openaiResponses.stateless
npm run test:multi-runtime
npm run lint
npm run typecheck
```

### Manual Verification Checklist

- [ ] All OpenAI/Responses stateless tests pass
- [ ] No instance fields store provider-specific state
- [ ] Pseudocode line numbers referenced in implementation
- [ ] Multi-runtime regression still passes

## Success Criteria

- OpenAI family providers are stateless per call

## Failure Recovery

1. Revert provider files
2. Reapply changes using pseudocode as blueprint

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P09.md`

```markdown
Phase: P09
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/openai/OpenAIProvider.ts
- packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts
- packages/core/src/providers/openai/getOpenAIProviderInfo.ts
- packages/core/src/providers/openai/__tests__/openai.stateless.test.ts
- packages/core/src/providers/openai-responses/__tests__/openaiResponses.stateless.test.ts
- packages/core/src/test-utils/runtime.ts
Verification:
- <paste command outputs>
```
