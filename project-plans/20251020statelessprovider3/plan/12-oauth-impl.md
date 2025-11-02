# Phase 12: OAuth Safety Implementation

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P12`

## Prerequisites
- Required: Phase 11a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P11a.md`

## Implementation Tasks

### Files to Modify
- `packages/cli/src/auth/oauth-manager.ts`
  - Implement `unwrapLoggingProvider`.
  - Update `clearProviderAuthCaches` to guard missing providers and invoke the helper.
- `packages/core/src/providers/LoggingProviderWrapper.ts`
  - Ensure wrapped provider is exposed via `wrappedProvider` for unwrapping (no functional change, only type guard if required).

### Required Code Markers
Add implementation comments:
```ts
/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P12
 * @requirement REQ-SP3-003
 * @pseudocode oauth-safety.md lines 1-17
 */
```

## Verification Commands
```bash
npm run test --workspace @vybestack/llxprt-code -- --run packages/cli/src/auth/__tests__/oauthManager.safety.test.ts
```
Expect tests to pass.

## Manual Verification Checklist
- [ ] Missing provider short-circuits without error.
- [ ] Wrapped providers unwrap recursively before clearing state.
- [ ] Logging functionality unaffected.

## Success Criteria
- OAuth safety tests turn GREEN.

## Failure Recovery
If tests still fail, adjust implementation guided by pseudocode and rerun before Phase 12a.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P12.md`.
