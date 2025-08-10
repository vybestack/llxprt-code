# Feature Specification: Qwen OAuth Integration

## Purpose

Enable OAuth-based authentication for Qwen (Alibaba Cloud AI) services in llxprt-code, allowing users to authenticate via OAuth device flow instead of API keys. This creates a multi-provider OAuth architecture where Gemini and Qwen can be authenticated independently and used simultaneously.

## Architectural Decisions

- **Pattern**: Provider-based authentication with fallback chains
- **Technology Stack**: 
  - TypeScript 5.x with strict mode
  - OpenAI SDK for API compatibility
  - OAuth 2.0 Device Authorization Grant (RFC 8628)
  - PKCE (RFC 7636) for enhanced security
- **Data Flow**: OAuth tokens stored separately per provider, used as API keys in OpenAI SDK
- **Integration Points**: 
  - `/auth` command for OAuth flows
  - OpenAIProvider extended to support OAuth tokens
  - Existing token storage infrastructure

## Project Structure

```
packages/
  cli/
    src/
      commands/
        auth.ts              # Modified for multi-OAuth
      auth/
        qwen-oauth.ts        # Qwen OAuth implementation
        oauth-manager.ts     # Multi-provider OAuth management
  core/
    src/
      providers/
        openai.ts           # Extended for OAuth support
      auth/
        qwen-device-flow.ts # Device flow implementation
        token-store.ts      # Multi-provider token storage
test/
  cli/
    auth/
      qwen-oauth.spec.ts
      oauth-manager.spec.ts
  core/
    providers/
      openai-oauth.spec.ts
    auth/
      qwen-device-flow.spec.ts
      token-store.spec.ts
```

## Technical Environment

- **Type**: CLI Tool
- **Runtime**: Node.js 20.x
- **Dependencies**:
  - OpenAI SDK (existing)
  - OAuth 2.0 libraries (existing)
  - Secure token storage (existing)

## Formal Requirements

[REQ-001] OAuth Command Separation
  [REQ-001.1] `/auth` command exclusively for OAuth flows
  [REQ-001.2] Remove API key setup from auth menu
  [REQ-001.3] Support provider-specific OAuth: `/auth gemini`, `/auth qwen`

[REQ-002] Qwen OAuth Implementation
  [REQ-002.1] OAuth 2.0 Device Authorization Grant flow
  [REQ-002.2] PKCE with SHA-256 code challenge
  [REQ-002.3] Endpoints: https://chat.qwen.ai/api/v1/oauth2/device/code
  [REQ-002.4] Client ID: f0304373b74a44d2b584a3fb70ca9e56
  [REQ-002.5] Token refresh with 30-second buffer

[REQ-003] Multi-Provider Token Storage
  [REQ-003.1] Separate token storage per provider
  [REQ-003.2] Secure file permissions (0600)
  [REQ-003.3] Token structure: { access_token, refresh_token, expiry }
  [REQ-003.4] Path: ~/.llxprt/oauth/<provider>.json

[REQ-004] Provider Authentication Fallback
  [REQ-004.1] OpenAIProvider precedence: --key, OPENAI_API_KEY, OAuth token
  [REQ-004.2] GeminiProvider precedence: --key, Vertex AI, GEMINI_API_KEY, OAuth
  [REQ-004.3] OAuth token used as apiKey in OpenAI SDK
  [REQ-004.4] Automatic token refresh on expiry

[REQ-005] User Experience
  [REQ-005.1] QR code display for mobile authentication
  [REQ-005.2] Progress indicators during device flow polling
  [REQ-005.3] Clear error messages on auth failure
  [REQ-005.4] Status command showing auth state per provider

[REQ-006] Backward Compatibility
  [REQ-006.1] Existing API key methods continue working
  [REQ-006.2] Existing Gemini OAuth unaffected
  [REQ-006.3] ServerToolsProvider remains Gemini-exclusive

## Data Schemas

```typescript
// OAuth token storage schema
const OAuthTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expiry: z.number(), // Unix timestamp
  scope: z.string().optional(),
  token_type: z.literal('Bearer')
});

// Provider OAuth configuration
const ProviderOAuthConfigSchema = z.object({
  provider: z.enum(['gemini', 'qwen']),
  clientId: z.string(),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url(),
  scopes: z.array(z.string())
});

// Device code response
const DeviceCodeResponseSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url().optional(),
  expires_in: z.number(),
  interval: z.number()
});

// Token response
const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional()
});

// Auth status
const AuthStatusSchema = z.object({
  provider: z.string(),
  authenticated: z.boolean(),
  authType: z.enum(['oauth', 'api-key', 'none']),
  expiresIn: z.number().optional() // seconds until expiry
});
```

## Example Data

```json
{
  "qwenOAuthConfig": {
    "provider": "qwen",
    "clientId": "f0304373b74a44d2b584a3fb70ca9e56",
    "authorizationEndpoint": "https://chat.qwen.ai/api/v1/oauth2/device/code",
    "tokenEndpoint": "https://chat.qwen.ai/api/v1/oauth2/token",
    "scopes": ["openai"]
  },
  "deviceCodeResponse": {
    "device_code": "ABC123DEF456",
    "user_code": "WXYZ-9876",
    "verification_uri": "https://chat.qwen.ai/device",
    "verification_uri_complete": "https://chat.qwen.ai/device?user_code=WXYZ-9876",
    "expires_in": 900,
    "interval": 5
  },
  "storedToken": {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "refresh_token": "rt_abc123...",
    "expiry": 1735689600,
    "scope": "openai",
    "token_type": "Bearer"
  }
}
```

## Constraints

- OAuth flow must complete within 15 minutes
- Polling interval must respect server-specified rate
- Token files must have 0600 permissions
- No logging of tokens or sensitive auth data
- PKCE verifier must be cryptographically random
- Must handle network failures gracefully

## Performance Requirements

- Token refresh latency: <500ms
- Device code polling: Respect server interval
- Token file I/O: <50ms
- Auth status check: <10ms (cached)