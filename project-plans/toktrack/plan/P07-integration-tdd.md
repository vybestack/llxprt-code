# Integration TDD Phase

This phase outlines the behavioral tests required to verify that the token tracking enhancement works properly within the existing LLxprt Code system.

## Test Requirements

### Test 1: ProviderPerformanceTracker TPM Calculation
/**
 * @requirement REQ-001
 * @scenario Tokens per minute calculation
 * @given A series of API responses with timestamps and token counts
 * @when recordCompletion is called with these responses
 * @then tokensPerMinute should reflect accurate rolling average
 * @and Must update correctly when new responses arrive
 */

### Property-based Tests for TPM Calculation
/**
 * @requirement REQ-001.PBT
 * @scenario Property-based testing for tokens per minute
 * @property For any valid sequence of timestamp/token pairs, tokensPerMinute should never be negative
 * @property For a sequence with identical token timestamps, tokensPerMinute should be zero
 * @property For a sequence with increasing token counts over time, tokensPerMinute should be positive
 * @property Adding a token count with a timestamp older than 60 seconds should not affect tokensPerMinute
 * @generator Timestamp/token pairs with random intervals and counts
 * @min_success_rate 80%
 */

### Test 2: ProviderPerformanceTracker Throttle Tracking
/**
 * @requirement REQ-002
 * @scenario Throttle wait time accumulation
 * @given A series of 429 errors with wait times
 * @when addThrottleWaitTime is called with these wait times
 * @then throttleWaitTimeMs should contain cumulative wait time
 * @and Must reset correctly when metrics are reset
 */

### Property-based Tests for Throttle Tracking
/**
 * @requirement REQ-002.PBT
 * @scenario Property-based testing for throttle wait time accumulation
 * @property For any valid sequence of wait times, throttleWaitTimeMs should never be negative
 * @property For an empty sequence, throttleWaitTimeMs should be zero
 * @property For a sequence of positive wait times, throttleWaitTimeMs should equal their sum
 * @property Resetting metrics should set throttleWaitTimeMs to zero regardless of accumulated value
 * @generator Wait time values in milliseconds with random positive integers
 * @min_success_rate 80%
 */

### Test 3: ProviderManager Session Token Accumulation
/**
 * @requirement REQ-003
 * @scenario Session token usage accumulation
 * @given Multiple providers returning token usage metrics
 * @when accumulateSessionTokens is called for each provider
 * @then getSessionTokenUsage should return correct cumulative totals
 * @and Must distinguish between input, output, cache, tool, and thought tokens
 */

### Property-based Tests for Session Token Accumulation
/**
 * @requirement REQ-003.PBT
 * @scenario Property-based testing for session token accumulation
 * @property All token usage fields should never be negative after accumulation
 * @property Session totals should equal sum of all provider contributions
 * @property Resetting session usage should set all fields to zero
 * @property Adding token usage should increase total by at least the sum of added components
 * @generator Token usage objects with random positive integers for each component
 * @min_success_rate 80%
 */

### Test 4: LoggingProviderWrapper Token Extraction
/**
 * @requirement REQ-003
 * @scenario Extract token counts from API responses
 * @given Real API responses with token count headers or fields
 * @when extractTokenCountsFromResponse is called
 * @then Should return correctly parsed token counts object
 * @and Should handle various response formats from different providers
 */

### Property-based Tests for Token Extraction
/**
 * @requirement REQ-003.PBT.1
 * @scenario Property-based testing for token count extraction
 * @property Extracted token counts should never be negative
 * @property If no token fields are present in response, all counts should be zero
 * @property Extraction should handle missing or null token fields gracefully
 * @property Valid responses should produce at least one positive token count if tokens were used
 * @generator Response objects with random combinations of token fields
 * @min_success_rate 80%
 */

/**
 * @requirement REQ-003.PBT.2
 * @scenario Property-based testing for provider-specific token extraction
 * @property Gemini responses should correctly extract token counts from gemini-specific fields
 * @property OpenAI responses should correctly extract token counts from usage fields
 * @property Anthropic responses should correctly extract token counts from anthropic-specific headers
 * @generator Provider-specific response objects with known token field formats
 * @min_success_rate 80%
 */

### Test 5: Retry System Throttle Integration
/**
 * @requirement REQ-002
 * @scenario Track throttling wait times in retry system
 * @given API calls that result in 429 errors
 * @when retryWithBackoff handles 429 errors with explicit wait times
 * @then trackThrottleWaitTime should be called with correct wait time values
 * @and ProviderPerformanceTracker should reflect updated throttle wait times
 */

### Property-based Tests for Retry System
/**
 * @requirement REQ-002.PBT.2
 * @scenario Property-based testing for retry system throttle tracking
 * @property Retry attempts should increase throttle wait time accumulation
 * @property Different delay strategies should properly accumulate in throttle wait time
 * @property Explicit Retry-After headers should be accurately reflected in wait time tracking
 * @property Exponential backoff delays should properly compound in wait time tracking
 * @generator 429 error scenarios with random wait times and retry patterns
 * @min_success_rate 80%
 */

### Test 6: Telemetry System Integration
/**
 * @requirement REQ-001, REQ-002, REQ-003
 * @scenario Record new metrics with telemetry system
 * @given ProviderPerformanceMetrics with new token tracking fields
 * @when logApiResponse is called with these metrics
 * @then Telemetry logs should contain new token tracking information
 * @and Should properly format and record all new metrics
 */

### Test 7: Footer UI Component Integration
/**
 * @requirement REQ-INT-001.1
 * @scenario Display TPM and throttle wait time in footer
 * @given ProviderPerformanceMetrics with new token fields
 * @when Footer is rendered with these metrics
 * @then Should display formatted TPM and throttle wait time
 * @and Should handle various TPM values (low, medium, high)
 * @and Should handle various throttle wait time values (milliseconds to minutes)
 */

### Property-based Tests for Footer Display
/**
 * @requirement REQ-INT-001.1.PBT
 * @scenario Property-based testing for footer display formatting
 * @property TPM formatting should handle values from 0 to 100k+ correctly
 * @property Throttle wait time formatting should display appropriate units for different ranges
 * @property Session token formatting should handle various cumulative values
 * @property Display should not overflow allocated UI space for any reasonable values
 * @generator Token metrics values with random ranges for display testing
 * @min_success_rate 80%
 */

### Test 8: StatsDisplay UI Component Integration
/**
 * @requirement REQ-INT-001.2
 * @scenario Display detailed token metrics in stats display
 * @given ProviderPerformanceMetrics and sessionTokenUsage data
 * @when StatsDisplay is rendered with these metrics
 * @then Should display TPM, throttle wait time, and session token breakdown
 * @and Formatting should be clear and human-readable
 */

### Property-based Tests for Stats Display
/**
 * @requirement REQ-INT-001.2.PBT
 * @scenario Property-based testing for stats display formatting
 * @property All token tracking components should appear in stats display
 * @property Token breakdown categories should accurately sum to total
 * @property UI should adapt to different relative proportions of token categories
 * @property Display should use readable formatting for all metrics
 * @generator Token usage objects with random values across categories
 * @min_success_rate 80%
 */

### Test 9: Diagnostics Command Integration
/**
 * @requirement REQ-INT-001.3
 * @scenario Include new token metrics in diagnostics output
 * @given ProviderPerformanceMetrics with new token tracking fields
 * @when diagnosticsCommand is executed
 * @then Should include TPM, throttle wait time, and session token usage in output
 * @and Should properly format all values for display
 */

### Property-based Tests for Diagnostics Command
/**
 * @requirement REQ-INT-001.3.PBT
 * @scenario Property-based testing for diagnostics output
 * @property All token tracking metrics should appear in diagnostics output
 * @property Metrics should be formatted appropriately for CLI output
 * @property Output should maintain consistent ordering of token tracking information
 * @property JSON output format should correctly serialize all new metrics
 * @generator Provider metrics with random token tracking values
 * @min_success_rate 80%
 */

## Integration Test Requirements

1. All tests must validate end-to-end flows, not just component internals
2. Tests should verify real interactions between components
3. No mock verification tests - must test actual behavior
4. Must cover various scenarios including edge cases
5. Should verify metrics consistency across system components
6. Property-based testing must cover 80%+ success rate for each property
7. Each component must have at least one property-based test scenario