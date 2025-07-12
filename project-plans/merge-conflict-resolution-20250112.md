# Merge Conflict Resolution Plan - sync-upstream-20250711

## Overview

Resolving conflicts between acoliver/gemini-cli (with multi-provider support) and google-gemini/gemini-cli upstream changes.

## Key Decisions

1. **Telemetry**: Keep telemetry disabled/removed (privacy-focused approach)
2. **User Identification**: Adopt upstream's email-based system (remove obfuscated IDs)
3. **Features**: Merge both provider management AND upstream OAuth/session improvements
4. **Event Types**: Include both UsageMetadata and MaxSessionTurns

## Conflict Resolution Strategy

### 1. Config Files (HIGH PRIORITY)

**Files**: `packages/cli/src/config/config.ts`, `packages/cli/src/config/settings.ts`, `packages/core/src/config/config.ts`

**Approach**:

- Keep provider management fields (providerManager, providers)
- Add upstream's noBrowser and maxSessionTurns fields
- Merge configuration interfaces to support both feature sets

### 2. Main Entry Point (HIGH PRIORITY)

**File**: `packages/cli/src/gemini.tsx`

**Approach**:

- Keep provider initialization logic
- Add OAuth pre-initialization from upstream
- Remove/comment out telemetry-related code
- Ensure both provider and OAuth flows work together

### 3. Telemetry Files (HIGH PRIORITY)

**Files**: Various telemetry-related files

**Approach**:

- Keep telemetry disabled/removed
- Remove auth_type additions from upstream
- Remove email-based logging enhancements
- Keep minimal telemetry infrastructure if needed for other features

### 4. Stream Handling (MEDIUM PRIORITY)

**File**: `packages/cli/src/ui/hooks/useGeminiStream.ts`

**Approach**:

- Add both UsageMetadata and MaxSessionTurns event handling
- Remove telemetry event emissions
- Ensure both event types work with provider system

### 5. Turn Events (MEDIUM PRIORITY)

**File**: `packages/core/src/core/turn.ts`

**Approach**:

- Include both event type definitions
- Ensure compatibility with provider system

### 6. OAuth Tests (MEDIUM PRIORITY)

**File**: `packages/core/src/code_assist/oauth2.test.ts`

**Approach**:

- Migrate from getCachedGoogleAccountId to getCachedGoogleAccount
- Update tests to use email-based identification

### 7. User ID Utils (MEDIUM PRIORITY)

**Files**: `packages/core/src/utils/user_id.ts`, `packages/core/src/utils/user_id.test.ts`

**Approach**:

- Remove obfuscated ID functions (they were temporary)
- Keep upstream's clean version

## Testing Plan

1. Resolve all conflicts file by file
2. Run `npm run lint` after each major file
3. Run `npm run typecheck` after all conflicts resolved
4. Test provider switching functionality
5. Test OAuth flow (with noBrowser option)
6. Verify telemetry is not sending data

## Rollback Plan

If merge becomes too complex:

1. Create new branch from current state
2. Cherry-pick specific features from upstream
3. Manually implement compatible features
