# Implementation Plan: Issue #489 - Phase 3: Advanced Failover with Metrics (TPM, Latency, Circuit Breakers)

**Issue:** #489
**Parent Issue:** #485
**Depends On:** #488 (Phase 2 - Complete)
**Branch:** issue489
**Date:** 2025-12-12

## Overview

This issue extends the load balancing failover capabilities with advanced performance-based triggers and circuit breaker patterns. It builds on the foundation established in Phase 2 (#488) which implemented basic failover with retry logic and network error handling.

### Important Testing Note

**Slash Commands vs. Automated Testing:**
- Slash commands (like `/profile save`, `/profile load`, `/set`) are **interactive commands** designed for manual use in the REPL
- They **cannot be executed by scripts or automated tests** (no stdin in non-interactive mode)
- **Automated tests** must create profile JSON files directly using file writes (`cat > file.json`)
- **Manual testing** should verify the slash commands work correctly for the interactive workflow
- Both approaches (slash commands and direct file creation) must result in the same profile format and behavior

### Key Features

1. **TPM (Tokens Per Minute) Threshold Triggers** - Failover when backend TPM falls below threshold
2. **Timeout-based Triggers** - Failover when requests exceed configured timeout
3. **Circuit Breaker Pattern** - Temporarily disable failing backends with automatic recovery
4. **Performance Metrics Collection** - Track requests, tokens, latency, success/failure rates
5. **Extended Stats Command** - Display circuit breaker state and performance metrics

### Extended Types

```typescript
interface ExtendedEphemeralSettings extends EphemeralSettings {
  // TPM trigger
  tpm_threshold?: number;              // Minimum tokens/min before failover

  // Timeout trigger
  timeout_ms?: number;                 // Maximum request duration

  // Circuit breaker
  circuit_breaker_enabled?: boolean;
  circuit_breaker_failure_threshold?: number;    // Failures before opening
  circuit_breaker_failure_window_ms?: number;    // Time window for counting failures
  circuit_breaker_recovery_timeout_ms?: number;  // Cooldown before retry
}
```

### Behavior

**TPM Trigger:**
- Track tokens consumed per minute using 5-minute rolling window
- Calculate average TPM across recent requests
- If TPM falls below threshold, trigger failover
- Log: `[LB:failover] Backend TPM (850) below threshold (1000), failing over`

**Timeout Trigger:**
- Wrap backend calls with timeout promise
- If request exceeds `timeout_ms`, cancel and failover
- Log: `[LB:failover] Backend timeout (30500ms > 30000ms), failing over`

**Circuit Breaker:**
1. **Closed State** (Normal): All backends available
2. **Open State** (Failing): Backend marked unhealthy after N failures in time window
   - Skip unhealthy backends during selection
   - Log: `[LB:circuit-breaker] Backend marked unhealthy (3 failures in 60s)`
3. **Half-Open State** (Recovery): After cooldown, try backend once
   - Success: Move back to Closed
   - Failure: Return to Open
   - Log: `[LB:circuit-breaker] Testing backend recovery`

## Implementation Phases

All phases follow TDD (Test-Driven Development):
- **Subagent A**: Creates comprehensive tests first
- **Subagent B**: Implements functionality to pass tests
- **Subagent C**: Verifies compliance, no stubs/TODOs, runs lints/tests

---

## PHASE 1: Types and Interfaces (TDD)

### Goal
Define TypeScript types and interfaces for extended metrics, circuit breaker state, and enhanced ephemeral settings.

### Subagent A: Test Creation
**File:** `packages/core/src/providers/__tests__/LoadBalancingProvider.types.test.ts`

Create tests for:
- `ExtendedLoadBalancerStats` interface with backend metrics
- `BackendMetrics` interface (requests, successes, failures, timeouts, tokens, avgLatency)
- `CircuitBreakerState` interface (state, failures[], openedAt, lastAttempt)
- Type guards for extended settings validation

### Subagent B: Implementation
**File:** `packages/core/src/providers/LoadBalancingProvider.ts` (extend existing)

Add interfaces:
```typescript
export interface BackendMetrics {
  requests: number;
  successes: number;
  failures: number;
  timeouts: number;
  tokens: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: Array<{ timestamp: number; error: Error }>;
  openedAt?: number;
  lastAttempt?: number;
}

export interface ExtendedLoadBalancerStats extends LoadBalancerStats {
  backendMetrics: Record<string, BackendMetrics>;
  circuitBreakerStates: Record<string, CircuitBreakerState>;
  currentTPM: Record<string, number>;
}
```

Extend `EphemeralSettings` in `packages/core/src/types/modelParams.ts`:
```typescript
export interface EphemeralSettings {
  // ... existing fields ...

  // TPM trigger (Phase 3)
  tpm_threshold?: number;

  // Timeout trigger (Phase 3)
  timeout_ms?: number;

  // Circuit breaker (Phase 3)
  circuit_breaker_enabled?: boolean;
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_failure_window_ms?: number;
  circuit_breaker_recovery_timeout_ms?: number;
}
```

### Subagent C: Verification
- Verify no `any` types
- Verify no stubs/TODOs
- Run `npm run lint` and `npm run typecheck`
- Run all tests

---

## PHASE 2: Circuit Breaker Logic (TDD)

### Goal
Implement circuit breaker state machine and logic for detecting failures, opening circuits, and recovery.

### Subagent A: Test Creation
**File:** `packages/core/src/providers/__tests__/LoadBalancingProvider.circuitbreaker.test.ts`

Create tests for:
- Circuit breaker starts in `closed` state
- Circuit breaker opens after N failures in time window
- Circuit breaker stays `open` during cooldown period
- Circuit breaker transitions to `half-open` after recovery timeout
- Circuit breaker closes on successful half-open attempt
- Circuit breaker returns to `open` on failed half-open attempt
- Old failures outside window are pruned
- Healthy backends bypass circuit breaker checks
- **All backends unhealthy error**: When all circuit breakers are open, throw specific error message

### Subagent B: Implementation
**File:** `packages/core/src/providers/LoadBalancingProvider.ts`

Add private members:
```typescript
private circuitBreakerStates: Map<string, CircuitBreakerState> = new Map();
```

Implement methods:
```typescript
private initCircuitBreakerState(profileName: string): CircuitBreakerState {
  return {
    state: 'closed',
    failures: [],
  };
}

private isBackendHealthy(profileName: string): boolean {
  const settings = this.extractFailoverSettings();
  if (!settings.circuitBreakerEnabled) return true;

  const state = this.circuitBreakerStates.get(profileName);
  if (!state || state.state === 'closed') return true;

  if (state.state === 'open') {
    const now = Date.now();
    const recoveryTimeout = settings.circuitBreakerRecoveryTimeoutMs;
    if (state.openedAt && now - state.openedAt >= recoveryTimeout) {
      state.state = 'half-open';
      this.logger.debug(() => `[circuit-breaker] ${profileName}: Testing recovery`);
      return true;
    }
    return false;
  }

  // half-open: allow one attempt
  return true;
}

private recordBackendSuccess(profileName: string): void {
  const state = this.circuitBreakerStates.get(profileName);
  if (state && state.state === 'half-open') {
    state.state = 'closed';
    state.failures = [];
    this.logger.debug(() => `[circuit-breaker] ${profileName}: Recovered`);
  }
}

private recordBackendFailure(profileName: string, error: Error): void {
  const settings = this.extractFailoverSettings();
  if (!settings.circuitBreakerEnabled) return;

  let state = this.circuitBreakerStates.get(profileName);
  if (!state) {
    state = this.initCircuitBreakerState(profileName);
    this.circuitBreakerStates.set(profileName, state);
  }

  const now = Date.now();
  state.failures.push({ timestamp: now, error });

  // Prune old failures outside window
  state.failures = state.failures.filter(
    f => now - f.timestamp < settings.circuitBreakerFailureWindowMs
  );

  // Check if threshold exceeded
  if (state.failures.length >= settings.circuitBreakerFailureThreshold) {
    state.state = 'open';
    state.openedAt = now;
    this.logger.debug(
      () => `[circuit-breaker] ${profileName}: Marked unhealthy (${state.failures.length} failures in window)`
    );
  }
}
```

Extend `extractFailoverSettings()`:
```typescript
private extractFailoverSettings(): FailoverSettings {
  const ephemeral = this.config.lbProfileEphemeralSettings ?? {};
  return {
    // ... existing fields ...
    circuitBreakerEnabled: ephemeral.circuit_breaker_enabled === true,
    circuitBreakerFailureThreshold: typeof ephemeral.circuit_breaker_failure_threshold === 'number'
      ? ephemeral.circuit_breaker_failure_threshold
      : 3,
    circuitBreakerFailureWindowMs: typeof ephemeral.circuit_breaker_failure_window_ms === 'number'
      ? ephemeral.circuit_breaker_failure_window_ms
      : 60000,
    circuitBreakerRecoveryTimeoutMs: typeof ephemeral.circuit_breaker_recovery_timeout_ms === 'number'
      ? ephemeral.circuit_breaker_recovery_timeout_ms
      : 30000,
  };
}
```

Update `executeWithFailover()` to:
- Skip unhealthy backends using `isBackendHealthy()`
- Call `recordBackendSuccess()` on successful requests
- Call `recordBackendFailure()` on failed requests
- **Handle all backends unhealthy**: If all circuit breakers are open (all backends unhealthy), throw a specific error:
  ```typescript
  throw new Error('All backends are currently unhealthy (circuit breakers open). Please wait for recovery or check backend configurations.');
  ```

### Subagent C: Verification
- Verify RULES.md compliance (no `any`, proper types)
- Verify no stubs/TODOs
- Run `npm run lint` and `npm run typecheck`
- Run all tests including new circuit breaker tests

---

## PHASE 3: Timeout Wrapper (TDD)

### Goal
Implement timeout mechanism that wraps backend calls and triggers failover on timeout **while preserving streaming behavior**.

**CRITICAL FIX:** The timeout wrapper MUST preserve streaming. The current design breaks streaming by collecting all chunks in memory before yielding. Instead:
- Use `AbortController` for proper cancellation
- Timeout on **first chunk only**, not total collection time
- Yield chunks as they arrive (preserve streaming)
- Clear timeout handle properly to prevent memory leaks

### Subagent A: Test Creation
**File:** `packages/core/src/providers/__tests__/LoadBalancingProvider.timeout.test.ts`

Create tests for:
- Timeout wrapper rejects after configured duration **on first chunk**
- Timeout wrapper allows successful completion before timeout
- Timeout trigger causes failover in failover strategy
- Timeout recorded as failure in backend metrics
- No timeout applied when `timeout_ms` not configured
- **Streaming preserved**: Chunks yielded as they arrive, not batched
- **Timeout handle cleared**: No memory leaks after timeout or success

### Subagent B: Implementation
**File:** `packages/core/src/providers/LoadBalancingProvider.ts`

Implement timeout wrapper **with streaming preservation**:
```typescript
private async *wrapWithTimeout(
  iterator: AsyncIterableIterator<IContent>,
  timeoutMs: number,
  profileName: string
): AsyncGenerator<IContent> {
  if (!timeoutMs || timeoutMs <= 0) {
    yield* iterator;
    return;
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    // Race first chunk against timeout
    const iteratorResult = iterator.next();
    const firstResult = await Promise.race([iteratorResult, timeoutPromise]);

    // Got first chunk, clear timeout
    if (timeoutHandle) clearTimeout(timeoutHandle);

    if (!firstResult.done) {
      yield firstResult.value;
    }

    // Yield remaining chunks (no timeout after first chunk)
    for await (const chunk of iterator) {
      yield chunk;
    }
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    throw error;
  }
}

private isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Request timeout');
}
```

Update `executeWithFailover()` to use streaming timeout wrapper:
```typescript
const settings = this.extractFailoverSettings();
const timeoutMs = settings.timeoutMs;

// Wrap iterator with timeout (preserves streaming)
const iterator = delegateProvider.generateChatCompletion(resolvedOptions);
const timeoutIterator = this.wrapWithTimeout(iterator, timeoutMs, subProfile.name);

// Yield chunks as they arrive (streaming preserved)
for await (const chunk of timeoutIterator) {
  yield chunk;
}
```

### Subagent C: Verification
- Verify timeout implementation follows best practices
- Verify no memory leaks (promises properly rejected)
- Run `npm run lint` and `npm run typecheck`
- Run all tests including timeout tests

---

## PHASE 4: TPM Tracking and Trigger (TDD)

### Goal
Implement TPM (Tokens Per Minute) tracking using 5-minute rolling window and TPM-based failover trigger.

**CRITICAL FIX:** TPM calculation must average over **elapsed time**, not occupied buckets.
- If 1000 tokens in 1 minute over a 5-minute window, TPM should be **200** (1000 tokens / 5 minutes), not 1000.
- Calculate TPM as: `totalTokens / elapsedMinutes` where elapsedMinutes is time since oldest bucket
- This provides accurate tokens-per-minute rate over the measurement window

### Subagent A: Test Creation
**File:** `packages/core/src/providers/__tests__/LoadBalancingProvider.tpm.test.ts`

Create tests for:
- TPM calculation uses 5-minute rolling buckets
- TPM updates correctly after each request with token count
- TPM trigger activates when below threshold
- TPM trigger ignored when not configured
- TPM buckets clean up old data (> 5 minutes)
- Empty buckets return 0 TPM
- **TPM calculated over elapsed time**: 1000 tokens in 1 minute over 5-minute window = 200 TPM
- **TPM calculation edge cases**: Single bucket, multiple buckets, sparse buckets

### Subagent B: Implementation
**File:** `packages/core/src/providers/LoadBalancingProvider.ts`

Add private members:
```typescript
// TPM buckets: Map<minuteBucket, Map<profileName, tokenCount>>
private tpmBuckets: Map<number, Map<string, number>> = new Map();
```

Implement TPM tracking with **corrected calculation**:
```typescript
private updateTPM(profileName: string, tokensUsed: number): void {
  const now = Date.now();
  const minute = Math.floor(now / 60000);

  let bucket = this.tpmBuckets.get(minute);
  if (!bucket) {
    bucket = new Map();
    this.tpmBuckets.set(minute, bucket);
  }

  const current = bucket.get(profileName) || 0;
  bucket.set(profileName, current + tokensUsed);

  // Clean up old buckets (> 5 minutes old)
  const cutoff = minute - 5;
  for (const [bucketMinute] of this.tpmBuckets) {
    if (bucketMinute < cutoff) {
      this.tpmBuckets.delete(bucketMinute);
    }
  }
}

private calculateTPM(profileName: string): number {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);

  let totalTokens = 0;
  let oldestBucket: number | undefined;
  let newestBucket: number | undefined;

  // Sum tokens from last 5 minutes and track bucket range
  for (let i = 0; i < 5; i++) {
    const minute = currentMinute - i;
    const bucket = this.tpmBuckets.get(minute);
    if (bucket) {
      const tokens = bucket.get(profileName) || 0;
      if (tokens > 0) {
        totalTokens += tokens;
        if (oldestBucket === undefined || minute < oldestBucket) {
          oldestBucket = minute;
        }
        if (newestBucket === undefined || minute > newestBucket) {
          newestBucket = minute;
        }
      }
    }
  }

  // Calculate TPM over elapsed time (not just occupied buckets)
  if (totalTokens === 0 || oldestBucket === undefined || newestBucket === undefined) {
    return 0;
  }

  // Elapsed time in minutes (add 1 because buckets are inclusive)
  const elapsedMinutes = (newestBucket - oldestBucket) + 1;

  // Return tokens per minute averaged over elapsed time
  return totalTokens / elapsedMinutes;
}

private shouldFailoverOnTPM(profileName: string, tpmThreshold: number): boolean {
  if (!tpmThreshold || tpmThreshold <= 0) return false;

  const currentTPM = this.calculateTPM(profileName);
  if (currentTPM < tpmThreshold) {
    this.logger.debug(
      () => `[LB:failover] ${profileName}: TPM (${currentTPM}) below threshold (${tpmThreshold})`
    );
    return true;
  }

  return false;
}
```

Extend `extractFailoverSettings()`:
```typescript
private extractFailoverSettings(): FailoverSettings {
  const ephemeral = this.config.lbProfileEphemeralSettings ?? {};
  return {
    // ... existing fields ...
    tpmThreshold: typeof ephemeral.tpm_threshold === 'number'
      ? ephemeral.tpm_threshold
      : undefined,
    timeoutMs: typeof ephemeral.timeout_ms === 'number'
      ? ephemeral.timeout_ms
      : undefined,
  };
}
```

Update `executeWithFailover()` to:
- Check TPM before attempting backend
- Update TPM after successful request with token count
- Extract token count from response metadata

### Subagent C: Verification
- Verify TPM calculation accuracy with edge cases
- Verify bucket cleanup prevents memory leaks
- Run `npm run lint` and `npm run typecheck`
- Run all tests including TPM tests

---

## PHASE 5: Performance Metrics Collection (TDD)

### Goal
Collect comprehensive backend metrics: requests, successes, failures, timeouts, tokens, and latency.

**NEW REQUIREMENT:** Add cross-provider token extraction helper to handle different response formats.

### Subagent A: Test Creation
**File:** `packages/core/src/providers/__tests__/LoadBalancingProvider.metrics.test.ts`

Create tests for:
- Backend metrics initialized correctly
- Request count increments on each attempt
- Success count increments on successful completion
- Failure count increments on error
- Timeout count increments on timeout error
- Token count accumulates correctly
- Latency calculated from start to finish
- Average latency computed correctly
- **Token extraction**: Handles Anthropic, OpenAI, Gemini response formats
- **Token extraction fallback**: Returns 0 for missing/unknown formats

### Subagent B: Implementation
**File:** `packages/core/src/providers/LoadBalancingProvider.ts`

Add private members:
```typescript
private backendMetrics: Map<string, BackendMetrics> = new Map();
```

Implement **cross-provider token extraction helper**:
```typescript
/**
 * Extract token count from provider response.
 * Handles different provider response formats gracefully.
 */
private extractTokenCount(chunks: IContent[]): number {
  if (!chunks || chunks.length === 0) return 0;

  // Look for usage information in the last chunk (common pattern)
  const lastChunk = chunks[chunks.length - 1];

  // Anthropic format: usage.input_tokens, usage.output_tokens
  if (lastChunk.usage) {
    const usage = lastChunk.usage as Record<string, unknown>;
    const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    if (inputTokens > 0 || outputTokens > 0) {
      return inputTokens + outputTokens;
    }
  }

  // OpenAI format: usage.prompt_tokens, usage.completion_tokens
  if (lastChunk.usage) {
    const usage = lastChunk.usage as Record<string, unknown>;
    const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
    const completionTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
    if (promptTokens > 0 || completionTokens > 0) {
      return promptTokens + completionTokens;
    }
  }

  // Gemini format: usageMetadata.promptTokenCount, usageMetadata.candidatesTokenCount
  if (lastChunk.usageMetadata) {
    const usageMetadata = lastChunk.usageMetadata as Record<string, unknown>;
    const promptTokenCount = typeof usageMetadata.promptTokenCount === 'number' ? usageMetadata.promptTokenCount : 0;
    const candidatesTokenCount = typeof usageMetadata.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : 0;
    if (promptTokenCount > 0 || candidatesTokenCount > 0) {
      return promptTokenCount + candidatesTokenCount;
    }
  }

  // Fallback: No token information found, return 0
  return 0;
}
```

Implement metrics tracking:
```typescript
private initBackendMetrics(profileName: string): BackendMetrics {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    timeouts: 0,
    tokens: 0,
    totalLatencyMs: 0,
    avgLatencyMs: 0,
  };
}

private recordRequestStart(profileName: string): number {
  let metrics = this.backendMetrics.get(profileName);
  if (!metrics) {
    metrics = this.initBackendMetrics(profileName);
    this.backendMetrics.set(profileName, metrics);
  }

  metrics.requests++;
  return Date.now();
}

private recordRequestSuccess(
  profileName: string,
  startTime: number,
  tokensUsed: number
): void {
  const metrics = this.backendMetrics.get(profileName);
  if (!metrics) return;

  const latency = Date.now() - startTime;
  metrics.successes++;
  metrics.tokens += tokensUsed;
  metrics.totalLatencyMs += latency;
  metrics.avgLatencyMs = metrics.totalLatencyMs / metrics.requests;

  this.updateTPM(profileName, tokensUsed);
}

private recordRequestFailure(
  profileName: string,
  startTime: number,
  error: Error
): void {
  const metrics = this.backendMetrics.get(profileName);
  if (!metrics) return;

  const latency = Date.now() - startTime;
  metrics.failures++;
  metrics.totalLatencyMs += latency;
  metrics.avgLatencyMs = metrics.totalLatencyMs / metrics.requests;

  if (this.isTimeoutError(error)) {
    metrics.timeouts++;
  }
}
```

Update `executeWithFailover()` to track metrics:
```typescript
const startTime = this.recordRequestStart(subProfile.name);
const chunks: IContent[] = [];
try {
  // ... execution and collect chunks ...
  const tokensUsed = this.extractTokenCount(chunks);
  this.recordRequestSuccess(subProfile.name, startTime, tokensUsed);
  this.recordBackendSuccess(subProfile.name);
} catch (error) {
  this.recordRequestFailure(subProfile.name, startTime, error as Error);
  this.recordBackendFailure(subProfile.name, error as Error);
  throw error;
}
```

Extend `getStats()` to return `ExtendedLoadBalancerStats`:
```typescript
getStats(): ExtendedLoadBalancerStats {
  const baseStats = /* existing implementation */;

  const backendMetrics: Record<string, BackendMetrics> = {};
  for (const [name, metrics] of this.backendMetrics) {
    backendMetrics[name] = { ...metrics };
  }

  const circuitBreakerStates: Record<string, CircuitBreakerState> = {};
  for (const [name, state] of this.circuitBreakerStates) {
    circuitBreakerStates[name] = { ...state };
  }

  const currentTPM: Record<string, number> = {};
  for (const subProfile of this.config.subProfiles) {
    currentTPM[subProfile.name] = this.calculateTPM(subProfile.name);
  }

  return {
    ...baseStats,
    backendMetrics,
    circuitBreakerStates,
    currentTPM,
  };
}
```

### Subagent C: Verification
- Verify metrics accuracy
- Verify no race conditions in metric updates
- Run `npm run lint` and `npm run typecheck`
- Run all tests

---

## PHASE 6: Set Command Integration for Ephemeral Settings (TDD)

### Goal
Add the new ephemeral settings to the `/set` command so users can modify them at runtime.

**NEW REQUIREMENT:** The new load balancer ephemeral settings must be accessible via `/set` commands, following the existing pattern in `setCommand.ts`.

### Settings to Add

All these settings should be added to `ephemeralSettingHelp` and validated in `setCommand.ts`:

1. **tpm_threshold** (number): Minimum tokens/minute before failover triggers
2. **timeout_ms** (number): Maximum request duration in milliseconds
3. **circuit_breaker_enabled** (boolean): Enable circuit breaker pattern
4. **circuit_breaker_failure_threshold** (number): Failures before opening circuit
5. **circuit_breaker_failure_window_ms** (number): Time window for counting failures in milliseconds
6. **circuit_breaker_recovery_timeout_ms** (number): Cooldown before retry in milliseconds

### Subagent A: Test Creation
**File:** `packages/cli/src/ui/commands/__tests__/setCommand.lb.test.ts`

Create tests for:
- `/set tpm_threshold 1000` sets the value correctly
- `/set timeout_ms 30000` sets the value correctly
- `/set circuit_breaker_enabled true` sets boolean correctly
- `/set circuit_breaker_failure_threshold 3` validates positive integer
- `/set circuit_breaker_failure_window_ms 60000` validates positive integer
- `/set circuit_breaker_recovery_timeout_ms 30000` validates positive integer
- `/set unset tpm_threshold` clears the setting
- Invalid values rejected with error messages
- Help text displayed when only key provided

### Subagent B: Implementation

**File:** `packages/cli/src/settings/ephemeralSettings.ts`

Add to `ephemeralSettingHelp`:
```typescript
export const ephemeralSettingHelp: Record<string, string> = {
  // ... existing settings ...

  // Load balancer settings (Phase 3, Issue #489)
  'tpm_threshold':
    'Minimum tokens per minute before triggering failover (positive integer, load balancer only)',
  'timeout_ms':
    'Maximum request duration in milliseconds before timeout (positive integer, load balancer only)',
  'circuit_breaker_enabled':
    'Enable circuit breaker pattern for failing backends (true/false, load balancer only)',
  'circuit_breaker_failure_threshold':
    'Number of failures before opening circuit (positive integer, default: 3, load balancer only)',
  'circuit_breaker_failure_window_ms':
    'Time window for counting failures in milliseconds (positive integer, default: 60000, load balancer only)',
  'circuit_breaker_recovery_timeout_ms':
    'Cooldown period before retrying after circuit opens in milliseconds (positive integer, default: 30000, load balancer only)',
};
```

Add validation in `parseEphemeralSettingValue()`:
```typescript
// Load balancer numeric settings
if (
  key === 'tpm_threshold' ||
  key === 'timeout_ms' ||
  key === 'circuit_breaker_failure_threshold' ||
  key === 'circuit_breaker_failure_window_ms' ||
  key === 'circuit_breaker_recovery_timeout_ms'
) {
  const numValue = parsedValue as number;
  if (
    typeof numValue !== 'number' ||
    numValue <= 0 ||
    !Number.isInteger(numValue)
  ) {
    return {
      success: false,
      message: `${key} must be a positive integer`,
    };
  }
}

// Load balancer boolean settings
if (key === 'circuit_breaker_enabled') {
  if (typeof parsedValue !== 'boolean') {
    return {
      success: false,
      message: `${key} must be either 'true' or 'false'`,
    };
  }
}
```

**File:** `packages/cli/src/ui/commands/setCommand.ts`

Add to `directSettingSpecs`:
```typescript
const directSettingSpecs: SettingLiteralSpec[] = [
  // ... existing settings ...

  // Load balancer settings
  {
    value: 'tpm_threshold',
    hint: 'positive integer (e.g., 1000)',
  },
  {
    value: 'timeout_ms',
    hint: 'positive integer in milliseconds (e.g., 30000)',
  },
  {
    value: 'circuit_breaker_enabled',
    hint: 'true or false',
    description: 'boolean value',
    options: booleanOptions,
  },
  {
    value: 'circuit_breaker_failure_threshold',
    hint: 'positive integer (e.g., 3)',
  },
  {
    value: 'circuit_breaker_failure_window_ms',
    hint: 'positive integer in milliseconds (e.g., 60000)',
  },
  {
    value: 'circuit_breaker_recovery_timeout_ms',
    hint: 'positive integer in milliseconds (e.g., 30000)',
  },
];
```

Add validation in `setCommand.action`:
```typescript
// Validate load balancer numeric settings
if (
  key === 'tpm_threshold' ||
  key === 'timeout_ms' ||
  key === 'circuit_breaker_failure_threshold' ||
  key === 'circuit_breaker_failure_window_ms' ||
  key === 'circuit_breaker_recovery_timeout_ms'
) {
  const numValue = parsedValue as number;
  if (
    typeof numValue !== 'number' ||
    numValue <= 0 ||
    !Number.isInteger(numValue)
  ) {
    return {
      type: 'message',
      messageType: 'error',
      content: `${key} must be a positive integer`,
    };
  }
}

// Validate circuit breaker boolean
if (key === 'circuit_breaker_enabled') {
  if (typeof parsedValue !== 'boolean') {
    return {
      type: 'message',
      messageType: 'error',
      content: `${key} must be either 'true' or 'false'`,
    };
  }
}
```

### Subagent C: Verification
- Verify all settings accessible via `/set`
- Verify validation works for each setting type
- Verify `/set unset` clears each setting
- Verify help text accurate and helpful
- Run `npm run lint` and `npm run typecheck`
- Run all tests

---

## PHASE 7: Profile Save/Load Integration (TDD)

### Goal
Ensure ephemeral settings work with profile save/load commands. Verify that load balancer profiles correctly save and restore all ephemeral settings.

**IMPORTANT:** Profile save/load already handles ephemeral settings via the existing mechanism in `profileCommand.ts` (lines 296-328). This phase verifies the new settings are properly included and work correctly.

**NOTE ON SLASH COMMANDS:**
- Slash commands like `/profile save` and `/profile load` are **interactive commands** for manual use
- They **cannot be executed by scripts or automated tests**
- Automated tests should create profile JSON files directly using file writes
- Manual testing should verify the slash commands work correctly
- Both approaches (slash commands and direct file creation) should result in the same profile format

### How Profile Save/Load Works

From `profileCommand.ts` (saveCommand):
```typescript
// Lines 296-307: Protected settings list (never saved to profiles)
const PROTECTED_SETTINGS = [
  'auth-key',
  'auth-keyfile',
  'base-url',
  'apiKey',
  'apiKeyfile',
  'model',
  'provider',
  'currentProfile',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
];

// Lines 309-317: Filter and save ephemeral settings
const currentEphemerals = runtime.getEphemeralSettings();
const filteredEphemerals = Object.fromEntries(
  Object.entries(currentEphemerals).filter(
    ([key, value]) =>
      !PROTECTED_SETTINGS.includes(key) &&
      value !== undefined &&
      value !== null,
  ),
);

// Lines 319-328: Create load balancer profile with filtered ephemerals
const lbProfile = {
  version: 1 as const,
  type: 'loadbalancer' as const,
  policy,
  profiles: selectedProfiles,
  provider: '',
  model: '',
  modelParams: {},
  ephemeralSettings: filteredEphemerals,  // All non-protected ephemeral settings saved
};
```

The new load balancer settings (`tpm_threshold`, `timeout_ms`, etc.) are **NOT** in the protected list, so they will be automatically saved and loaded with load balancer profiles.

### Subagent A: Test Creation
**File:** `packages/cli/src/ui/commands/__tests__/profileCommand.lb.test.ts`

Create tests for:
- Save load balancer profile with ephemeral settings includes all LB settings
- Load load balancer profile restores all LB settings correctly
- Settings persist in JSON profile file
- Protected settings excluded from saved profile
- Load balancer profile ephemeralSettings section contains:
  - `tpm_threshold`
  - `timeout_ms`
  - `circuit_breaker_enabled`
  - `circuit_breaker_failure_threshold`
  - `circuit_breaker_failure_window_ms`
  - `circuit_breaker_recovery_timeout_ms`
  - (and any other failover settings from Phase 2)

### Subagent B: Implementation

**No code changes required.** The existing mechanism in `profileCommand.ts` already handles saving and loading ephemeral settings correctly.

Verify that:
1. Load balancer settings are NOT in `PROTECTED_SETTINGS` list (they're not)
2. Settings are stored in `ephemeralSettings` field of saved profile
3. Settings are restored when profile is loaded
4. Settings work with `/profile save loadbalancer` command
5. Settings work with `--profile-load` CLI argument

### Subagent C: Verification
- Verify load balancer profile JSON contains ephemeral settings
- Verify settings restored after profile load
- Verify settings work with both `/profile load` (interactive) and `--profile-load` (CLI)
- **Manual Integration Test** (interactive slash commands):
  ```bash
  # In interactive session:
  /set tpm_threshold 1000
  /set circuit_breaker_enabled true
  /profile save loadbalancer testlb failover synthetic chutes
  /set unset tpm_threshold
  /set unset circuit_breaker_enabled
  /profile load testlb
  # Verify settings restored via runtime ephemeral settings
  ```
- **Automated Integration Test** (direct file creation):
  ```bash
  # Create profile JSON directly
  mkdir -p ~/.llxprt/profiles
  cat > ~/.llxprt/profiles/testlb.json << 'EOF'
  {
    "name": "testlb",
    "version": 1,
    "type": "loadbalancer",
    "policy": "failover",
    "profiles": ["synthetic", "chutes"],
    "ephemeralSettings": {
      "tpm_threshold": 1000,
      "circuit_breaker_enabled": true
    }
  }
  EOF

  # Test loading via CLI
  node scripts/start.js --profile-load testlb --prompt "test"
  # Verify settings applied correctly
  ```
- Run `npm run lint` and `npm run typecheck`
- Run all tests

---

## PHASE 8: Stats Command Integration (TDD)

### Goal
Extend `/stats` command to display load balancer metrics, circuit breaker state, and TPM.

### Subagent A: Test Creation
**File:** `packages/cli/src/ui/commands/__tests__/statsCommand.lb.test.ts`

Create tests for:
- `/stats lb` displays load balancer metrics
- `/stats loadbalancer` works as alias
- Stats include backend metrics (requests, success rate, avg latency)
- Stats include circuit breaker states
- Stats include current TPM per backend
- Error message when no load balancer profile active

### Subagent B: Implementation

**File:** `packages/cli/src/ui/types.ts` - Add new message type:
```typescript
export enum MessageType {
  // ... existing types ...
  LB_STATS = 'lb-stats',
}

export interface HistoryItemLBStats {
  type: MessageType.LB_STATS;
}
```

**File:** `packages/cli/src/ui/commands/statsCommand.ts` - Add subcommands:
```typescript
subCommands: [
  // ... existing subcommands ...
  {
    name: 'lb',
    altNames: ['loadbalancer'],
    description: 'Show load balancer usage statistics.',
    kind: CommandKind.BUILT_IN,
    action: (context: CommandContext) => {
      context.ui.addItem(
        {
          type: MessageType.LB_STATS,
        },
        Date.now(),
      );
    },
  },
],
```

**File:** `packages/cli/src/ui/components/HistoryItem.tsx` - Add rendering:
```typescript
case MessageType.LB_STATS:
  return <LBStatsDisplay />;
```

**File:** `packages/cli/src/ui/components/LBStatsDisplay.tsx` - Create new component:
```typescript
export function LBStatsDisplay(): JSX.Element {
  const { provider } = useContext(RuntimeContext);

  if (!provider || provider.name !== 'load-balancer') {
    return <Text color="red">No load balancer profile active</Text>;
  }

  const stats = (provider as LoadBalancingProvider).getStats();

  return (
    <Box flexDirection="column">
      <Text bold>Load Balancer Statistics</Text>
      <Text>Profile: {stats.profileName}</Text>
      <Text>Total Requests: {stats.totalRequests}</Text>

      <Text bold marginTop={1}>Backend Metrics:</Text>
      {Object.entries(stats.backendMetrics).map(([name, metrics]) => (
        <Box key={name} flexDirection="column" marginLeft={2}>
          <Text bold>{name}</Text>
          <Text>  Requests: {metrics.requests}</Text>
          <Text>  Success Rate: {((metrics.successes / metrics.requests) * 100).toFixed(1)}%</Text>
          <Text>  Avg Latency: {metrics.avgLatencyMs.toFixed(0)}ms</Text>
          <Text>  Tokens: {metrics.tokens}</Text>
          <Text>  TPM: {stats.currentTPM[name]?.toFixed(0) || 0}</Text>
        </Box>
      ))}

      <Text bold marginTop={1}>Circuit Breaker States:</Text>
      {Object.entries(stats.circuitBreakerStates).map(([name, state]) => (
        <Box key={name} flexDirection="row" marginLeft={2}>
          <Text>{name}: </Text>
          <Text color={state.state === 'closed' ? 'green' : 'yellow'}>{state.state}</Text>
        </Box>
      ))}
    </Box>
  );
}
```

### Subagent C: Verification
- Verify UI renders correctly
- Verify stats displayed accurately
- Run `npm run lint` and `npm run typecheck`
- Run all tests

---

## PHASE 9: Final Acceptance Testing

### Goal
End-to-end testing with real profile configuration to verify all features work together.

**IMPORTANT:** The automated acceptance test creates the profile by **writing the JSON file directly**. Slash commands are for interactive use only.

### Acceptance Test Profile
**File:** `~/.llxprt/profiles/testlb489.json`

This profile should be created by the acceptance test script, not via slash commands:

```json
{
  "name": "testlb489",
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["synthetic", "chutes", "groqgpt"],
  "provider": "",
  "model": "",
  "modelParams": {},
  "ephemeralSettings": {
    "tpm_threshold": 500,
    "timeout_ms": 30000,
    "circuit_breaker_enabled": true,
    "circuit_breaker_failure_threshold": 3,
    "circuit_breaker_failure_window_ms": 60000,
    "circuit_breaker_recovery_timeout_ms": 30000,
    "failover_retry_count": 2,
    "failover_retry_delay_ms": 1000
  }
}
```

### Acceptance Test Script
```bash
#!/bin/bash
# File: scripts/test-issue489.sh

set -e

echo "=== Acceptance Test for Issue #489 ==="
echo ""

# Step 1: Create the profile by writing JSON file directly
echo "Creating test profile..."
mkdir -p ~/.llxprt/profiles

cat > ~/.llxprt/profiles/testlb489.json << 'EOF'
{
  "name": "testlb489",
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["synthetic", "chutes", "groqgpt"],
  "provider": "",
  "model": "",
  "modelParams": {},
  "ephemeralSettings": {
    "tpm_threshold": 500,
    "timeout_ms": 30000,
    "circuit_breaker_enabled": true,
    "circuit_breaker_failure_threshold": 3,
    "circuit_breaker_failure_window_ms": 60000,
    "circuit_breaker_recovery_timeout_ms": 30000,
    "failover_retry_count": 2,
    "failover_retry_delay_ms": 1000
  }
}
EOF

echo "✓ Profile created at ~/.llxprt/profiles/testlb489.json"
echo ""

# Enable debug logging
export LLXPRT_DEBUG=llxprt:*

# Run test with load balancer profile
echo "Running load balancer test..."
node scripts/start.js --profile-load testlb489 --prompt "analyze this codebase and tell me what it does. do not use a subagent."

# Expected behavior:
# 1. Initial request to 'synthetic' backend
# 2. If synthetic times out (>30s), failover to 'chutes'
# 3. If backend fails 3 times in 60s, circuit opens
# 4. After 30s cooldown, circuit goes half-open and retries
# 5. TPM tracked and triggers failover if < 500

# Verify in logs:
# - [LB:timeout] messages on timeout
# - [circuit-breaker] state transitions
# - [LB:failover] TPM threshold checks
# - Backend selection logic

echo ""
echo "=== Automated Test Complete ==="
echo ""
echo "Manual verification steps:"
echo "1. Review debug logs for circuit breaker state transitions"
echo "2. In interactive session, run '/stats lb' to verify metrics"
echo "3. Test manual profile save: '/profile save loadbalancer test2 failover synthetic chutes'"
echo "4. Verify saved profile contains ephemeral settings"
```

### Manual Test Cases

1. **Timeout Trigger Test**
   - Configure `timeout_ms: 5000`
   - Use slow backend (e.g., local ollama with large model)
   - Verify timeout triggers after 5 seconds
   - Verify failover to next backend

2. **Circuit Breaker Test**
   - Configure circuit breaker with threshold 2
   - Cause 2 consecutive failures (e.g., invalid auth)
   - Verify circuit opens
   - Wait for recovery timeout
   - Verify circuit goes half-open
   - Make successful request
   - Verify circuit closes

3. **TPM Trigger Test**
   - Configure `tpm_threshold: 10000`
   - Use backend with low token output
   - Make several requests
   - Verify TPM calculated correctly
   - Verify failover when TPM < threshold

4. **Stats Display Test**
   - Run several requests across backends
   - Execute `/stats lb`
   - Verify all metrics displayed correctly
   - Verify circuit breaker states shown
   - Verify TPM values accurate

### Success Criteria

- All unit tests pass (100% coverage for new code)
- All integration tests pass
- Acceptance test completes successfully
- Timeout trigger works correctly
- Circuit breaker state transitions work
- TPM tracking and failover trigger work
- Stats command displays all metrics
- No lint/typecheck errors
- Debug logging shows all decisions
- No memory leaks (metrics cleanup verified)

---

## Files to Create

1. `packages/core/src/providers/__tests__/LoadBalancingProvider.types.test.ts`
2. `packages/core/src/providers/__tests__/LoadBalancingProvider.circuitbreaker.test.ts`
3. `packages/core/src/providers/__tests__/LoadBalancingProvider.timeout.test.ts`
4. `packages/core/src/providers/__tests__/LoadBalancingProvider.tpm.test.ts`
5. `packages/core/src/providers/__tests__/LoadBalancingProvider.metrics.test.ts`
6. `packages/cli/src/ui/commands/__tests__/statsCommand.lb.test.ts`
7. `packages/cli/src/ui/components/LBStatsDisplay.tsx`
8. `profiles/testlb489.json`

## Files to Modify

1. `packages/core/src/providers/LoadBalancingProvider.ts` - Main implementation
2. `packages/core/src/types/modelParams.ts` - Extend EphemeralSettings
3. `packages/cli/src/ui/commands/statsCommand.ts` - Add lb subcommand
4. `packages/cli/src/ui/types.ts` - Add LB_STATS message type
5. `packages/cli/src/ui/components/HistoryItem.tsx` - Add LBStatsDisplay rendering

## Testing Strategy

Each phase follows strict TDD:
1. **Tests First**: Comprehensive test coverage before implementation
2. **Implementation**: Code to pass all tests
3. **Verification**: Lint, typecheck, run all tests, check for stubs/TODOs
4. **No Stubs**: All code must be production-ready, no placeholder TODOs

## Dependencies

- Requires Phase 2 (#488) complete with working failover strategy
- Uses existing `DebugLogger` for logging
- Uses existing `isNetworkTransientError()` and `getErrorStatus()` from retry utils
- Uses existing `LoadBalancingProvider` as base

## Notes

- Circuit breaker state is ephemeral (not persisted across sessions)
- TPM buckets auto-cleanup after 5 minutes
- Timeout wrapper properly cleans up promises to prevent memory leaks
- All new ephemeral settings are optional with sensible defaults
- Stats command gracefully handles non-load-balancer profiles
- Debug logging at `llxprt:providers:load-balancer` namespace

## Timeline Estimate

- Phase 1: 2 hours (types and interfaces)
- Phase 2: 4 hours (circuit breaker logic)
- Phase 3: 3 hours (timeout wrapper)
- Phase 4: 4 hours (TPM tracking)
- Phase 5: 3 hours (metrics collection)
- Phase 6: 3 hours (stats UI integration)
- Phase 7: 2 hours (acceptance testing)
- **Total: 21 hours**

## Commit Strategy

Each phase gets its own commit after verification:
- `feat(loadbalancer): add extended types for metrics and circuit breaker fixes #489`
- `feat(loadbalancer): implement circuit breaker state machine fixes #489`
- `feat(loadbalancer): add timeout wrapper for failover triggers fixes #489`
- `feat(loadbalancer): implement TPM tracking and triggers fixes #489`
- `feat(loadbalancer): add comprehensive backend metrics collection fixes #489`
- `feat(loadbalancer): integrate lb stats command and UI fixes #489`
- `test(loadbalancer): add acceptance tests for issue #489 fixes #489`

Final commit:
- `feat(loadbalancer): complete Phase 3 advanced failover with metrics fixes #489`
