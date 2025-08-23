# Phase 15: Integration with Existing System (REVISED)

## Phase ID
`PLAN-20250823-AUTHFIXES.P15`

## Prerequisites
- Required: Phase 14 completed
- Verification: `npm test packages/cli/test/auth/`
- Expected: All unit tests passing

## Integration Tasks

### Files to Modify for Integration

1. **`/packages/cli/src/index.ts`** (Lines 45-89)
   - VERIFY OAuthManager initialized with TokenStore
   - VERIFY providers registered with TokenStore on startup
   - ADD token validation on CLI initialization
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P15`

2. **`/packages/core/src/providers/anthropic/AnthropicProvider.ts`** (Lines 99-104)
   - UPDATE error messages for expired OAuth
   - ADD specific command hints: "Use /auth anthropic to re-authenticate"
   - ADD logout hint: "Use /auth anthropic logout to clear session"
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P15`

3. **`/packages/core/src/providers/gemini/GeminiProvider.ts`** (Lines 125-129, 214-220)
   - REMOVE magic string check for 'USE_LOGIN_WITH_GOOGLE'
   - UPDATE determineBestAuth to use real tokens
   - REMOVE special case return in oauth-manager.ts
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P15`

4. **`/packages/cli/src/auth/oauth-manager.ts`** (Lines 214-220)
   - REMOVE special Gemini handling that returns fake token
   - Gemini should use real OAuth flow like other providers

### End-to-End Integration Tests

Create **`/packages/cli/test/integration/auth-e2e.integration.test.ts`**:

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P15
 * @requirement REQ-004
 * End-to-end integration tests for OAuth authentication
 */
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

describe('OAuth Authentication End-to-End Integration', () => {
  const tokenPath = join(homedir(), '.llxprt', 'oauth');
  
  beforeEach(async () => {
    // Clean token directory
    await fs.rm(tokenPath, { recursive: true, force: true });
  });

  /**
   * @requirement REQ-001
   * @scenario Tokens persist across CLI restarts
   */
  it('should persist tokens across complete CLI restarts', async () => {
    // Step 1: Save a valid token
    const validToken = {
      access_token: 'test-token-123',
      refresh_token: 'refresh-456',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer'
    };
    
    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(
      join(tokenPath, 'qwen.json'),
      JSON.stringify(validToken),
      { mode: 0o600 }
    );
    
    // Step 2: Start CLI and verify no re-authentication required
    const cli = spawn('npm', ['run', 'cli'], {
      env: { ...process.env, SKIP_AUTH_PROMPT: 'true' }
    });
    
    let output = '';
    cli.stdout.on('data', (data) => { output += data.toString(); });
    
    // Send a command that requires auth
    cli.stdin.write('/auth qwen\n');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify no authentication prompt appeared
    expect(output).not.toContain('Visit this URL to authorize');
    expect(output).toContain('authenticated');
    
    cli.kill();
  });

  /**
   * @requirement REQ-002
   * @scenario Logout removes access completely
   */
  it('should completely remove access after logout command', async () => {
    // Step 1: Setup authenticated state
    const token = {
      access_token: 'valid-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer'
    };
    
    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(
      join(tokenPath, 'anthropic.json'),
      JSON.stringify(token)
    );
    
    // Step 2: Run logout command
    const cli = spawn('npm', ['run', 'cli']);
    
    cli.stdin.write('/auth anthropic logout\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 3: Verify token file removed
    const tokenExists = await fs.access(join(tokenPath, 'anthropic.json'))
      .then(() => true)
      .catch(() => false);
    
    expect(tokenExists).toBe(false);
    
    // Step 4: Try to use provider - should fail
    cli.stdin.write('/model anthropic:claude-3-opus\n');
    cli.stdin.write('Hello\n');
    
    let errorOutput = '';
    cli.stderr.on('data', (data) => { errorOutput += data.toString(); });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    expect(errorOutput).toContain('authentication');
    
    cli.kill();
  });

  /**
   * @requirement REQ-003
   * @scenario Expired tokens trigger refresh automatically
   */
  it('should automatically refresh expired tokens on use', async () => {
    // Step 1: Save nearly-expired token with refresh token
    const expiringToken = {
      access_token: 'old-access',
      refresh_token: 'valid-refresh',
      expiry: Math.floor(Date.now() / 1000) + 25, // Expires in 25 seconds
      token_type: 'Bearer'
    };
    
    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(
      join(tokenPath, 'qwen.json'),
      JSON.stringify(expiringToken)
    );
    
    // Step 2: Use CLI - should trigger refresh
    const cli = spawn('npm', ['run', 'cli']);
    
    let output = '';
    cli.stdout.on('data', (data) => { output += data.toString(); });
    
    cli.stdin.write('/model qwen\n');
    cli.stdin.write('Test message\n');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 3: Check token file was updated
    const updatedToken = JSON.parse(
      await fs.readFile(join(tokenPath, 'qwen.json'), 'utf8')
    );
    
    expect(updatedToken.access_token).not.toBe('old-access');
    expect(updatedToken.expiry).toBeGreaterThan(expiringToken.expiry);
    
    cli.kill();
  });

  /**
   * @requirement REQ-004
   * @scenario Multiple providers work independently
   */
  it('should handle multiple providers with independent sessions', async () => {
    // Setup tokens for multiple providers
    const qwenToken = {
      access_token: 'qwen-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer'
    };
    
    const anthropicToken = {
      access_token: 'sk-ant-oat-123',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer'
    };
    
    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(join(tokenPath, 'qwen.json'), JSON.stringify(qwenToken));
    await fs.writeFile(join(tokenPath, 'anthropic.json'), JSON.stringify(anthropicToken));
    
    const cli = spawn('npm', ['run', 'cli']);
    
    // Logout from qwen only
    cli.stdin.write('/auth qwen logout\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Qwen token should be gone
    const qwenExists = await fs.access(join(tokenPath, 'qwen.json'))
      .then(() => true)
      .catch(() => false);
    expect(qwenExists).toBe(false);
    
    // Anthropic token should remain
    const anthropicExists = await fs.access(join(tokenPath, 'anthropic.json'))
      .then(() => true)
      .catch(() => false);
    expect(anthropicExists).toBe(true);
    
    cli.kill();
  });

  /**
   * @requirement REQ-001, REQ-004
   * @scenario Real user workflow - authenticate once, use across sessions
   */
  it('should support real user workflow without re-authentication', async () => {
    // Simulate complete user workflow
    
    // 1. First session - authenticate
    const session1 = spawn('npm', ['run', 'cli']);
    
    // Mock successful authentication
    const token = {
      access_token: 'user-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer'
    };
    await fs.mkdir(tokenPath, { recursive: true });
    await fs.writeFile(join(tokenPath, 'anthropic.json'), JSON.stringify(token));
    
    session1.kill();
    
    // 2. Second session - should work without auth
    const session2 = spawn('npm', ['run', 'cli']);
    
    let output2 = '';
    session2.stdout.on('data', (data) => { output2 += data.toString(); });
    
    session2.stdin.write('/auth anthropic\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    expect(output2).toContain('authenticated');
    expect(output2).not.toContain('Visit this URL');
    
    session2.kill();
    
    // 3. Third session - logout
    const session3 = spawn('npm', ['run', 'cli']);
    
    session3.stdin.write('/auth anthropic logout\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    session3.kill();
    
    // 4. Fourth session - requires re-auth
    const session4 = spawn('npm', ['run', 'cli']);
    
    let output4 = '';
    session4.stdout.on('data', (data) => { output4 += data.toString(); });
    
    session4.stdin.write('/auth anthropic\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    expect(output4).toContain('not authenticated');
    
    session4.kill();
  });
});
```

### Remove Deprecated Code

1. **Remove magic string usage**:
   ```typescript
   // DELETE from oauth-manager.ts lines 214-220:
   // Special handling for Gemini
   if (providerName === 'gemini') {
     return {
       access_token: 'USE_LOGIN_WITH_GOOGLE',
       token_type: 'Bearer',
       expiry: Date.now() / 1000 + 3600,
     } as OAuthToken;
   }
   ```

2. **Remove magic string check from GeminiProvider.ts lines 125-129**:
   ```typescript
   // DELETE:
   if (token === 'USE_LOGIN_WITH_GOOGLE') {
     this.authMode = 'oauth';
     return token;
   }
   ```

### Integration Verification Script

Create **`/scripts/verify-oauth-integration.sh`**:

```bash
#!/bin/bash
# @plan PLAN-20250823-AUTHFIXES.P15
# Verify OAuth integration works end-to-end

set -e

echo "=== OAuth Integration Verification ==="

# 1. Check token persistence
echo "1. Testing token persistence..."
TOKEN_DIR="$HOME/.llxprt/oauth"
mkdir -p "$TOKEN_DIR"
echo '{"access_token":"test","expiry":9999999999,"token_type":"Bearer"}' > "$TOKEN_DIR/test.json"

# Start CLI and check no auth required
echo "/auth test" | timeout 5 npm run cli 2>&1 | grep -q "authenticated" && \
  echo "✓ Token loaded from disk" || \
  echo "✗ Token not loaded"

# 2. Test logout
echo "2. Testing logout..."
echo "/auth test logout" | timeout 5 npm run cli 2>&1
[ ! -f "$TOKEN_DIR/test.json" ] && \
  echo "✓ Token removed on logout" || \
  echo "✗ Token not removed"

# 3. Test multiple providers
echo "3. Testing multiple providers..."
echo '{"access_token":"qwen","expiry":9999999999,"token_type":"Bearer"}' > "$TOKEN_DIR/qwen.json"
echo '{"access_token":"anthropic","expiry":9999999999,"token_type":"Bearer"}' > "$TOKEN_DIR/anthropic.json"

echo "/auth qwen logout" | timeout 5 npm run cli 2>&1
[ ! -f "$TOKEN_DIR/qwen.json" ] && [ -f "$TOKEN_DIR/anthropic.json" ] && \
  echo "✓ Independent provider sessions" || \
  echo "✗ Provider sessions not independent"

# 4. Check no magic strings
echo "4. Checking magic strings removed..."
! grep -r "USE_LOGIN_WITH_GOOGLE" packages/cli/src packages/core/src --exclude-dir=test && \
  echo "✓ Magic strings removed" || \
  echo "✗ Magic strings still present"

echo "=== Integration Verification Complete ==="
```

## Verification Commands

```bash
# Run end-to-end integration tests
npm test packages/cli/test/integration/auth-e2e.integration.test.ts
# Expected: All tests pass

# Run integration verification script
chmod +x scripts/verify-oauth-integration.sh
./scripts/verify-oauth-integration.sh
# Expected: All checks pass

# Manual CLI test - persistence
echo '{"access_token":"test","expiry":9999999999,"token_type":"Bearer"}' > ~/.llxprt/oauth/qwen.json
echo "/auth qwen" | npm run cli
# Expected: Shows "authenticated" without prompting

# Manual CLI test - logout
echo "/auth qwen logout" | npm run cli
ls ~/.llxprt/oauth/qwen.json 2>/dev/null
# Expected: File not found

# Check magic strings removed
grep -r "USE_LOGIN_WITH_GOOGLE" packages/ --exclude-dir=test --exclude-dir=node_modules
# Expected: No results

# Full system test
npm run lint && npm run typecheck && npm test
# Expected: All pass
```

## Success Criteria

- End-to-end tests verify complete user workflows
- Tokens persist across actual CLI restarts
- Logout completely removes access
- Multiple providers work independently
- No magic strings in production code
- Integration verification script passes
- Real user can authenticate once and use across sessions

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P15.md`