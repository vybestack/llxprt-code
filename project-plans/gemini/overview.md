# Gemini Provider Architecture Unification

## Overview

This plan addresses the current dual-path architecture where Gemini operates both as a "default" mode (legacy) and as a provider. The goal is to unify these paths so that Gemini always operates through the provider architecture, eliminating confusion around authentication, model selection, and command behavior.

## Current State

### Problems

1. **Dual-Path Architecture**: Gemini works in two modes:
   - Legacy mode (when `activeProviderName = ''`)
   - Provider mode (when explicitly activated via `/provider gemini`)

2. **Command Inconsistencies**:
   - `/key` and `/keyfile` fail in legacy mode (require active provider)
   - `/model` behaves differently based on mode
   - Authentication methods scattered between legacy and provider systems

3. **Authentication Complexity**:
   - Three auth types in legacy: OAuth, Gemini API key, Vertex AI
   - Provider system only handles API keys
   - Vertex AI requires special environment variables and configuration

## Design Goals

### 1. Unified Provider Architecture

- Make `GeminiProvider` always active by default (not empty `activeProviderName`)
- Remove dual-path logic throughout the codebase
- All Gemini interactions go through the provider interface

### 2. Authentication Strategy

- **No auth prompt on startup** - only when needed
- **GeminiProvider handles all auth types**:
  - OAuth (personal authentication)
  - Gemini API key
  - Vertex AI credentials
- **Fallback hierarchy**: Vertex key → Gemini key → OAuth prompt

### 3. Model Management

- **OAuth mode**: Return fixed list (gemini-2.5-pro, gemini-2.5-flash)
- **API key modes**: Fetch real model list from API
- **Consistent model naming**: Always use provider-prefixed format

### 4. Command Behavior

- `/key` and `/keyfile` work immediately (no need to activate provider first)
- `/model` always uses provider model dialog
- `/auth` manages authentication mode within the provider

## Implementation Phases

1. **Provider Architecture Migration** - Make Gemini provider active by default
2. **Authentication Integration** - Move all auth types into GeminiProvider
3. **Command Updates** - Update commands to work with unified architecture
4. **Legacy Cleanup** - Remove dual-path code and legacy behaviors

## Success Criteria

- Users can use `/key`, `/keyfile`, `/model` immediately without `/provider gemini`
- All three authentication methods work through the provider
- No legacy code paths remain
- Consistent behavior across all providers
