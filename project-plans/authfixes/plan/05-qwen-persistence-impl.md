# Phase 05: Qwen Persistence Implementation

## Phase ID
`PLAN-20250823-AUTHFIXES.P05`

## Prerequisites
- Required: Phase 04 completed
- Verification: `npm test packages/cli/test/auth/qwen-oauth-provider.test.ts 2>&1 | grep -c "failing"`
- Expected: Tests exist and fail

## Implementation Tasks

### Files to Modify

1. **`/packages/cli/src/auth/qwen-oauth-provider.ts`**
   - UPDATE to make ALL tests pass
   - MUST follow pseudocode EXACTLY from analysis/pseudocode/qwen-oauth-provider.md
   - Reference pseudocode line numbers in comments
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P05`

### Implementation Following Pseudocode

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P05
 * @requirement REQ-001.1
 * @pseudocode lines 6-15
 */
constructor(private tokenStore?: TokenStore) {
  // Line 7: SET this.tokenStore = tokenStore
  this.tokenStore = tokenStore;
  
  // Lines 8-13: SET config
  const config: DeviceFlowConfig = {
    clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
    authorizationEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
    tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
    scopes: ['openid', 'profile', 'email', 'model.completion'],
  };
  
  // Line 14: SET this.deviceFlow = new QwenDeviceFlow(config)
  this.deviceFlow = new QwenDeviceFlow(config);
  
  // Line 15: CALL this.initializeToken()
  this.initializeToken();
}

/**
 * @pseudocode lines 17-26
 */
private async initializeToken(): Promise<void> {
  // Line 18: TRY
  try {
    // Line 19: SET savedToken = AWAIT this.tokenStore.getToken('qwen')
    const savedToken = await this.tokenStore?.getToken('qwen');
    
    // Line 20: IF savedToken AND NOT this.isTokenExpired(savedToken)
    if (savedToken && !this.isTokenExpired(savedToken)) {
      // Line 21: RETURN
      return;
    }
  } catch (error) {
    // Line 24: LOG "Failed to load token: " + error
    console.error('Failed to load token:', error);
  }
}
```

### Requirements

1. Do NOT modify any existing tests
2. UPDATE existing file (no new versions)
3. Implement EXACTLY what pseudocode specifies
4. Reference pseudocode line numbers in comments
5. All tests must pass
6. No console.log or debug code (except where specified in pseudocode)
7. No TODO comments

## Verification Commands

```bash
# All tests pass
npm test packages/cli/test/auth/qwen-oauth-provider.test.ts
# Expected: All tests passing

# No test modifications
git diff packages/cli/test/auth/ | grep -E "^[+-]" | grep -v "^[+-]{3}"
# Expected: No output (tests unchanged)

# Verify pseudocode was followed
grep -c "@pseudocode" packages/cli/src/auth/qwen-oauth-provider.ts
# Expected: 8+ references

# No debug code (except specified console.error)
grep -r "console\.log\|TODO\|FIXME\|XXX" packages/cli/src/auth/qwen-oauth-provider.ts
# Expected: No results

# Mutation testing
npx stryker run --mutate packages/cli/src/auth/qwen-oauth-provider.ts
# Expected: >80% mutation score
```

## Success Criteria

- All tests pass
- No test modifications
- Pseudocode followed exactly
- Line number references in comments
- >80% mutation score

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/auth/qwen-oauth-provider.ts`
2. Review pseudocode alignment
3. Re-run Phase 05

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P05.md`