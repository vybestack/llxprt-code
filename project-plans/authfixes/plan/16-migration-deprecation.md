# Phase 16: Migration and Deprecation

## Phase ID
`PLAN-20250823-AUTHFIXES.P16`

## Prerequisites
- Required: Phase 15 completed
- Verification: Integration tests passing
- Expected: System fully integrated

## Migration Tasks

### In-Memory Token Migration

Create **`/packages/cli/src/auth/migration.ts`**:
```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P16
 * @requirement REQ-004.2
 * Migrate any in-memory tokens to persistent storage
 */
export async function migrateInMemoryTokens(
  providers: Map<string, OAuthProvider>,
  tokenStore: TokenStore
): Promise<void> {
  for (const [name, provider] of providers) {
    // Check for in-memory token
    const token = await provider.getToken();
    if (token) {
      const stored = await tokenStore.getToken(name);
      if (!stored) {
        // Migrate to storage
        await tokenStore.saveToken(name, token);
        console.log(`Migrated ${name} token to persistent storage`);
      }
    }
  }
}
```

### Deprecation Tasks

1. **Remove old in-memory token variables**:
   - `qwen-oauth-provider.ts` line 17 (currentToken)
   - `anthropic-oauth-provider.ts` line 17 (currentToken)
   - `gemini-oauth-provider.ts` line 16 (currentToken)

2. **Add deprecation notices**:
   ```typescript
   // In each provider constructor
   if (!tokenStore) {
     console.warn(
       `DEPRECATION: ${this.name} OAuth provider created without TokenStore. ` +
       `Token persistence will not work. Please update your code.`
     );
   }
   ```

### Final Cleanup

1. **Remove placeholder implementations**:
   - Old Gemini placeholder that throws errors
   - Any remaining NotYetImplemented code

2. **Update documentation**:
   - Add logout command to help text
   - Document token persistence behavior

## Verification Commands

```bash
# Check for remaining currentToken variables
grep -r "private currentToken" packages/cli/src/auth/
# Expected: No results

# Check for NotYetImplemented
grep -r "NotYetImplemented" packages/ --exclude-dir=test
# Expected: No results in production code

# Run full test suite
npm test
# Expected: All tests passing

# Run linting
npm run lint
# Expected: No errors

# Run type checking
npm run typecheck
# Expected: No errors

# Mutation testing on critical paths
npx stryker run --mutate "packages/cli/src/auth/*.ts"
# Expected: >80% mutation score

# Final integration test
./scripts/test-oauth-flow.sh
# Expected: Full OAuth flow works with persistence
```

## Success Criteria

- No in-memory token storage remains
- Migration handles existing tokens
- Deprecation warnings in place
- All tests passing
- >80% mutation coverage
- Full OAuth flow works end-to-end

## Final Checklist

- [ ] All 16 phases completed
- [ ] All requirements (REQ-001 to REQ-004) implemented
- [ ] Integration tests verify end-to-end flow
- [ ] No isolated features - everything integrated
- [ ] Tokens persist across restarts
- [ ] Logout functionality works
- [ ] Magic strings removed
- [ ] Backward compatibility maintained
- [ ] No duplicate files (V2, New, Copy)
- [ ] Pseudocode followed exactly

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P16.md`

## Plan Completion

Create: `project-plans/authfixes/.completed/PLAN-COMPLETE.md`
With summary of:
- All requirements met
- Integration points verified
- Tests passing
- Migration complete