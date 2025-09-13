# Phase 2: Core Enhancement Implementation

## Duration
2 days

## Goals
- Enhance ProviderPerformanceMetrics interface
- Implement tokens per minute tracking in ProviderPerformanceTracker
- Add session token accumulation methods to ProviderManager

## Tasks

### Task 2.1: Update ProviderPerformanceMetrics interface
- Add tokensPerMinute field
- Add throttleWaitTimeMs field
- Add sessionTokenUsage object with detailed breakdown

### Task 2.2: Enhance ProviderPerformanceTracker
- Add tokenTimestamps property for tracking token events
- Implement calculateTokensPerMinute method
- Update recordCompletion to track tokens and call calculateTokensPerMinute
- Add addThrottleWaitTime method

### Task 2.3: Enhance ProviderManager
- Add sessionTokenUsage property
- Implement accumulateSessionTokens method
- Implement resetSessionTokenUsage method
- Implement getSessionTokenUsage method

## Deliverables
- Updated ProviderPerformanceMetrics interface
- Enhanced ProviderPerformanceTracker with TPM tracking
- Enhanced ProviderManager with session token accumulation