# Phase 05: Token Store Implementation

## Objective
Implement MultiProviderTokenStore to make all tests pass.

## Input
- Failing tests from phase 04
- analysis/pseudocode/token-store.md
- specification.md schemas

## Implementation Requirements

### Core Functionality
1. Implement all TokenStore interface methods
2. Use fs.promises for async file operations
3. Ensure atomic writes (write to temp, rename)
4. Set 0600 permissions on token files
5. Create directories if they don't exist

### Implementation Guidelines
```typescript
// Follow this structure from pseudocode:
class MultiProviderTokenStore {
  private basePath = path.join(os.homedir(), '.llxprt', 'oauth')
  
  async saveToken(provider: string, token: OAuthToken): Promise<void> {
    // 1. Ensure directory exists with proper permissions
    // 2. Validate token structure with Zod
    // 3. Write to temp file first
    // 4. Set 0600 permissions
    // 5. Atomic rename to final location
  }
  
  async getToken(provider: string): Promise<OAuthToken | null> {
    // 1. Check file exists
    // 2. Read with error handling
    // 3. Parse and validate with Zod
    // 4. Return null on any error
  }
}
```

### Required Validations
- Use OAuthTokenSchema from specification
- Validate on save and load
- Handle corrupted files gracefully

### Security Requirements
- chmod 0600 on all token files
- Use path.join to prevent path traversal
- No token logging

## Forbidden
- Do NOT modify any tests
- No console.log statements
- No TODO comments
- No shortcuts or simplifications

## Verification
- Run: npm test packages/core/src/auth/token-store.spec.ts
- All tests must pass
- Check file permissions are 0600
- Verify atomic writes work correctly