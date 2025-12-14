# Comprehensive TDD Implementation Plan for Codex OAuth Support

## Plan ID: PLAN-20251213-ISSUE160
## Generated: 2025-12-13
## Revised: 2025-12-13 (Post-verification fixes)
## Total Phases: 7 (with TDD subphases)
## Requirements: Issue #160 - Implement OpenAI Codex-style OAuth authentication

---

## Executive Summary

This plan implements Codex OAuth support for llxprt-code, enabling users to authenticate with OpenAI's Codex service (ChatGPT backend) using OAuth 2.0 PKCE flow. The implementation follows existing patterns from the Anthropic OAuth provider while adapting to Codex-specific requirements:

- **Endpoint**: `https://chatgpt.com/backend-api/codex`
- **OAuth Issuer**: `https://auth.openai.com`
- **Client ID**: `app_EMoamEEZ73f0CkXaXp7hrann`
- **Required Headers**: `ChatGPT-Account-ID`, `originator`
- **Required Body Params**: `store: false`, `stream: true`

---

## Architecture Overview

### Authentication Flow

```
User Request -> OpenAIResponsesProvider.isCodexMode()
                      |
                      v
              Codex OAuth Provider (codex-device-flow.ts)
                      |
                      v
              Token Store (~/.llxprt/oauth/codex.json)
              [Fallback read: ~/.codex/auth.json]
                      |
                      v
              ChatGPT Backend with custom headers
```

### Key Files to Create/Modify

1. **New Files**:
   - `/packages/core/src/auth/codex-device-flow.ts` - Codex OAuth PKCE flow implementation
   - `/packages/cli/src/auth/codex-oauth-provider.ts` - Codex OAuth provider for CLI
   - `/packages/cli/src/providers/aliases/codex.config` - Provider alias configuration (NO .json extension)

2. **Modified Files**:
   - `/packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts` - Add Codex mode
   - `/packages/cli/src/auth/oauth-provider-registration.ts` - Register Codex provider
   - `/packages/cli/src/ui/commands/authCommand.ts` - Add Codex to auth menu
   - `/packages/core/src/auth/types.ts` - Add CodexOAuthTokenSchema (Zod schema)
   - `/packages/core/src/auth/index.ts` - Export new types

---

## Phase Structure

Each phase follows strict TDD:
1. **Test Subagent**: Creates comprehensive tests (RED phase)
2. **Implementation Subagent**: Implements to pass tests (GREEN phase)
3. **Verification Subagent**: Ensures code quality, RULES.md compliance, no stubs

---

## Phase 1: Codex OAuth Token Management

### 1.1 Test Phase (TDD - RED)

**Test File**: `/packages/core/src/auth/__tests__/codex-device-flow.test.ts`

**Tests to Write**:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodexOAuthTokenSchema } from '../types.js';
import { z } from 'zod';

// 1. Zod Schema Validation Tests
describe('CodexOAuthTokenSchema', () => {
  it('should validate token with required account_id field', () => {
    const validToken = {
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600, // Unix timestamp in SECONDS
      account_id: 'test-account-id',
    };
    expect(() => CodexOAuthTokenSchema.parse(validToken)).not.toThrow();
  });

  it('should reject token without account_id', () => {
    const invalidToken = {
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    };
    expect(() => CodexOAuthTokenSchema.parse(invalidToken)).toThrow(z.ZodError);
  });

  it('should accept optional id_token field', () => {
    const tokenWithIdToken = {
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'test-account-id',
      id_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
    };
    expect(() => CodexOAuthTokenSchema.parse(tokenWithIdToken)).not.toThrow();
  });
});

// 2. Token Storage Tests
describe('CodexTokenStore', () => {
  it('should save token to ~/.llxprt/oauth/codex.json', async () => {
    // Uses MultiProviderTokenStore.saveToken('codex', token)
  });

  it('should read existing token from ~/.llxprt/oauth/codex.json', async () => {
    // Primary location
  });

  it('should fallback to ~/.codex/auth.json if llxprt token not found (read-only)', async () => {
    // Read-only fallback for Codex CLI compatibility
  });

  it('should never write to ~/.codex/ directory', async () => {
    // Verify no writes to external tool's storage
  });

  it('should detect expired tokens using expiry timestamp', async () => {
    // Test expiry detection with 30-second buffer
  });
});

// 3. JWT Parsing Tests
describe('JWT account_id extraction', () => {
  it('should extract account_id from id_token JWT payload', () => {
    // JWT format: header.payload.signature (base64url encoded)
    // Payload contains https://api.openai.com/auth.account_id
  });

  it('should throw error for invalid JWT format', () => {
    // Not a valid JWT structure
  });

  it('should throw error if account_id not found in JWT', () => {
    // Valid JWT but missing account_id claim
  });
});

// 4. Token Refresh Tests
describe('CodexTokenRefresh', () => {
  it('should refresh token before expiry using Zod validation', async () => {
    // Test refresh_token flow with OpenAI's token endpoint
    // Response parsed with CodexTokenResponseSchema
  });

  it('should handle refresh failure gracefully', async () => {
    // Test error handling when refresh fails
  });
});
```

**Requirements Tested**: Token storage, Zod schema validation, JWT parsing, refresh

### 1.2 Implementation Phase (GREEN)

**File**: `/packages/core/src/auth/types.ts` (modify existing)

Add Zod schema for Codex tokens:
```typescript
// Add to existing types.ts - follows existing OAuthTokenSchema pattern

/**
 * Codex OAuth token schema - extends base OAuthToken with account_id
 * Required for ChatGPT-Account-ID header
 */
export const CodexOAuthTokenSchema = OAuthTokenSchema.extend({
  account_id: z.string().describe('Required for ChatGPT-Account-ID header'),
  id_token: z.string().optional().describe('JWT containing account claims'),
});

export type CodexOAuthToken = z.infer<typeof CodexOAuthTokenSchema>;

/**
 * Codex token response schema for validation (no type assertions)
 */
export const CodexTokenResponseSchema = z.object({
  access_token: z.string(),
  id_token: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  token_type: z.string(),
});

export type CodexTokenResponse = z.infer<typeof CodexTokenResponseSchema>;
```

**File**: `/packages/core/src/auth/codex-device-flow.ts`

```typescript
import { DebugLogger } from '../debug/index.js';
import { CodexOAuthTokenSchema, CodexTokenResponseSchema, type CodexOAuthToken } from './types.js';
import { z } from 'zod';

// Codex-specific configuration
const CODEX_CONFIG = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  issuer: 'https://auth.openai.com',
  tokenEndpoint: 'https://auth.openai.com/oauth/token',
  authorizationEndpoint: 'https://auth.openai.com/authorize',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
} as const;

// JWT payload schema for account_id extraction
const JwtPayloadSchema = z.object({
  'https://api.openai.com/auth': z.object({
    chatgpt_account_id: z.string().optional(),
    account_id: z.string().optional(),
  }).optional(),
  account_id: z.string().optional(),
});

export class CodexDeviceFlow {
  private logger: DebugLogger;
  private codeVerifier: string | null = null;

  constructor() {
    this.logger = new DebugLogger('llxprt:auth:codex-device-flow');
  }

  // PKCE S256 implementation (same pattern as QwenDeviceFlow)
  private generatePKCE(): { verifier: string; challenge: string } {
    // Generate random verifier
    const verifier = this.generateRandomString(64);
    // SHA256 hash and base64url encode
    const challenge = this.computeS256Challenge(verifier);
    this.codeVerifier = verifier;
    return { verifier, challenge };
  }

  // Build authorization URL for browser
  buildAuthorizationUrl(redirectUri: string, state: string): string {
    const { challenge } = this.generatePKCE();
    const params = new URLSearchParams({
      client_id: CODEX_CONFIG.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: CODEX_CONFIG.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `${CODEX_CONFIG.authorizationEndpoint}?${params.toString()}`;
  }

  // Exchange authorization code for tokens - NO TYPE ASSERTIONS
  async exchangeCodeForToken(authCode: string, redirectUri: string): Promise<CodexOAuthToken> {
    if (!this.codeVerifier) {
      throw new Error('PKCE code verifier not initialized');
    }

    const response = await fetch(CODEX_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: CODEX_CONFIG.clientId,
        code_verifier: this.codeVerifier,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data: unknown = await response.json();

    // Validate with Zod schema - NO TYPE ASSERTIONS
    const tokenResponse = CodexTokenResponseSchema.parse(data);

    // Extract account_id from id_token JWT
    const accountId = tokenResponse.id_token
      ? this.extractAccountIdFromIdToken(tokenResponse.id_token)
      : this.throwMissingAccountId();

    // Build validated Codex token - use Unix timestamp in SECONDS (not milliseconds)
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = tokenResponse.expires_in || 3600; // Default 1 hour
    const expiry = now + expiresIn;

    const codexToken: CodexOAuthToken = CodexOAuthTokenSchema.parse({
      access_token: tokenResponse.access_token,
      token_type: tokenResponse.token_type,
      expiry: expiry, // Unix timestamp in seconds
      refresh_token: tokenResponse.refresh_token,
      account_id: accountId,
      id_token: tokenResponse.id_token,
    });

    this.logger.debug(() => `Token exchange successful, account_id: ${accountId.substring(0, 8)}...`);
    return codexToken;
  }

  /**
   * Extract account_id from id_token JWT without external libraries
   * JWT format: header.payload.signature (base64url encoded)
   */
  private extractAccountIdFromIdToken(idToken: string): string {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format: expected 3 parts');
    }

    // Decode payload (middle part) from base64url
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');

    // Parse and validate with Zod
    const parsedPayload: unknown = JSON.parse(decoded);
    const validated = JwtPayloadSchema.parse(parsedPayload);

    // Extract account_id from OpenAI-specific claim or root
    const accountId =
      validated['https://api.openai.com/auth']?.chatgpt_account_id ||
      validated['https://api.openai.com/auth']?.account_id ||
      validated.account_id;

    if (!accountId) {
      throw new Error('No account_id found in id_token JWT claims');
    }

    return accountId;
  }

  private throwMissingAccountId(): never {
    throw new Error('id_token required to extract account_id');
  }

  // Refresh expired tokens - NO TYPE ASSERTIONS
  async refreshToken(refreshToken: string): Promise<CodexOAuthToken> {
    const response = await fetch(CODEX_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CODEX_CONFIG.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data: unknown = await response.json();
    const tokenResponse = CodexTokenResponseSchema.parse(data);

    // Extract account_id from new id_token or throw
    const accountId = tokenResponse.id_token
      ? this.extractAccountIdFromIdToken(tokenResponse.id_token)
      : this.throwMissingAccountId();

    // Use Unix timestamp in SECONDS
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = tokenResponse.expires_in || 3600;
    const expiry = now + expiresIn;

    return CodexOAuthTokenSchema.parse({
      access_token: tokenResponse.access_token,
      token_type: tokenResponse.token_type,
      expiry: expiry, // Unix timestamp in seconds
      refresh_token: tokenResponse.refresh_token ?? refreshToken,
      account_id: accountId,
      id_token: tokenResponse.id_token,
    });
  }

  private generateRandomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => chars[byte % chars.length]).join('');
  }

  private computeS256Challenge(verifier: string): string {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    // Use Web Crypto API for SHA-256
    // Note: This is async in browser but we handle it synchronously for Node.js
    const hash = require('crypto').createHash('sha256').update(data).digest();
    return Buffer.from(hash).toString('base64url');
  }
}
```

**File**: `/packages/core/src/auth/index.ts` (modify existing)

Add exports:
```typescript
// Add to existing exports
export { CodexOAuthTokenSchema, CodexTokenResponseSchema } from './types.js';
export type { CodexOAuthToken, CodexTokenResponse } from './types.js';
export { CodexDeviceFlow } from './codex-device-flow.js';
```

### 1.3 Verification Phase

**Checks**:
- [ ] All tests pass
- [ ] No `any` types used - verify with: `grep -r "any" packages/core/src/auth/codex-device-flow.ts` (should find nothing except comments)
- [ ] No type assertions (`as string`, `as number`) - only Zod `.parse()` calls
- [ ] Uses DebugLogger, not console.log
- [ ] Follows existing `QwenDeviceFlow` patterns for Zod validation
- [ ] Token storage uses `~/.llxprt/oauth/codex.json` pattern
- [ ] All functions have explicit return types

---

## Phase 2: Codex OAuth Flow (PKCE, Browser Auth, Callback)

### 2.1 Test Phase (TDD - RED)

**Test File**: `/packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts`

**Tests to Write**:
```typescript
describe('CodexOAuthProvider', () => {
  // 1. Flow Initiation
  describe('initiateAuth', () => {
    it('should build correct authorization URL with PKCE S256', async () => {
      // Verify URL contains code_challenge, code_challenge_method=S256
    });

    it('should include required OAuth parameters', async () => {
      // client_id=app_EMoamEEZ73f0CkXaXp7hrann, scope, redirect_uri, state
    });

    it('should start local callback server on port 1455 (Codex CLI compatible)', async () => {
      // Primary port for compatibility with Codex CLI
    });

    it('should fallback to port range 1456-1485 if 1455 is busy', async () => {
      // Fallback range
    });

    it('should open browser securely', async () => {
      // Test browser launch with shouldLaunchBrowser()
    });
  });

  // 2. Token Exchange
  describe('completeAuth', () => {
    it('should exchange auth code for tokens using Zod validation', async () => {
      // Test token exchange endpoint - no type assertions
    });

    it('should save tokens to ~/.llxprt/oauth/codex.json', async () => {
      // Verify token persistence uses MultiProviderTokenStore
    });

    it('should extract account_id from id_token', async () => {
      // Verify JWT parsing
    });
  });

  // 3. Token Retrieval
  describe('getToken', () => {
    it('should return valid token with account_id', async () => {
      // Test token retrieval
    });

    it('should try fallback read from ~/.codex/auth.json', async () => {
      // Read-only fallback
    });

    it('should refresh expired token automatically', async () => {
      // Test auto-refresh
    });
  });

  // 4. Logout
  describe('logout', () => {
    it('should remove stored tokens from ~/.llxprt/oauth/codex.json', async () => {
      // Test logout clears llxprt tokens
    });

    it('should NOT modify ~/.codex/auth.json', async () => {
      // Never write to external tool's storage
    });
  });
});
```

**Requirements Tested**: OAuth PKCE flow, token exchange, browser auth

### 2.2 Implementation Phase (GREEN)

**File**: `/packages/cli/src/auth/codex-oauth-provider.ts`

**Implementation Details** (following `AnthropicOAuthProvider` pattern):
```typescript
import { DebugLogger } from '@anthropic/core';
import { CodexDeviceFlow } from '@anthropic/core/auth';
import { CodexOAuthTokenSchema, type CodexOAuthToken } from '@anthropic/core/auth';
import { startLocalOAuthCallback, openBrowserSecurely } from './oauth-utils.js';
import type { OAuthProvider, TokenStore, AddItemFn } from './types.js';

// Port configuration for Codex OAuth callback
// Use 1455 for compatibility with Codex CLI, fallback to range if busy
const CODEX_PRIMARY_PORT = 1455;
const CODEX_FALLBACK_RANGE: [number, number] = [1456, 1485];
const CALLBACK_TIMEOUT_MS = 120000; // 2 minutes

export class CodexOAuthProvider implements OAuthProvider {
  name = 'codex' as const;

  private deviceFlow: CodexDeviceFlow;
  private logger: DebugLogger;
  private tokenStore: TokenStore;
  private addItem?: AddItemFn;

  constructor(tokenStore: TokenStore, addItem?: AddItemFn) {
    this.deviceFlow = new CodexDeviceFlow();
    this.logger = new DebugLogger('llxprt:auth:codex');
    this.tokenStore = tokenStore;
    this.addItem = addItem;
  }

  async initiateAuth(): Promise<void> {
    this.logger.debug(() => 'Initiating Codex OAuth flow');

    const state = crypto.randomUUID();
    let localCallback: { port: number; waitForCallback: () => Promise<string> };

    // Try primary port first (Codex CLI compatible)
    try {
      localCallback = await startLocalOAuthCallback({
        state,
        port: CODEX_PRIMARY_PORT,
        timeoutMs: CALLBACK_TIMEOUT_MS,
      });
      this.logger.debug(() => `Started callback server on primary port ${CODEX_PRIMARY_PORT}`);
    } catch {
      // Fallback to port range
      this.logger.debug(() => `Port ${CODEX_PRIMARY_PORT} busy, trying fallback range`);
      localCallback = await startLocalOAuthCallback({
        state,
        portRange: CODEX_FALLBACK_RANGE,
        timeoutMs: CALLBACK_TIMEOUT_MS,
      });
    }

    const redirectUri = `http://127.0.0.1:${localCallback.port}/callback`;
    const authUrl = this.deviceFlow.buildAuthorizationUrl(redirectUri, state);

    // Display URL in TUI if available
    if (this.addItem) {
      this.addItem({
        type: 'info',
        message: `Please visit this URL to authenticate:\n${authUrl}`,
      });
    }

    // Open browser
    await openBrowserSecurely(authUrl);

    // Wait for callback
    const authCode = await localCallback.waitForCallback();

    // Exchange code for tokens
    await this.completeAuth(authCode, redirectUri);
  }

  async completeAuth(authCode: string, redirectUri: string): Promise<void> {
    this.logger.debug(() => 'Exchanging auth code for tokens');

    const token = await this.deviceFlow.exchangeCodeForToken(authCode, redirectUri);

    // Save to MultiProviderTokenStore location
    await this.tokenStore.saveToken('codex', token);

    this.logger.debug(() => 'Codex OAuth authentication complete');
  }

  async getToken(): Promise<CodexOAuthToken | null> {
    // Try primary location first
    let token = await this.tokenStore.getToken('codex');

    if (!token) {
      // Fallback: Try reading from Codex CLI's auth file (read-only)
      token = await this.readCodexCliToken();
    }

    if (!token) {
      return null;
    }

    // Validate with Zod schema
    try {
      return CodexOAuthTokenSchema.parse(token);
    } catch {
      this.logger.debug(() => 'Token validation failed');
      return null;
    }
  }

  async refreshIfNeeded(): Promise<CodexOAuthToken | null> {
    const token = await this.getToken();
    if (!token) return null;

    // Check if expired (with 30s buffer) - expiry is Unix timestamp in SECONDS
    const now = Math.floor(Date.now() / 1000);
    const isExpired = token.expiry <= now + 30;
    if (!isExpired) return token;

    if (!token.refresh_token) {
      this.logger.debug(() => 'Token expired and no refresh_token available');
      return null;
    }

    this.logger.debug(() => 'Refreshing expired token');
    const newToken = await this.deviceFlow.refreshToken(token.refresh_token);
    await this.tokenStore.saveToken('codex', newToken);
    return newToken;
  }

  async logout(): Promise<void> {
    this.logger.debug(() => 'Logging out from Codex');
    // Only remove from llxprt storage - never touch ~/.codex/
    await this.tokenStore.removeToken('codex');
  }

  private async readCodexCliToken(): Promise<CodexOAuthToken | null> {
    // Read-only fallback from ~/.codex/auth.json
    const codexAuthPath = `${process.env.HOME}/.codex/auth.json`;
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(codexAuthPath, 'utf-8');
      const data: unknown = JSON.parse(content);

      // Codex CLI stores tokens differently - adapt structure
      const CodexCliTokenSchema = z.object({
        tokens: z.object({
          access_token: z.string(),
          account_id: z.string(),
          refresh_token: z.string().optional(),
        }),
      });

      const parsed = CodexCliTokenSchema.parse(data);

      // Convert to our format - use Unix timestamp in SECONDS
      return CodexOAuthTokenSchema.parse({
        access_token: parsed.tokens.access_token,
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600, // Unknown expiry, assume 1 hour
        account_id: parsed.tokens.account_id,
        refresh_token: parsed.tokens.refresh_token,
      });
    } catch {
      this.logger.debug(() => 'No valid token found in ~/.codex/auth.json');
      return null;
    }
  }
}
```

### 2.3 Verification Phase

**Checks**:
- [ ] PKCE uses S256 (SHA256)
- [ ] Primary port is 1455 (Codex CLI compatible), with fallback to 1456-1485
- [ ] Uses `openBrowserSecurely` from core
- [ ] Follows `AnthropicOAuthProvider` patterns exactly
- [ ] No hardcoded secrets
- [ ] Uses DebugLogger consistently
- [ ] Never writes to `~/.codex/` directory
- [ ] All Zod validation, no type assertions

---

## Phase 3: OpenAIResponsesProvider Codex Mode

### 3.1 Test Phase (TDD - RED)

**Test File**: `/packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.codex.test.ts`

**Tests to Write**:
```typescript
describe('OpenAIResponsesProvider Codex Mode', () => {
  // 1. Mode Detection
  describe('isCodexMode', () => {
    it('should detect Codex mode from baseURL containing chatgpt.com/backend-api/codex', () => {
      const provider = new OpenAIResponsesProvider(undefined, 'https://chatgpt.com/backend-api/codex');
      expect(provider['isCodexMode']('https://chatgpt.com/backend-api/codex')).toBe(true);
    });

    it('should NOT be in Codex mode for standard OpenAI URL', () => {
      const provider = new OpenAIResponsesProvider(undefined, 'https://api.openai.com/v1');
      expect(provider['isCodexMode']('https://api.openai.com/v1')).toBe(false);
    });
  });

  // 2. Request Headers - VERIFY ACTUAL HTTP REQUEST
  describe('Codex request headers', () => {
    it('should include correct headers in actual HTTP request', async () => {
      // Intercept fetch and verify headers
      const originalFetch = global.fetch;
      let capturedHeaders: Headers | null = null;

      global.fetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        // Return mock streaming response
        return new Response(createMockSSEStream(), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      });

      try {
        const provider = createCodexProvider();
        await consumeGenerator(provider.generateChatCompletion(...));

        expect(capturedHeaders?.get('ChatGPT-Account-ID')).toBe('test-account-id');
        expect(capturedHeaders?.get('originator')).toBe('codex_cli_rs');
        expect(capturedHeaders?.get('Authorization')).toMatch(/^Bearer /);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should NOT add Codex headers when not in Codex mode', async () => {
      // Standard OpenAI mode - no ChatGPT-Account-ID header
    });
  });

  // 3. Request Body
  describe('Codex request body', () => {
    it('should add store: false to request body in Codex mode', async () => {
      // Capture request body and verify store: false
    });

    it('should use minimal/empty instructions field', async () => {
      // Codex validates instructions - use empty or minimal
    });

    it('should inject system prompt as first user message', async () => {
      // Anthropic-style prompt injection
    });
  });

  // 4. Streaming
  describe('Codex streaming', () => {
    it('should parse Codex SSE response format', async () => {
      // Test streaming response parsing (same as OpenAI Responses API)
    });
  });
});
```

**Requirements Tested**: Codex mode detection, headers, request body

### 3.2 Implementation Phase (GREEN)

**File**: `/packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts`

**Implementation Details** (minimal changes to existing file):
```typescript
// Add import at top
import { CodexOAuthTokenSchema, type CodexOAuthToken } from '../../auth/types.js';

// Add method to detect Codex mode
private isCodexMode(baseURL: string | undefined): boolean {
  return baseURL?.includes('chatgpt.com/backend-api/codex') ?? false;
}

// Add method to get account_id from Codex token
private async getCodexAccountId(options: NormalizedGenerateChatOptions): Promise<string> {
  // Get token from OAuth manager or invocation options
  const token = options.invocation?.codexToken;
  if (!token) {
    throw new Error('Codex mode requires OAuth authentication with account_id');
  }

  // Validate with Zod schema
  const validatedToken = CodexOAuthTokenSchema.parse(token);
  return validatedToken.account_id;
}

// Modify generateChatCompletionWithOptions to handle Codex mode
protected override async *generateChatCompletionWithOptions(
  options: NormalizedGenerateChatOptions,
): AsyncIterableIterator<IContent> {
  const baseURL = options.resolved.baseURL ?? this.getBaseURL() ?? 'https://api.openai.com/v1';
  const isCodex = this.isCodexMode(baseURL);

  // ... existing setup code ...

  // Build headers - add Codex-specific headers if in Codex mode
  const customHeaders = this.getCustomHeaders();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json; charset=utf-8',
    ...(customHeaders ?? {}),
  };

  if (isCodex) {
    const accountId = await this.getCodexAccountId(options);
    headers['ChatGPT-Account-ID'] = accountId;
    headers['originator'] = 'codex_cli_rs';
    this.logger.debug(() => `Codex mode: adding headers for account ${accountId.substring(0, 8)}...`);
  }

  // Build request body
  const request: Record<string, unknown> = {
    model: resolvedModel,
    input,
    stream: true,
    ...(requestOverrides || {}),
  };

  if (isCodex) {
    // Required by ChatGPT backend
    request.store = false;

    // Inject system prompt as first user message (Anthropic pattern)
    // Use minimal/empty instructions field (validated by Codex)
    request.instructions = '';

    // Modify input to inject system prompt as first user message
    if (systemPrompt && Array.isArray(request.input)) {
      const systemAsUser = {
        role: 'user',
        content: `<system>\n${systemPrompt}\n</system>\n\nUser conversation begins:`,
      };
      (request.input as unknown[]).unshift(systemAsUser);
    }
  }

  // ... rest of existing implementation ...
}
```

### 3.3 Verification Phase

**Checks**:
- [ ] Minimal changes to existing provider
- [ ] Codex mode is opt-in (only when baseURL matches)
- [ ] Headers verified in actual HTTP request (not just method calls)
- [ ] System prompt injection follows Anthropic OAuth pattern
- [ ] All existing tests still pass
- [ ] No breaking changes to non-Codex usage
- [ ] No type assertions - only Zod validation

---

## Phase 4: Dynamic Model Fetching with Hardcoded Fallback

### 4.1 Test Phase (TDD - RED)

**Test File**: `/packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.codexModels.test.ts`

**Tests to Write**:
```typescript
describe('Codex Model Listing', () => {
  it('should fetch models from chatgpt.com/backend-api/codex/models', async () => {
    // Test dynamic model fetching with proper auth headers
  });

  it('should return hardcoded list if fetch fails', async () => {
    // Fallback order: gpt-5.2, gpt-5.1-codex-max, gpt-5.1-codex, gpt-5.1-codex-mini, gpt-5.1
  });

  it('should include gpt-5.2 as default model', async () => {
    // getDefaultModel() returns 'gpt-5.2' in Codex mode
  });

  it('should use Codex auth headers for model fetch', async () => {
    // Requires ChatGPT-Account-ID header
  });

  it('should return standard models when not in Codex mode', async () => {
    // Non-Codex mode uses standard OpenAI models
  });
});
```

**Requirements Tested**: Model listing, fallback behavior

### 4.2 Implementation Phase (GREEN)

**Implementation Details**:
```typescript
// Hardcoded fallback models - gpt-5.2 is default
const HARDCODED_CODEX_MODELS: IModel[] = [
  { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'codex', supportedToolFormats: ['openai'] },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', provider: 'codex', supportedToolFormats: ['openai'] },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', provider: 'codex', supportedToolFormats: ['openai'] },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', provider: 'codex', supportedToolFormats: ['openai'] },
  { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'codex', supportedToolFormats: ['openai'] },
];

// In OpenAIResponsesProvider
override async getModels(): Promise<IModel[]> {
  if (this.isCodexMode(this.getBaseURL())) {
    return this.getCodexModels();
  }
  return super.getModels();
}

private async getCodexModels(): Promise<IModel[]> {
  try {
    const headers = await this.buildCodexHeaders();
    const response = await fetch('https://chatgpt.com/backend-api/codex/models', { headers });

    if (!response.ok) {
      this.logger.debug(() => `Codex models fetch failed: ${response.status}, using fallback`);
      return HARDCODED_CODEX_MODELS;
    }

    const data: unknown = await response.json();
    return this.parseCodexModels(data);
  } catch (error) {
    this.logger.debug(() => `Failed to fetch Codex models: ${error}, using hardcoded fallback`);
    return HARDCODED_CODEX_MODELS;
  }
}

private async buildCodexHeaders(): Promise<Record<string, string>> {
  // Get account_id from stored token
  // This requires access to the token store
  return {
    'ChatGPT-Account-ID': 'placeholder', // Will be set from token
    'originator': 'codex_cli_rs',
  };
}

override getDefaultModel(): string {
  if (this.isCodexMode(this.getBaseURL())) {
    return 'gpt-5.2';  // Default for Codex
  }
  return 'o3-mini';  // Default for standard OpenAI
}
```

### 4.3 Verification Phase

**Checks**:
- [ ] Dynamic fetch uses correct endpoint
- [ ] Fallback always returns valid models
- [ ] Default model is `gpt-5.2` (not `gpt-5.1-codex-max`)
- [ ] Models include tool format declaration
- [ ] Error handling doesn't throw - gracefully falls back

---

## Phase 5: /auth Menu Integration

### 5.1 Test Phase (TDD - RED)

**Test File**: `/packages/cli/src/ui/commands/__tests__/authCommand.codex.test.ts`

**Tests to Write**:
```typescript
describe('/auth codex command', () => {
  it('should show Codex in supported providers list', async () => {
    // getSupportedProviders() includes 'codex'
  });

  it('/auth codex should show status', async () => {
    // Test status display
  });

  it('/auth codex enable should enable OAuth', async () => {
    // Test enable action
  });

  it('/auth codex disable should disable OAuth', async () => {
    // Test disable action
  });

  it('/auth codex logout should clear tokens', async () => {
    // Test logout action - only clears ~/.llxprt/oauth/codex.json
  });
});
```

**Requirements Tested**: /auth integration

### 5.2 Implementation Phase (GREEN)

**File Modifications**:

1. **`/packages/cli/src/auth/oauth-provider-registration.ts`** - Register Codex provider:
```typescript
import { CodexOAuthProvider } from './codex-oauth-provider.js';

// In registerOAuthProviders function
export function registerOAuthProviders(tokenStore: TokenStore, addItem?: AddItemFn): OAuthProvider[] {
  return [
    new AnthropicOAuthProvider(tokenStore, addItem),
    new CodexOAuthProvider(tokenStore, addItem),  // Add Codex
    // ... other providers
  ];
}
```

### 5.3 Verification Phase

**Checks**:
- [ ] Codex appears in `/auth` menu
- [ ] Status shows authentication state
- [ ] Enable/disable persists to settings
- [ ] Logout clears only `~/.llxprt/oauth/codex.json`

---

## Phase 6: /provider codex Alias

### 6.1 Test Phase (TDD - RED)

**Test File**: `/packages/cli/src/providers/__tests__/providerAliases.codex.test.ts`

**Tests to Write**:
```typescript
describe('/provider codex alias', () => {
  it('should load codex.config alias file (no .json extension)', () => {
    // Test alias config loading
  });

  it('should set baseURL to chatgpt.com/backend-api/codex', () => {
    // Verify baseURL configuration
  });

  it('should use openai-responses as base provider', () => {
    // Test baseProvider setting
  });

  it('should set default model to gpt-5.2', () => {
    // Test default model
  });
});
```

**Requirements Tested**: Provider alias configuration

### 6.2 Implementation Phase (GREEN)

**File**: `/packages/cli/src/providers/aliases/codex.config` (NO .json extension)

```json
{
  "name": "codex",
  "baseProvider": "openai-responses",
  "baseUrl": "https://chatgpt.com/backend-api/codex",
  "defaultModel": "gpt-5.2",
  "description": "OpenAI Codex (ChatGPT backend)"
}
```

**Note**: OAuth configuration is handled by the provider itself when it detects Codex mode, not in the alias file.

### 6.3 Verification Phase

**Checks**:
- [ ] Alias file uses `.config` extension (NOT `.json`)
- [ ] `/provider codex` switches correctly
- [ ] BaseURL is set to Codex endpoint
- [ ] Only contains standard alias fields (no `oauthRequired` or `oauthProvider`)

---

## Phase 7: Integration Tests and UAT

### 7.1 Test Phase (TDD - RED)

**Test File**: `/integration-tests/codex-oauth.integration.test.ts`

**Tests to Write**:
```typescript
describe('Codex OAuth Integration', () => {
  // Full flow test (requires valid OAuth - skip in CI)
  it.skipIf(!process.env.CODEX_TEST_TOKEN)('should complete OAuth flow and make API request', async () => {
    // E2E test with real API
  });

  // Debug logging test
  it('should log flow to ~/.llxprt/debug/', async () => {
    // Verify DebugLogger output
  });

  // Tool execution test
  it.skipIf(!process.env.CODEX_TEST_TOKEN)('should execute tools through Codex API', async () => {
    // Verify custom tools work
  });
});
```

### 7.2 UAT Script

**File**: `/scripts/codex-uat.sh`

```bash
#!/bin/bash
# User Acceptance Test for Codex OAuth
# Usage: ./scripts/codex-uat.sh

set -e  # Exit on error
set -u  # Exit on undefined variable

# Cleanup trap
cleanup() {
  echo "Cleaning up test artifacts..."
  rm -f ./tmp/haiku-codex.txt 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Codex OAuth UAT ==="

# Pre-checks
if ! command -v node &> /dev/null; then
  echo "FAILURE: Node.js not found"
  exit 1
fi

# Check for existing OAuth token or warn
if [[ ! -f ~/.llxprt/oauth/codex.json ]] && [[ ! -f ~/.codex/auth.json ]]; then
  echo "WARNING: No Codex OAuth token found."
  echo "You will need to authenticate via browser during this test."
  echo ""
fi

echo "Testing: LLXPRT_DEBUG=llxprt:* node scripts/start.js --provider codex --model gpt-5.1-codex-max"
echo ""

# Clean up previous test artifacts
rm -f ./tmp/haiku-codex.txt
mkdir -p ./tmp

# Set debug mode
export LLXPRT_DEBUG=llxprt:*

# Run test command
node scripts/start.js --provider codex --model gpt-5.1-codex-max \
  "write me a haiku in ./tmp/haiku-codex.txt (not /tmp)"

# Verify file was created
if [[ -f ./tmp/haiku-codex.txt ]]; then
  echo ""
  echo "SUCCESS: Haiku file created"
  echo "=== Content ==="
  cat ./tmp/haiku-codex.txt
  echo ""
  echo "==============="
else
  echo ""
  echo "FAILURE: Haiku file not created"
  echo "Check debug logs in ~/.llxprt/debug/"
  ls -la ~/.llxprt/debug/ 2>/dev/null || echo "(no debug directory found)"
  exit 1
fi

# Show debug log location
echo ""
echo "Debug logs available at: ~/.llxprt/debug/"
ls -la ~/.llxprt/debug/ 2>/dev/null || echo "(no debug directory found)"

echo ""
echo "=== UAT PASSED ==="
```

### 7.3 Implementation Phase

The UAT validates:
1. Provider switching to codex works
2. OAuth authentication succeeds (or uses existing token)
3. Model selection works
4. Tool execution (file write) works
5. Debug logging captures the flow

### 7.4 Verification Phase

**Checks**:
- [ ] All unit tests pass (`npm run test`)
- [ ] All lint checks pass (`npm run lint`)
- [ ] All type checks pass (`npm run typecheck`)
- [ ] Build succeeds (`npm run build`)
- [ ] UAT creates actual file with haiku
- [ ] Debug logs show complete OAuth and API flow
- [ ] No `console.log` statements (only DebugLogger)
- [ ] Zero `any` types in new code
- [ ] Zero type assertions (`as string`) in new code

---

## Dependency Graph

```
Phase 1 (Token Management + Zod Schemas)
    |
    v
Phase 2 (OAuth Flow) ---> Phase 5 (/auth Integration)
    |
    v
Phase 3 (Provider Codex Mode) ---> Phase 4 (Model Fetching)
    |
    v
Phase 6 (Provider Alias)
    |
    v
Phase 7 (Integration + UAT)
```

---

## Rules Compliance (from dev-docs/RULES.md)

1. **No stub implementations** - All phases implement real behavior
2. **No `any` types** - Use `unknown` with Zod validation
3. **No type assertions** - Use Zod `.parse()` instead of `as string`
4. **Use DebugLogger** - Never use console.log
5. **All code must compile, lint, test** - CI verification required
6. **Follow existing patterns** - Mirror `QwenDeviceFlow` for Zod, `AnthropicOAuthProvider` for OAuth
7. **No mock theater** - Tests verify real behavior
8. **TDD approach** - Tests written before implementation

---

## Critical Files Reference

| File | Purpose | Phase |
|------|---------|-------|
| `/packages/core/src/auth/types.ts` | Add `CodexOAuthTokenSchema` (Zod) | Phase 1 |
| `/packages/core/src/auth/codex-device-flow.ts` | Codex PKCE OAuth flow | Phase 1 |
| `/packages/core/src/auth/index.ts` | Export new types | Phase 1 |
| `/packages/cli/src/auth/codex-oauth-provider.ts` | CLI OAuth provider | Phase 2 |
| `/packages/cli/src/auth/oauth-provider-registration.ts` | Register Codex provider | Phase 5 |
| `/packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts` | Codex mode detection and headers | Phase 3 |
| `/packages/cli/src/providers/aliases/codex.config` | Provider alias (NO .json) | Phase 6 |
| `/scripts/codex-uat.sh` | User acceptance test script | Phase 7 |

---

## Success Criteria

1. All unit tests pass (`npm run test`)
2. All lint checks pass (`npm run lint`)
3. All type checks pass (`npm run typecheck`)
4. Build succeeds (`npm run build`)
5. UAT script succeeds (creates haiku file via Codex API)
6. Debug logs show complete OAuth and API flow
7. PR created with proper description referencing issue #160
8. Zero `any` types in new code
9. Zero type assertions (`as string`, `as number`) in new code
10. All token validation uses Zod schemas
