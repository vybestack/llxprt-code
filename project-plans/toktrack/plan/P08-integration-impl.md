# Integration Implementation Phase

This phase details how the token tracking enhancement will be connected to the existing LLxprt Code system.

## Implementation Steps

### Step 1: Update ProviderPerformanceMetrics Interface (from pseudocode lines 10-29)
/**
 * @plan PLAN-20250909-TOKTRACK.P08
 * @requirement REQ-001, REQ-002, REQ-003
 * @pseudocode lines 10-29 from component-001.md
 */
- Add tokensPerMinute: number field (pseudocode line 17)
- Add throttleWaitTimeMs: number field (pseudocode line 21)
- Add sessionTokenUsage object with input, output, cache, tool, thought, and total fields (pseudocode lines 22-28)

### Step 2: Enhance ProviderPerformanceTracker (from pseudocode lines 10-78)
/**
 * @plan PLAN-20250909-TOKTRACK.P08
 * @requirement REQ-001, REQ-002
 * @pseudocode lines 10-78 from component-002.md
 */
- Implement tokenTimestamps array to track timestamp and token count pairs (pseudocode line 12)
- Implement calculateTokensPerMinute method to calculate rolling TPM average (pseudocode lines 44-50)
- Update recordCompletion to track tokens and call calculateTokensPerMinute (pseudocode lines 27-42)
- Implement addThrottleWaitTime method to accumulate throttle wait times (pseudocode lines 75-77)

### Step 3: Enhance ProviderManager (from pseudocode lines 10-37)
/**
 * @plan PLAN-20250909-TOKTRACK.P08
 * @requirement REQ-003
 * @pseudocode lines 10-37 from component-003.md
 */
- Implement sessionTokenUsage object to track cumulative token usage (pseudocode lines 12-18)
- Implement accumulateSessionTokens method to add token usage from providers (pseudocode lines 21-28)
- Implement resetSessionTokenUsage method to clear session metrics (pseudocode lines 30-32)
- Implement getSessionTokenUsage method to retrieve session metrics (pseudocode lines 34-36)

### Step 4: Update LoggingProviderWrapper (from pseudocode lines 10-82)
/**
 * @plan PLAN-20250909-TOKTRACK.P08
 * @requirement REQ-003
 * @pseudocode lines 10-82 from component-004.md
 */
- Implement extractTokenCountsFromResponse to parse token usage from API responses (pseudocode lines 67-76)
- Update logResponse to extract and accumulate token usage after successful responses (pseudocode lines 62-65, 78-81)

### Step 5: Update Retry System (from pseudocode lines 10-60)
/**
 * @plan PLAN-20250909-TOKTRACK.P08
 * @requirement REQ-002
 * @pseudocode lines 10-60 from component-005.md
 */
- Update retryWithBackoff to call trackThrottleWaitTime when handling 429 wait times (pseudocode lines 30-45)
- Implement trackThrottleWaitTime to record throttle wait times in ProviderPerformanceTracker (pseudocode lines 57-60)

### Step 6: Enhance Telemetry System (from pseudocode throughout)
/**
 * @plan PLAN-20250909-TOKTRACK.P08
 * @requirement REQ-001, REQ-002, REQ-003
 */
- Update logApiResponse to record new token tracking metrics

### Step 7: Update UI Components (from pseudocode lines 10-71)
/**
 * @plan PLAN-20250909-TOKTRACK.P08
 * @requirement REQ-INT-001
 * @pseudocode lines 10-71 from component-006.md
 */
- Modify Footer component to display TPM and throttle wait time (pseudocode lines 24-27)
- Modify StatsDisplay component to show detailed token tracking information (pseudocode lines 41-45)
- Update diagnosticsCommand to include new metrics in output

## Connection Points

1. ProviderPerformanceTracker ⟶ ProviderManager (accumulateSessionTokens)
2. LoggingProviderWrapper ⟶ ProviderPerformanceTracker (addThrottleWaitTime)
3. Retry system ⟶ ProviderPerformanceTracker (addThrottleWaitTime)
4. Telemetry system ⟶ UI components (metrics display)
5. UI components ⟶ User (token tracking visibility)

## Data Flow

1. API responses contain token usage information
2. LoggingProviderWrapper extracts token counts from responses
3. ProviderManager accumulates session token usage
4. Retry system tracks throttle wait times
5. ProviderPerformanceTracker calculates TPM and tracks throttle wait times
6. Telemetry system records and exposes metrics
7. UI components display metrics to users