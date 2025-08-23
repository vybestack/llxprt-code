# Plan: OAuth Authentication Fixes

Plan ID: PLAN-20250823-AUTHFIXES
Generated: 2025-08-23
Total Phases: 16
Requirements: 
- REQ-001: Token Persistence
- REQ-002: Logout Functionality  
- REQ-003: Token Lifecycle Management
- REQ-004: Integration with Existing System

## Executive Summary

This plan addresses critical OAuth authentication issues across three providers (Qwen, Anthropic, Gemini):
1. Tokens are not persisted/loaded properly causing re-authentication on every restart
2. No logout functionality exists for any provider
3. Token refresh logic doesn't update persistent storage
4. Gemini has a placeholder OAuth implementation with magic strings

## Integration Analysis (CRITICAL - NOT ISOLATED)

### Existing Code That Will USE This Feature

- `/packages/cli/src/auth/oauth-manager.ts` - Central OAuth coordination
- `/packages/cli/src/ui/commands/authCommand.ts` - User-facing auth commands
- `/packages/core/src/providers/anthropic/AnthropicProvider.ts` - API authentication
- `/packages/core/src/providers/openai/OpenAIProvider.ts` - Qwen endpoint detection
- `/packages/core/src/providers/gemini/GeminiProvider.ts` - Auth mode determination
- `/packages/cli/src/index.ts` - CLI initialization with auth state

### Existing Code To Be REPLACED/MODIFIED

- `/packages/cli/src/auth/qwen-oauth-provider.ts` - In-memory token storage
- `/packages/cli/src/auth/anthropic-oauth-provider.ts` - Missing persistence
- `/packages/cli/src/auth/gemini-oauth-provider.ts` - Complete placeholder rewrite
- Magic string `USE_LOGIN_WITH_GOOGLE` usage throughout

### User Access Points

- CLI Command: `/auth [provider] logout` - NEW
- CLI Command: `/auth [provider]` - Shows auth status
- CLI Command: `/auth [provider] enable` - Initiates OAuth
- Automatic: Token loaded on CLI startup from `~/.llxprt/oauth/`

### Migration Requirements

- Existing in-memory tokens need to be persisted on first run
- Settings for OAuth enablement preserved
- No breaking changes to existing auth flows

## Architecture Decisions

- **Pattern**: Repository pattern for token storage
- **Token Store**: Already exists at `/packages/core/src/auth/token-store.ts`
- **Persistence**: JSON files in `~/.llxprt/oauth/` with 0600 permissions
- **Lifecycle**: Tokens refreshed proactively with 30-second buffer

## Project Structure

```
packages/
  cli/
    src/
      auth/
        qwen-oauth-provider.ts      # UPDATE: Add persistence
        anthropic-oauth-provider.ts # UPDATE: Add persistence
        gemini-oauth-provider.ts    # REWRITE: Real implementation
        oauth-manager.ts            # UPDATE: Add logout
  core/
    src/
      auth/
        token-store.ts              # EXISTING: Token persistence
        types.ts                    # EXISTING: OAuth types
      providers/
        anthropic/AnthropicProvider.ts # UPDATE: Better errors
        gemini/GeminiProvider.ts      # UPDATE: Remove magic strings
```

## Technical Environment

- **Type**: CLI Tool OAuth Integration
- **Runtime**: Node.js 20.x
- **Dependencies**: 
  - Existing: `@anthropic-ai/sdk`, `@google/genai`
  - No new dependencies required

## Formal Requirements

[REQ-001] Token Persistence
  [REQ-001.1] Load persisted tokens on provider initialization
  [REQ-001.2] Save tokens after successful authentication
  [REQ-001.3] Update tokens after refresh
  [REQ-001.4] Validate token expiry before use

[REQ-002] Logout Functionality
  [REQ-002.1] Add logout method to OAuth providers
  [REQ-002.2] Clear tokens from persistent storage
  [REQ-002.3] Add logout command to CLI
  [REQ-002.4] Update OAuth enablement state

[REQ-003] Token Lifecycle Management
  [REQ-003.1] Refresh tokens with 30-second buffer
  [REQ-003.2] Remove invalid tokens on refresh failure
  [REQ-003.3] Handle expired refresh tokens gracefully
  [REQ-003.4] Validate tokens with provider when loaded

[REQ-004] Integration Requirements
  [REQ-004.1] Update existing providers to use token store
  [REQ-004.2] Maintain backward compatibility
  [REQ-004.3] Replace magic strings with real tokens
  [REQ-004.4] Ensure all auth commands work end-to-end

## Phase Breakdown

### Analysis & Design (Phases 01-02)
- P01: Domain analysis and integration mapping
- P02: Pseudocode for all components

### Qwen Provider Fixes (Phases 03-05)
- P03: Qwen persistence stub
- P04: Qwen persistence TDD
- P05: Qwen persistence implementation

### Anthropic Provider Fixes (Phases 06-08)
- P06: Anthropic persistence stub
- P07: Anthropic persistence TDD
- P08: Anthropic persistence implementation

### Gemini Provider Rewrite (Phases 09-11)
- P09: Gemini OAuth stub
- P10: Gemini OAuth TDD
- P11: Gemini OAuth implementation

### Logout Functionality (Phases 12-14)
- P12: Logout command stub
- P13: Logout command TDD
- P14: Logout command implementation

### Integration & Migration (Phases 15-16)
- P15: Integration with existing system
- P16: Migration and deprecation

## Success Metrics

- All OAuth tokens persist across CLI restarts
- Users can logout without exiting application
- Token refresh updates persistent storage
- No magic strings in production code
- 100% backward compatibility maintained
- All integration tests pass

## Risk Mitigation

- **Risk**: Breaking existing auth flows
  - **Mitigation**: Comprehensive integration tests, feature flags

- **Risk**: Token file corruption
  - **Mitigation**: Atomic file operations, validation on read

- **Risk**: Concurrent CLI instances
  - **Mitigation**: File locking, atomic writes

## Notes

- MultiProviderTokenStore infrastructure already exists and works
- Main issue is providers not utilizing it properly
- Gemini needs complete OAuth provider rewrite
- All changes must integrate with existing system, not build in isolation