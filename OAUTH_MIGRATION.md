# LLXPRT OAuth Token Storage Migration

## Overview

LLXPRT has migrated to a new standardized OAuth token storage system that provides better security, consistency, and reliability across all AI providers.

## What Changed

### New Token Storage Locations

All OAuth tokens are now stored in provider-specific files in the `~/.llxprt/oauth/` directory:

- **Anthropic**: `~/.llxprt/oauth/anthropic.json`
- **Gemini**: `~/.llxprt/oauth/gemini.json`
- **Qwen**: `~/.llxprt/oauth/qwen.json`

### Legacy Storage (No Longer Used)

The following legacy storage locations are **no longer used**:

- `~/.llxprt/oauth_creds.json` (old Gemini storage)
- In-memory token storage during CLI sessions

### Key Improvements

1. **Standardized Storage**: All providers now use the same storage format and location pattern
2. **Token Persistence**: Tokens automatically persist across CLI restarts
3. **Better Security**: Individual provider files with proper file permissions
4. **Clean Logout**: Complete token removal when logging out
5. **No Magic Strings**: Removed special-case handling and magic string dependencies

## Action Required

**If you experience authentication issues after this update, please re-authenticate:**

```bash
# Re-login to each provider you use
llxprt auth login anthropic
llxprt auth login gemini
llxprt auth login qwen

# To logout from a specific provider
llxprt auth logout anthropic
llxprt auth logout gemini
llxprt auth logout qwen
```

## No Automatic Migration

**Important**: Existing tokens in the legacy `~/.llxprt/oauth_creds.json` file are **NOT automatically migrated**. You will need to re-authenticate with each provider.

This is intentional to ensure:

- Clean transition to new storage format
- Proper token validation and refresh
- Removal of any corrupted or expired legacy tokens

## Verification

After re-authentication, you can verify your tokens are properly stored:

```bash
# Check if token files exist (they should be created after login)
ls -la ~/.llxprt/oauth/

# Test provider access
llxprt providers list
```

## Technical Details

### For Developers

The migration includes these technical improvements:

1. **TokenStore Integration**: All OAuth providers now use the standardized `TokenStore` interface
2. **Deprecation Warnings**: Providers will warn if created without `TokenStore` support
3. **Type Safety**: Complete removal of `any` types and magic strings
4. **Test Coverage**: Comprehensive integration tests for token persistence and logout

### Plan Reference

This migration implements:

- **Plan ID**: `PLAN-20250823-AUTHFIXES.P16`
- **Requirements**: REQ-004.2 (Migration and Deprecation)
- **Completion Date**: 2025-08-23

## Support

If you encounter issues after following the re-authentication steps:

1. Verify the `~/.llxprt/oauth/` directory exists and is writable
2. Check that your system time is correct (affects token expiration)
3. Ensure you have the latest version of LLXPRT
4. Try clearing all tokens and re-authenticating:
   ```bash
   rm -rf ~/.llxprt/oauth/
   llxprt auth login [provider]
   ```

The new token storage system provides a more robust and maintainable foundation for OAuth authentication across all AI providers in LLXPRT.
