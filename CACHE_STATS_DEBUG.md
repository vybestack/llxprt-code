# Cache Stats Debug Analysis

## Issue

Issue #528: `/stats cache` shows "No cache data available" despite caching being implemented.

## Investigation Summary

### Code Flow Analysis

The cache statistics flow works as follows:

1. **AnthropicProvider** (lines 1288-1322, 1445-1471):
   - Extracts `cache_read_input_tokens` and `cache_creation_input_tokens` from Anthropic API responses
   - Emits these values in `IContent.metadata.usage` for both streaming and non-streaming modes

2. **LoggingProviderWrapper** (lines 670-714, 716-771):
   - Has two paths depending on conversation logging setting:
     - If logging enabled: `logResponseStream` → `logResponse`
     - If logging disabled: `processStreamForMetrics`
   - Both paths collect `latestTokenUsage` from stream chunks
   - Both eventually call `extractTokenCountsFromTokenUsage` and `accumulateTokenUsage`

3. **LoggingProviderWrapper.extractTokenCountsFromTokenUsage** (lines 885-911):
   - Extracts cache metrics from `UsageStats` interface
   - Maps to internal token count structure

4. **LoggingProviderWrapper.accumulateTokenUsage** (lines 1016-1061):
   - Maps token counts to ProviderManager format
   - Calls `ProviderManager.accumulateSessionTokens`

5. **ProviderManager.accumulateSessionTokens** (lines 1003-1046):
   - Checks if `cacheReads` or `cacheWrites` are not undefined
   - Calls `trackCacheUsage` if cache data present

6. **ProviderManager.trackCacheUsage** (lines 1083-1111):
   - Updates `cacheStats.totalCacheReads` and `cacheStats.totalCacheWrites`
   - Increments request counters
   - Calculates hit rate

7. **CacheStatsDisplay** (line 54):
   - Calls `providerManager.getCacheStatistics()`
   - Shows "No cache data available" if `totalCacheReads === 0 && totalCacheWrites === 0`

### Debug Logging Added

To identify where cache metrics are being lost, I added debug logging at key points:

1. **AnthropicProvider** (lines 1292-1295, 1448-1451):

   ```typescript
   cacheLogger.debug(
     () =>
       `[AnthropicProvider streaming/non-streaming] Emitting usage metadata: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, raw values: cache_read_input_tokens=${usage.cache_read_input_tokens}, cache_creation_input_tokens=${usage.cache_creation_input_tokens}`,
   );
   ```

2. **LoggingProviderWrapper.extractTokenCountsFromTokenUsage** (lines 897-900):

   ```typescript
   this.debug.debug(
     () =>
       `[extractTokenCountsFromTokenUsage] Extracting from UsageStats: cacheReads=${cacheReads}, cacheWrites=${cacheWrites}, raw values: cache_read=${tokenUsage.cache_read_input_tokens}, cache_creation=${tokenUsage.cache_creation_input_tokens}`,
   );
   ```

3. **LoggingProviderWrapper.accumulateTokenUsage** (lines 1039-1042, 1048-1051):

   ```typescript
   this.debug.debug(
     () =>
       `[accumulateTokenUsage] Mapped tokenCounts to usage: cacheReads=${usage.cacheReads}, cacheWrites=${usage.cacheWrites}`,
   );
   this.debug.debug(
     () =>
       `[TokenTracking] Accumulating tokens for provider ${this.wrapped.name}, cacheReads=${usage.cacheReads}, cacheWrites=${usage.cacheWrites}`,
   );
   ```

4. **ProviderManager.accumulateSessionTokens** (lines 1015-1017):
   ```typescript
   logger.debug(
     () =>
       `[ProviderManager.accumulateSessionTokens] Called with: cacheReads=${usage.cacheReads}, cacheWrites=${usage.cacheWrites}, cacheReads===undefined: ${usage.cacheReads === undefined}, cacheWrites===undefined: ${usage.cacheWrites === undefined}`,
   );
   ```

### How to Test

1. Enable debug logging:

   ```bash
   export DEBUG="llxprt:*"
   ```

2. Make a request that should use caching (e.g., with prompt-caching enabled)

3. Run `/stats cache` to see if cache stats appear

4. Check the logs for:
   - `[AnthropicProvider]` logs showing cache values emitted
   - `[extractTokenCountsFromTokenUsage]` logs showing values extracted
   - `[accumulateTokenUsage]` logs showing values mapped
   - `[ProviderManager.accumulateSessionTokens]` logs showing values received
   - `[ProviderManager.trackCacheUsage]` logs showing stats updated

The debug logs will reveal exactly where in the flow cache metrics are being lost or incorrectly set to 0.

## Expected Behavior

When Anthropic returns cache metrics:

- `cache_read_input_tokens` > 0 when cache is hit (prompt reused)
- `cache_creation_input_tokens` > 0 when cache is created (first time seeing prompt)

These should flow through to `ProviderManager.cacheStats` and be displayed by `/stats cache`.

## Possible Root Causes

Based on the code analysis, potential issues could be:

1. **Anthropic not returning cache metrics**: The API might not be including these fields
2. **UsageStats extraction issue**: The values might be getting lost in the extraction
3. **Undefined vs 0 handling**: The condition check might not be working as expected
4. **Provider manager not initialized**: The `getProviderManager()` might be returning undefined
5. **Multiple provider manager instances**: Different instances tracking different stats

The debug logging will identify which of these is occurring.

## Files Modified

- `packages/core/src/providers/anthropic/AnthropicProvider.ts`
- `packages/core/src/providers/LoggingProviderWrapper.ts`
- `packages/core/src/providers/ProviderManager.ts`

## Next Steps

1. Test with debug logging enabled
2. Identify where cache metrics are being lost
3. Implement targeted fix based on findings
4. Remove debug logging or convert to permanent debug statements
5. Verify fix works for both OAuth and non-OAuth modes
