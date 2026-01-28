# Phase 10: Providers Stub

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P10`

## Prerequisites

- Required: Phase 09 completed
- Verification: `grep -r "@plan:PLAN-20260126-SETTINGS-SEPARATION.P09" .`

## Requirements Implemented (Expanded)

### REQ-SEP-005: Providers read from pre-separated modelParams
**Full Text**: Providers MUST read from pre-separated modelParams instead of filtering raw ephemerals.
**Behavior**:
- GIVEN: provider methods updated with stubs
- WHEN: methods are called
- THEN: signature accepts invocation.modelParams
**Why This Matters**: Prepares provider implementation for TDD.

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/openai/OpenAIProvider.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts`
- `packages/core/src/providers/anthropic/AnthropicProvider.ts`
- `packages/core/src/providers/gemini/GeminiProvider.ts`

Add stub methods/fields for:
- getModelParamsFromInvocation
- getCustomHeadersFromInvocation
- modelBehavior translation placeholder

MUST include `@plan:PLAN-20260126-SETTINGS-SEPARATION.P10`

## Verification Commands

```bash
npm run typecheck
```

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P10.md`
