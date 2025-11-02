# Phase 12: Anthropic/Gemini Provider Implementation

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P12`

## Prerequisites

- Required: Phase 11a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P11a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Failing Anthropic/Gemini stateless tests
  - Pseudocode document `anthropic-gemini-stateless.md`

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/anthropic/AnthropicProvider.ts`
  - Refactor to use runtime-scoped clients/auth tokens only
  - Remove instance-level caches and config references
  - Ensure streaming and tool usage derive from `GenerateChatOptions`
  - Reference pseudocode lines

- `packages/core/src/providers/gemini/GeminiProvider.ts`
  - Mirror stateless pattern, including OAuth fallback handling
  - Update Gemini-specific helper methods to read from runtime context

- `packages/core/src/providers/anthropic/__tests__/anthropic.stateless.test.ts`
- `packages/core/src/providers/gemini/__tests__/gemini.stateless.test.ts`
  - Remove expected failures; ensure tests pass

- Shared helpers (e.g., `packages/core/src/test-utils/runtime.ts`, `packages/core/src/providers/integration/multi-provider.integration.test.ts`) as needed to align with new contracts

### Required Code Markers

```typescript
/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P12
 * @requirement REQ-SP2-001
 * @pseudocode anthropic-gemini-stateless.md lines X-Y
 */
```

## Verification Commands

### Automated Checks

```bash
npm test -- --run anthropic.stateless
npm test -- --run gemini.stateless
npm run test:multi-runtime
npm run lint
npm run typecheck
```

### Manual Verification Checklist

- [ ] Anthropics and Gemini tests pass
- [ ] No instance-level state remains
- [ ] Multi-runtime guardrail passes
- [ ] Pseudocode references present

## Success Criteria

- Anthropic and Gemini providers fully stateless per call

## Failure Recovery

1. Revert provider files
2. Reapply changes using pseudocode as blueprint

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P12.md`

```markdown
Phase: P12
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/anthropic/AnthropicProvider.ts
- packages/core/src/providers/gemini/GeminiProvider.ts
- packages/core/src/providers/anthropic/__tests__/anthropic.stateless.test.ts
- packages/core/src/providers/gemini/__tests__/gemini.stateless.test.ts
- packages/core/src/test-utils/runtime.ts
Verification:
- <paste command outputs>
```
