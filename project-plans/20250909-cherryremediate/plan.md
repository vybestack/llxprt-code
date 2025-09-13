# Cherry-Pick Remediation Plan

**Date**: 2025-09-09
**Branch**: 20250908-gmerge
**Purpose**: Apply critical missing commits and adapt architecture improvements

## Executive Summary

This plan addresses 12 commits that were not applied during the main cherry-pick operation. These include critical bug fixes, Windows compatibility improvements, and architectural enhancements that need careful adaptation for llxprt's multi-provider architecture.

## Phase 1: Critical Bug Fixes (IMMEDIATE)

### 1.1 Process-Utils Startup Bug
**Commit**: `ad3bc17e4` - fix(process-utils): fix bug that prevented start-up when running process walking command fails (#7757)
**Impact**: HIGH - Could prevent llxprt from starting
**Action**: Cherry-pick directly

```bash
git cherry-pick ad3bc17e4
# Expected conflicts in packages/core/src/ide/process-utils.ts
# Fix: Ensure error handling doesn't crash the application
```

### 1.2 Windows Shell Argument Parsing
**Commit**: `19f2a07ef` - Fix shell argument parsing in windows (#7160)
**Impact**: HIGH - Breaks Windows support
**Action**: Cherry-pick and adapt

```bash
git cherry-pick 19f2a07ef
# Expected conflicts in shell command handling
# Fix: Adapt for llxprt's command processing
```

## Phase 2: Windows Compatibility

### 2.1 Diff Rendering in Windows
**Commit**: `af4fe611e` - Fix diff rendering in windows (#7254)
**Impact**: MEDIUM - Windows users cannot see diffs properly
**Action**: Adapt for llxprt's rendering system

**Adaptation needed**:
- Check if llxprt uses different diff rendering components
- Ensure path separators are handled correctly
- Test with Windows line endings (CRLF)

## Phase 3: Feature Adaptations

### 3.1 Compression Optimization
**Commit**: `cd2e237c7` - fix(compression): Discard compression result if it results in more token usage (#7047)
**Impact**: MEDIUM - Token cost savings
**Action**: Cherry-pick with provider adaptation

**Adaptation needed**:
- Ensure token counting works for all providers (not just Gemini)
- Test with different model token limits

### 3.2 TOML Command File Processing
**Commit**: `bfdddcbd9` - feat(commands): Enable @file processing in TOML commands (#6716)
**Impact**: MEDIUM - Feature enhancement
**Action**: Evaluate compatibility first

**Compatibility check**:
- Does llxprt support TOML configuration?
- How does this interact with multi-provider setup?
- Test with existing command structure

### 3.3 Settings Migration Fixes
**Commit**: `52cc0f6fe` - Fix setting migration nosiness and merging (#7571)
**Impact**: MEDIUM - User experience improvement
**Action**: Adapt for llxprt's settings structure

**Adaptation needed**:
- Map gemini-cli settings to llxprt equivalents
- Handle provider-specific settings migration

## Phase 4: Token Storage Architecture Enhancement

### 4.1 Background: MCP Token Storage is Orthogonal to Providers

MCP (Model Context Protocol) servers provide additional capabilities (file access, web browsing, etc.) to ANY model provider. Their authentication is completely independent:

1. **MCP tokens are shared across all providers** - One Google Drive MCP token works whether you're using Gemini, Qwen, or Anthropic
2. **MCP OAuth flows are determined by the MCP server** not the model provider (e.g., Google Drive MCP always uses Google OAuth)
3. **Switching providers doesn't affect MCP connections** - Your MCP tools remain authenticated

Example scenario:
```
User connects to Google Drive MCP → Authenticates with Google OAuth
  → Can use with Gemini provider ✓
  → Can use with Qwen provider ✓  
  → Can use with Anthropic provider ✓
  (Same MCP token for all providers)
```

### 4.2 Implementation Plan

Create a base token storage abstraction that works for both provider-specific and MCP tokens:

```typescript
// packages/core/src/auth/base-token-store.ts

import { OAuthToken } from './types.js';

/**
 * Abstract base class for token storage implementations
 * Provides common validation and utility methods
 */
export abstract class BaseTokenStore {
  /**
   * Validate token structure
   * @throws Error if token is invalid
   */
  protected validateToken(token: OAuthToken): void {
    if (!token.access_token) {
      throw new Error('Access token is required');
    }
    if (!token.token_type) {
      throw new Error('Token type is required');
    }
    if (token.expiry && typeof token.expiry !== 'number') {
      throw new Error('Token expiry must be a number (Unix timestamp)');
    }
  }

  /**
   * Check if token is expired or about to expire
   * @param token - The token to check
   * @param bufferSeconds - Buffer time before actual expiry (default: 300 seconds)
   * @returns true if token is expired or will expire within buffer time
   */
  protected isTokenExpired(token: OAuthToken, bufferSeconds = 300): boolean {
    if (!token.expiry) {
      return false; // No expiry means token doesn't expire
    }
    
    const now = Date.now() / 1000; // Convert to seconds
    return now > (token.expiry - bufferSeconds);
  }

  /**
   * Sanitize provider/server names for safe file system usage
   * @param name - The name to sanitize
   * @returns Sanitized name safe for file paths
   */
  protected sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_.]/g, '_').toLowerCase();
  }

  /**
   * Get storage path for MCP server tokens
   * MCP tokens are provider-independent
   * @param serverName - The MCP server name
   * @returns Storage key for MCP token
   */
  protected getMcpTokenKey(serverName: string): string {
    return `mcp_${this.sanitizeName(serverName)}`;
  }
}
```

### 4.3 Update MultiProviderTokenStore

```typescript
// packages/core/src/auth/token-store.ts

export class MultiProviderTokenStore extends BaseTokenStore implements TokenStore {
  private readonly basePath: string;

  constructor() {
    super();
    this.basePath = join(homedir(), '.llxprt', 'oauth');
  }

  async saveToken(provider: string, token: OAuthToken): Promise<void> {
    // Use base class validation
    this.validateToken(token);
    
    // Check for expiry
    if (this.isTokenExpired(token)) {
      throw new Error('Cannot save expired token');
    }

    // Existing save logic...
    await this.ensureDirectory();
    const tokenPath = this.getTokenPath(provider);
    // ... rest of implementation
  }

  // Add MCP-specific methods (provider-independent)
  async saveMcpToken(serverName: string, token: OAuthToken): Promise<void> {
    const key = this.getMcpTokenKey(serverName);
    await this.saveToken(key, token);
  }

  async getMcpToken(serverName: string): Promise<OAuthToken | null> {
    const key = this.getMcpTokenKey(serverName);
    const token = await this.getToken(key);
    
    // Check expiry before returning
    if (token && this.isTokenExpired(token)) {
      return null; // Return null for expired tokens
    }
    return token;
  }

  async removeMcpToken(serverName: string): Promise<void> {
    const key = this.getMcpTokenKey(serverName);
    await this.removeToken(key);
  }
  
  async listMcpServers(): Promise<string[]> {
    const allProviders = await this.listProviders();
    return allProviders
      .filter(p => p.startsWith('mcp_'))
      .map(p => p.substring(4)); // Remove 'mcp_' prefix
  }
}
```

### 4.4 Benefits

1. **Unified validation** - All token storage uses same validation rules
2. **Consistent expiry handling** - No expired tokens saved or used
3. **Clean separation** - MCP tokens are independent of provider tokens
4. **Future extensibility** - Easy to add KeychainTokenStore or other backends
5. **Backward compatible** - Existing code continues to work
6. **Simpler mental model** - MCP auth is clearly separate from provider auth

## Phase 5: Test Infrastructure Improvements

### 5.1 Firebase Studio IDE Detection Tests
**Commit**: `023053ed9` - fix(tests): Fix Firebase Studio to IDE detection tests (#7163)
**Action**: Apply if Firebase Studio is supported

### 5.2 E2E Test Dependencies
**Commit**: `5e8400629` - fix(e2e): add missing deps to fix sandbox module not found errors (#7256)
**Action**: Cherry-pick and verify dependencies

### 5.3 Skip Flaky Test
**Commit**: `b8a7bfd13` - fix(e2e): skip flaky stdin context test (#7264)
**Action**: Apply skip or fix the underlying issue

### 5.4 Test Reliability
**Commit**: `0c1f3acc7` - fix: make test more reliable (#7233)
**Action**: Review and apply improvements

## Execution Order

1. **Day 1**: Phase 1 (Critical Fixes)
   - Apply process-utils fix
   - Apply Windows shell parsing fix
   - Test on Windows

2. **Day 2**: Phase 2 & 3 (Compatibility & Features)
   - Fix Windows diff rendering
   - Apply compression optimization
   - Evaluate TOML commands
   - Apply settings migration

3. **Day 3**: Phase 4 (Architecture)
   - Implement BaseTokenStore
   - Update MultiProviderTokenStore
   - Add MCP token methods
   - Write tests

4. **Day 4**: Phase 5 (Tests)
   - Apply test fixes
   - Run full test suite
   - Fix any failures

## Verification Steps

### After Each Phase:
1. Run `npm run build`
2. Run `npm run test`
3. Test on Windows (if applicable)
4. Manual testing of affected features

### Final Verification:
1. Full build: `npm run build && npm run bundle`
2. Full test suite: `npm run test:ci`
3. Lint check: `npm run lint:ci`
4. Type check: `npm run typecheck`
5. Windows testing (critical)
6. Multi-provider OAuth testing

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Process-utils breaks other platforms | Test on macOS/Linux after fix |
| Windows fixes break Unix | Use platform-specific conditionals |
| Token storage changes break OAuth | Extensive testing, keep backups |
| MCP token complexity | Start simple, add features gradually |
| Test fixes mask real issues | Review why tests are flaky first |

## Success Criteria

- [ ] llxprt starts reliably on all platforms
- [ ] Windows users can run shell commands
- [ ] Diff rendering works on Windows
- [ ] Token storage has proper validation
- [ ] MCP tokens support multi-provider scenarios
- [ ] Test suite passes consistently
- [ ] No regression in existing functionality

## Notes

1. **Backup before starting**: Create a backup branch before applying any changes
2. **Test incrementally**: Test after each commit, not just at the end
3. **Document changes**: Update CHANGELOG.md with fixes
4. **Provider testing**: Test with at least 2 different providers (e.g., Gemini + Qwen)
5. **Windows CI**: Consider adding Windows CI if not present