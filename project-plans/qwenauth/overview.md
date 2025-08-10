# Qwen OAuth Integration - Design Overview

## Executive Summary

This document outlines the design for integrating Qwen's OAuth authentication into llxprt-code while maintaining support for multiple authentication methods across different providers. The goal is to enable OAuth-based authentication for Qwen (which uses OpenAI-compatible APIs) alongside the existing Gemini OAuth support, creating a flexible multi-auth architecture.

## Current State

### Existing Authentication Architecture

1. **GeminiProvider**
   - Supports three authentication methods:
     - Gemini API Key (from AI Studio)
     - Vertex AI API Key (from Google Cloud)
     - Google OAuth (device flow)
   - Implements ServerToolsProvider interface for web tools

2. **OpenAIProvider**
   - Currently supports only API key authentication
   - Used for OpenAI and compatible services (including Qwen)

3. **AnthropicProvider**
   - API key authentication only

### Current `/auth` Command

The `/auth` command currently presents a menu for Gemini that mixes OAuth and API key setup. This conflates two different authentication concepts.

## Qwen OAuth Implementation Details

### How Qwen Handles OAuth

Based on analysis of the Qwen-Code repository:

1. **OAuth Flow Type**
   - Uses OAuth 2.0 Device Authorization Grant (RFC 8628)
   - Implements PKCE (RFC 7636) for enhanced security
   - Ideal for CLI applications without direct browser access

2. **Authentication Endpoints**
   - OAuth server: `https://chat.qwen.ai`
   - Device code endpoint: `/api/v1/oauth2/device/code`
   - Token endpoint: `/api/v1/oauth2/token`
   - Public client ID: `f0304373b74a44d2b584a3fb70ca9e56`

3. **Token Usage**
   - OAuth access token is passed as the `apiKey` parameter to OpenAI SDK
   - OpenAI SDK automatically adds it as Bearer token in Authorization header:
     ```
     Authorization: Bearer <oauth_access_token>
     ```
   - No difference in API calls between OAuth tokens and API keys

4. **Token Storage**
   - Stored in `~/.qwen/oauth_creds.json` with 0600 permissions
   - Automatic refresh with 30-second buffer before expiry

## Proposed Multi-Auth Architecture

### Core Design Principles

1. **Clean Separation of Concerns**
   - OAuth flows handled exclusively through `/auth` command
   - API keys handled through environment variables, config files, or CLI flags
   - No mixing of OAuth and API key setup in UI

2. **Provider Independence**
   - Each provider manages its own authentication fallback chain
   - Multiple providers can be authenticated simultaneously
   - Authentication and provider selection are orthogonal

3. **Backward Compatibility**
   - Existing authentication methods continue to work
   - No breaking changes to current workflows

### Authentication Precedence Order

#### GeminiProvider
```
1. --key / --keyfile (command line flag)
2. Vertex AI key/config
3. GEMINI_API_KEY env var
4. OAuth token (from /auth gemini)
5. Provider unavailable
```

#### OpenAIProvider (including Qwen)
```
1. --key / --keyfile (command line flag)
2. OPENAI_API_KEY env var
3. OAuth token (from /auth qwen)
4. Provider unavailable
```

#### AnthropicProvider
```
1. --key / --keyfile (command line flag)
2. ANTHROPIC_API_KEY env var
3. Provider unavailable (no OAuth support yet)
```

### `/auth` Command Evolution

#### New Design
- `/auth` becomes OAuth-exclusive
- No more "provider type" selection within auth flow
- Direct service selection for OAuth

#### Menu Structure
```
/auth
> 1. Gemini (Google OAuth)
> 2. Qwen (OAuth)

Select service to authenticate: _
```

#### Multi-Auth Support
Users can authenticate multiple services:
```bash
/auth qwen    # Completes Qwen OAuth
/auth gemini  # Completes Google OAuth
```

Both tokens are stored and available for use when needed.

### Token Storage Architecture

```typescript
interface OAuthTokenStore {
  'gemini': {
    access_token: string,
    refresh_token: string,
    expiry: number,
    // ... other OAuth fields
  },
  'qwen': {
    access_token: string,
    refresh_token: string,
    expiry: number,
    // ... other OAuth fields
  },
  // Future providers can be added here
}
```

### Provider Interaction Model

1. **Content Generation Provider**
   - Selected via `--provider` flag
   - Uses its authentication chain to find credentials
   - Can be any supported provider

2. **ServerToolsProvider**
   - Always Gemini (when available)
   - Uses Gemini's authentication independently
   - Provides WebSearch, WebFetch, and other tools

3. **Example Scenarios**

   ```bash
   # Qwen for content, Gemini for tools (both via OAuth)
   llxprt --provider openai --prompt "search for X and summarize"
   # Uses: Qwen OAuth for content, Gemini OAuth for WebSearch
   
   # Anthropic for content, Gemini for tools
   llxprt --provider anthropic --key sk-ant-xxx --prompt "search and analyze"
   # Uses: Anthropic API key for content, Gemini OAuth for WebSearch
   
   # Gemini for everything
   llxprt --provider gemini --prompt "generate and search"
   # Uses: Gemini OAuth for both content and tools
   ```

## Key Design Decisions

### Why Not Modify ServerToolsProvider?

ServerToolsProvider remains Gemini-exclusive because:
1. Only Gemini currently provides the necessary tool APIs
2. Keeps the architecture simple and focused
3. Avoids unnecessary abstraction
4. Future providers can implement their own tool interfaces if needed

### Why Separate OAuth from API Keys?

1. **Conceptual Clarity**: OAuth and API keys are fundamentally different auth methods
2. **User Experience**: Clear mental model - `/auth` for interactive flows, config for keys
3. **Security**: Different storage and refresh requirements
4. **Flexibility**: Users can mix authentication methods as needed

### Why Support Multiple OAuth Sessions?

1. **Tool Independence**: Web tools might need different providers than content generation
2. **Redundancy**: Fallback options if one service is unavailable
3. **Feature Access**: Different providers offer different capabilities
4. **User Choice**: Let users pick the best provider for each task

## Migration Path

### Phase 1: Clean Separation
- Refactor `/auth` to be OAuth-only
- Move API key setup to documentation/config
- Maintain backward compatibility

### Phase 2: Qwen OAuth Integration
- Extend OpenAIProvider to support OAuth tokens
- Add Qwen to `/auth` menu
- Implement token storage for Qwen

### Phase 3: Multi-Auth Enhancement
- Ensure multiple OAuth tokens can coexist
- Update UI to show authentication status
- Add provider-specific auth status indicators

## Future Considerations

### Potential Enhancements

1. **Auth Status Command**
   ```bash
   /auth status
   > Gemini: ✓ OAuth (expires in 45m)
   > Qwen: ✓ OAuth (expires in 2h)
   > Anthropic: ✓ API Key
   > OpenAI: ✗ Not configured
   ```

2. **Automatic Provider Selection**
   - If no `--provider` specified, use first authenticated provider
   - Smart selection based on required capabilities

3. **OAuth for Additional Providers**
   - Anthropic OAuth (when available)
   - Other OpenAI-compatible services

4. **Token Management**
   - `/auth refresh` to manually refresh tokens
   - `/auth revoke <service>` to remove stored tokens

## Security Considerations

1. **Token Storage**
   - Maintain secure file permissions (0600)
   - Separate storage per provider
   - Encrypted storage option for sensitive environments

2. **Token Refresh**
   - Automatic refresh before expiry
   - Graceful fallback on refresh failure
   - No token logging in debug mode

3. **Scope Management**
   - Request minimal necessary scopes
   - Provider-specific scope configuration
   - Clear scope documentation for users

## Conclusion

This design provides a clean, extensible architecture for supporting multiple OAuth providers while maintaining simplicity for users. The separation of OAuth flows from API key configuration creates a clear mental model, and the independent authentication chains for each provider ensure maximum flexibility in deployment scenarios.