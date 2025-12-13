# Failover Policy Implementation Plan - Issue #488 (REVISED)

**Issue**: #488
**Related**: #485 (design), #486 (round-robin implementation - completed)
**Date**: 2025-12-12
**Plan**: PLAN-20251212issue488
**Revision**: 2 - Fixed streaming, error handling, CLI parsing, and edge cases

## Overview

This plan implements the `failover` policy for load balancing, which executes backends sequentially until one succeeds. This is the second policy option alongside the existing `roundrobin` policy.

## Key Requirements from Issue #488

1. Add `failover` as second policy option alongside `roundrobin`
2. CLI: `/profile save loadbalancer profilename [policy] profile1 profile2 ...`
3. Default: fail over on ANY error, retry immediately
4. Two-level: per-backend retries + cross-backend failover
5. Configuration via ephemeral settings
6. Stop at first successful backend (stop-at-first-success)

## Existing Code Analysis

### Current Strategy Type (packages/core/src/providers/LoadBalancingProvider.ts)
```typescript
export interface LoadBalancingProviderConfig {
  profileName: string;
  strategy: 'round-robin';  // Currently only round-robin
  subProfiles: ResolvedSubProfile[] | LoadBalancerSubProfile[];
  lbProfileEphemeralSettings?: Record<string, unknown>;
}
```

### Current Policy Type (packages/core/src/types/modelParams.ts)
```typescript
export interface LoadBalancerProfile {
  version: 1;
  type: 'loadbalancer';
  policy: 'roundrobin';  // Currently only roundrobin
  profiles: string[];
  // ... other fields
}
```

### Retry Utilities (packages/core/src/utils/retry.ts)
- `retryWithBackoff<T>()` - Existing retry with exponential backoff
- `isNetworkTransientError()` - Detects network transient errors
- `getErrorStatus()` - Extracts HTTP status code
- `createStreamInterruptionError()` - Creates stream interruption errors

---

## PHASE 1: Test Implementation (subagent_type: typescript-coder)

### Subagent Prompt

```
Implement failover policy tests following TDD per dev-docs/RULES.md.

CRITICAL: Write ALL tests FIRST (RED phase). Tests must fail before any production code is written.

### TEST FILES TO CREATE/MODIFY:

#### 1. packages/core/src/types/modelParams.test.ts (ADD)
TESTS:
1. LoadBalancerProfile accepts policy: 'failover'
2. LoadBalancerProfile accepts policy: 'roundrobin' (backward compat)
3. Type discriminator works for both policies

#### 2. packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts (NEW)
TESTS FOR FAILOVER STRATEGY:

**Strategy Selection:**
1. LoadBalancingProviderConfig accepts strategy: 'failover'
2. LoadBalancingProviderConfig accepts strategy: 'round-robin' (backward compat)
3. Constructor throws for invalid strategy value (not 'round-robin' or 'failover')
4. Constructor throws error message that includes both valid strategies

**Sequential Execution on Errors:**
5. Failover strategy calls first backend first
6. On first backend error, calls second backend
7. On second backend error, calls third backend
8. Continues through all backends in order until success
9. Logs each failover attempt with backend name

**Stop-at-First-Success Behavior:**
10. Returns immediately when first backend succeeds
11. Does not call second backend when first succeeds
12. Returns response from successful backend (not from failed ones)
13. Updates stats for successful backend only

**Per-Backend Retry Integration:**
14. Retries same backend failover_retry_count times before failover (uses retryWithBackoff)
15. Uses failover_retry_delay_ms from ephemeral settings
16. Only fails over after retry_count exhausted on current backend
17. Default retry_count is 1 (single attempt, no retries)
18. Default retry_delay_ms is 0 (immediate retry)

**Aggregated Error When All Backends Fail:**
19. Throws LoadBalancerFailoverError when all backends fail
20. Error message includes profile name
21. Error message includes all backend names that failed
22. Error includes array of individual backend errors
23. Does not hang or loop indefinitely

**Ephemeral Settings Extraction:**
24. Extracts failover_retry_count from lbProfileEphemeralSettings (default: 1)
25. Extracts failover_retry_delay_ms from lbProfileEphemeralSettings (default: 0)
26. Extracts failover_on_network_errors from lbProfileEphemeralSettings (default: true)
27. Extracts failover_status_codes from lbProfileEphemeralSettings (default: undefined = all errors)
28. Settings from LB profile override sub-profile settings

**Streaming Behavior:**
29. Awaits first chunk before yielding (to detect early failures)
30. Yields all subsequent chunks from successful backend
31. Mid-stream errors are NOT retried (once we yield, we're committed)
32. Does not duplicate chunks on retry of initial connection

**Edge Cases (CRITICAL):**
33. Throws error when failover profile has only 1 sub-profile (minimum 2 required)
34. Handles retry_count of 0 (no retries, immediate failover)
35. Caps retry_count at 100 even if higher value provided
36. Handles invalid ephemeral settings types gracefully (string "3" for retry_count)
37. Deduplicates identical errors in aggregated error message
38. Handles provider not found mid-failover sequence
39. Handles case-insensitive policy parsing ("FAILOVER", "Failover")
40. Uses shouldFailover to determine if error triggers failover
41. Network errors trigger failover when failover_on_network_errors is true
42. Specific status codes trigger failover when in failover_status_codes array

#### 3. packages/cli/src/ui/commands/__tests__/profileCommand.failover.test.ts (NEW)
TESTS FOR CLI PARSING:

1. /profile save loadbalancer lb-name failover profile1 profile2 - parses policy
2. /profile save loadbalancer lb-name roundrobin profile1 profile2 - parses policy
3. /profile save loadbalancer lb-name profile1 profile2 - defaults to roundrobin
4. /profile save loadbalancer lb-name FAILOVER profile1 profile2 - case insensitive
5. Error message when only 1 profile provided (after policy detection)
6. Saved profile has correct policy field
7. Help text includes policy parameter information

#### 4. packages/cli/src/runtime/__tests__/profileApplication.failover.test.ts (NEW)
TESTS FOR PROFILE APPLICATION:

1. Maps policy: 'failover' to strategy: 'failover'
2. Maps policy: 'roundrobin' to strategy: 'round-robin' (existing behavior)
3. LoadBalancingProvider created with correct strategy from profile
4. Ephemeral settings passed to LoadBalancingProviderConfig.lbProfileEphemeralSettings
5. LoadBalancingProvider registered with providerManager

### TEST PATTERNS TO FOLLOW:

Use existing test patterns from:
- packages/core/src/providers/__tests__/LoadBalancingProvider.test.ts
- packages/cli/src/ui/commands/__tests__/profileCommand.lb.test.ts
- packages/cli/src/runtime/__tests__/profileApplication.lb.test.ts

### CONSTRAINTS:
- No `any` types - use proper TypeScript types
- Test BEHAVIOR, not implementation (no mock.toHaveBeenCalled assertions)
- Use real test doubles, not jest.fn() spy assertions
- All tests MUST fail initially (RED phase)
- Run tests: npm run test -- packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts --run
```

### Phase 1 TDD Verification (MANDATORY)

After writing all tests, run them to verify RED state:

```bash
# Kill any existing vitest instances first
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true

# Run the failover tests
npm run test -- packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts --run 2>&1 | tee /tmp/phase1-red-tests.log

# VERIFY: All tests must FAIL (not pass, not skip)
# Expected output should show failures like:
#   FAIL  packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts
#   ✕ should use failover strategy when configured
#   ✕ should try second backend when first fails
#   ... etc

# If ANY test passes, the test is wrong (test fitting) - fix it before proceeding
if grep -E "^[[:space:]]*(✓|PASS)" /tmp/phase1-red-tests.log | grep -v "0 passed"; then
  echo "ERROR: Tests should not pass yet - test is likely fitting existing code!"
  exit 1
fi

# Verify tests actually ran (not 0 tests)
if grep "0 tests" /tmp/phase1-red-tests.log; then
  echo "ERROR: No tests ran - check test file syntax!"
  exit 1
fi

echo "Phase 1 complete: All tests fail as expected (RED state)"
```

---

## PHASE 2: Implementation (subagent_type: typescript-coder)

### Subagent Prompt

```
Implement failover policy following TDD per dev-docs/RULES.md.

CRITICAL: Write MINIMAL code to make tests pass (GREEN phase). Only implement what tests require.

### FILES TO MODIFY:

#### 1. packages/core/src/types/modelParams.ts

CHANGES:
- Extend LoadBalancerProfile.policy type: 'roundrobin' | 'failover'
- No other changes needed (backward compatible)

```typescript
export interface LoadBalancerProfile {
  version: 1;
  type: 'loadbalancer';
  policy: 'roundrobin' | 'failover';  // CHANGED: added 'failover'
  profiles: string[];
  provider: string;
  model: string;
  modelParams: ModelParams;
  ephemeralSettings: EphemeralSettings;
}
```

#### 2. packages/core/src/providers/LoadBalancingProvider.ts

CHANGES:
- Extend strategy type: 'round-robin' | 'failover'
- Update constructor validation to accept both strategies
- Add failover execution logic in generateChatCompletion
- Integrate with existing retryWithBackoff from retry.ts
- Add streaming-aware failover (await first chunk)

```typescript
export interface LoadBalancingProviderConfig {
  profileName: string;
  strategy: 'round-robin' | 'failover';  // CHANGED: added 'failover'
  subProfiles: ResolvedSubProfile[] | LoadBalancerSubProfile[];
  lbProfileEphemeralSettings?: Record<string, unknown>;
}

// NEW: Add failover settings interface
interface FailoverSettings {
  retryCount: number;
  retryDelayMs: number;
  failoverOnNetworkErrors: boolean;
  failoverStatusCodes: number[] | undefined;
}

// UPDATE: Constructor validation (around line 139)
private validateConfig(config: LoadBalancingProviderConfig): void {
  // ... existing validation ...

  // CHANGE THIS:
  // OLD: if (config.strategy !== 'round-robin') { throw... }
  // NEW:
  if (config.strategy !== 'round-robin' && config.strategy !== 'failover') {
    throw new Error(
      `Invalid strategy "${config.strategy}". Supported: "round-robin", "failover".`
    );
  }

  // ... rest of validation ...
}

// NEW: In generateChatCompletion, branch on strategy
async *generateChatCompletion(...) {
  // ... existing parameter normalization ...

  if (this.config.strategy === 'failover') {
    yield* this.executeWithFailover(options);
  } else {
    // Existing round-robin logic
    const subProfile = this.selectNextSubProfile();
    // ... existing code ...
  }
}

// NEW: Extract failover settings from ephemeral settings
private extractFailoverSettings(): FailoverSettings {
  const ephemeral = this.config.lbProfileEphemeralSettings ?? {};
  return {
    retryCount: Math.min(
      typeof ephemeral.failover_retry_count === 'number' ? ephemeral.failover_retry_count : 1,
      100 // Cap at 100 retries per backend
    ),
    retryDelayMs: typeof ephemeral.failover_retry_delay_ms === 'number'
      ? ephemeral.failover_retry_delay_ms
      : 0, // Default: immediate retry
    failoverOnNetworkErrors: ephemeral.failover_on_network_errors !== false, // Default: true
    failoverStatusCodes: Array.isArray(ephemeral.failover_status_codes)
      ? ephemeral.failover_status_codes.filter((n): n is number => typeof n === 'number')
      : undefined, // undefined = all errors
  };
}

// NEW: Determine if error should trigger failover
private shouldFailover(error: unknown, settings: FailoverSettings): boolean {
  if (!(error instanceof Error)) return true; // Unknown errors trigger failover

  // Network errors
  if (settings.failoverOnNetworkErrors && isNetworkTransientError(error)) {
    return true;
  }

  // HTTP status codes
  const status = getErrorStatus(error);
  if (status !== undefined) {
    if (settings.failoverStatusCodes) {
      return settings.failoverStatusCodes.includes(status);
    }
    // Default: failover on 429 and 5xx
    return status === 429 || (status >= 500 && status < 600);
  }

  // Default: failover on any error
  return true;
}

// NEW: Build resolved options for a sub-profile
private buildResolvedOptions(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  options: GenerateChatOptions
): GenerateChatOptions {
  // Use existing pattern from round-robin implementation
  return {
    ...options,
    resolved: {
      ...options.resolved,
      model: isResolvedSubProfile(subProfile) ? subProfile.model : subProfile.modelId,
      ...(subProfile.baseURL && { baseURL: subProfile.baseURL }),
      ...(subProfile.authToken && { authToken: subProfile.authToken }),
    },
  };
}

// NEW: Update stats for selected backend
private updateStats(subProfileName: string): void {
  this.incrementStats(subProfileName);
}

// NEW: Failover execution with proper streaming error handling
private async *executeWithFailover(options: GenerateChatOptions): AsyncGenerator<IContent> {
  const settings = this.extractFailoverSettings();
  const errors: Array<{profile: string; error: Error}> = [];

  for (const subProfile of this.config.subProfiles) {
    try {
      this.logger.debug(() => `[LB:failover] Trying backend: ${subProfile.name}`);

      // Use retryWithBackoff to wrap the streaming attempt
      // Key insight: we need to await the FIRST chunk inside retry to detect early errors
      // But we can't retry mid-stream errors (once we yield, we're committed)

      const streamResult = await retryWithBackoff(
        async () => {
          const resolvedOptions = this.buildResolvedOptions(subProfile, options);
          const delegateProvider = this.providerManager.getProviderByName(subProfile.providerName);
          if (!delegateProvider) {
            throw new Error(`Provider "${subProfile.providerName}" not found`);
          }

          const iterator = delegateProvider.generateChatCompletion(resolvedOptions);
          const firstResult = await iterator.next();

          // Return both the first chunk and the iterator for continued streaming
          return { firstResult, iterator };
        },
        {
          maxAttempts: Math.max(1, settings.retryCount),
          initialDelayMs: settings.retryDelayMs,
          maxDelayMs: settings.retryDelayMs * 10 || 30000,
          shouldRetryOnError: (error) => this.shouldFailover(error, settings),
        }
      );

      // SUCCESS: Yield first chunk
      if (!streamResult.firstResult.done) {
        yield streamResult.firstResult.value;
      }

      // Yield remaining chunks (mid-stream errors are NOT retried - we're committed)
      for await (const chunk of { [Symbol.asyncIterator]: () => streamResult.iterator }) {
        yield chunk;
      }

      // Update stats for successful backend
      this.updateStats(subProfile.name);
      this.logger.debug(() => `[LB:failover] Success on backend: ${subProfile.name}`);
      return; // Stop at first success

    } catch (error) {
      this.logger.debug(() => `[LB:failover] ${subProfile.name} failed: ${(error as Error).message}`);
      errors.push({ profile: subProfile.name, error: error as Error });
      // Continue to next backend
    }
  }

  // All backends failed
  throw new LoadBalancerFailoverError(this.config.profileName, errors);
}
```

#### 3. packages/core/src/providers/errors.ts

ADD the LoadBalancerFailoverError class:

```typescript
/**
 * Error thrown when all backends in a load balancer failover policy have failed
 */
export class LoadBalancerFailoverError extends Error {
  readonly profileName: string;
  readonly failures: ReadonlyArray<{ readonly profile: string; readonly error: Error }>;

  constructor(
    profileName: string,
    failures: Array<{ profile: string; error: Error }>
  ) {
    const profileNames = failures.map((f) => f.profile).join(', ');
    const errorSummary = failures.length === 1
      ? failures[0].error.message
      : `${failures.length} backends failed`;
    super(`Load balancer "${profileName}" failover exhausted: ${errorSummary} (tried: ${profileNames})`);
    this.name = 'LoadBalancerFailoverError';
    this.profileName = profileName;
    this.failures = failures;
  }
}
```

#### 4. packages/cli/src/ui/commands/profileCommand.ts

CHANGES (COMPLETE replacement of loadbalancer handling in saveCommand.action):

```typescript
// In saveCommand action handler, REPLACE the loadbalancer handling block:
if (profileType === 'loadbalancer') {
  // Parse: /profile save loadbalancer <lb-name> [policy] <profile1> <profile2> ...
  // policy is optional, defaults to 'roundrobin'

  if (parts.length < 4) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /profile save loadbalancer <lb-name> [roundrobin|failover] <profile1> <profile2> [...]',
    };
  }

  const lbProfileName = parts[1];

  // Check if parts[2] is a policy keyword or a profile name (case-insensitive)
  let policy: 'roundrobin' | 'failover' = 'roundrobin';
  let profileStartIndex = 2;

  const possiblePolicy = parts[2]?.toLowerCase();
  if (possiblePolicy === 'failover' || possiblePolicy === 'roundrobin') {
    policy = possiblePolicy as 'roundrobin' | 'failover';
    profileStartIndex = 3;
  }

  const selectedProfiles = parts.slice(profileStartIndex).filter((p) => p.length > 0);

  if (selectedProfiles.length < 2) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Load balancer profile requires at least 2 profiles',
    };
  }

  try {
    const runtime = getRuntimeApi();
    const availableProfiles = await runtime.listSavedProfiles();

    for (const profileName of selectedProfiles) {
      if (!availableProfiles.includes(profileName)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Profile ${profileName} does not exist`,
        };
      }
    }

    // Protected settings that must be stripped when saving LB profiles
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

    const currentEphemerals = runtime.getEphemeralSettings();
    const filteredEphemerals = Object.fromEntries(
      Object.entries(currentEphemerals).filter(
        ([key, value]) =>
          !PROTECTED_SETTINGS.includes(key) &&
          value !== undefined &&
          value !== null,
      ),
    );

    const lbProfile = {
      version: 1 as const,
      type: 'loadbalancer' as const,
      policy,  // Use parsed policy (roundrobin or failover)
      profiles: selectedProfiles,
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: filteredEphemerals,
    };

    await runtime.saveLoadBalancerProfile(lbProfileName, lbProfile);

    return {
      type: 'message',
      messageType: 'info',
      content: `Load balancer profile '${lbProfileName}' saved with ${selectedProfiles.length} profiles (policy: ${policy})`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to save load balancer profile: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

Also UPDATE the help text in profileCommand action (around line 749):

```typescript
content: `Profile management commands:
  /profile save model <name>    - Save current model configuration
  /profile save loadbalancer <lb-name> [roundrobin|failover] <profile1> <profile2> [...]
                                - Save a load balancer profile (default: roundrobin)
  /profile load <name>          - Load a saved profile
  /profile delete <name>        - Delete a saved profile
  /profile set-default <name>   - Set profile to load on startup (or "none")
  /profile list                 - List all saved profiles`,
```

#### 5. packages/cli/src/runtime/profileApplication.ts

CHANGES (around line 252-264):

```typescript
// Build LoadBalancingProviderConfig from resolved sub-profiles
const lbConfig: LoadBalancingProviderConfig = {
  profileName: lbName,
  // Map 'failover' policy to 'failover' strategy, otherwise 'round-robin'
  strategy: profileInput.policy === 'failover' ? 'failover' : 'round-robin',
  subProfiles: resolvedSubProfiles.map(
    (sp): LoadBalancerSubProfile => ({
      name: sp.name,
      providerName: sp.providerName,
      modelId: sp.model,
      baseURL: sp.baseURL,
      authToken: sp.authToken,
    }),
  ),
  // Pass ephemeral settings to LoadBalancingProvider for failover config
  lbProfileEphemeralSettings: profileInput.ephemeralSettings as Record<string, unknown>,
};
```

#### 6. packages/core/src/index.ts

ADD export:
```typescript
export { LoadBalancerFailoverError } from './providers/errors.js';
```

### CONSTRAINTS:
- No `any` types
- Use existing retryWithBackoff from retry.ts
- Use existing isNetworkTransientError, getErrorStatus utilities
- Handle streaming correctly (await first chunk)
- All tests must pass
- Run: npm run test
```

---

## PHASE 3: Verification (subagent_type: typescript-code-reviewer)

### Subagent Prompt

```
Verify failover implementation meets all requirements per dev-docs/RULES.md.

### VERIFICATION CHECKLIST:

#### 1. Requirements from Issue #488:
- [ ] failover is second policy option alongside roundrobin
- [ ] CLI accepts: /profile save loadbalancer profilename [policy] profile1 profile2
- [ ] Default behavior: fail over on ANY error, retry immediately
- [ ] Two-level: per-backend retries + cross-backend failover
- [ ] Configuration via ephemeral settings (failover_retry_count, failover_retry_delay_ms)
- [ ] Stop at first successful backend

#### 2. RULES.md Compliance:
- [ ] TDD followed: tests written FIRST (verify test file timestamps or structure)
- [ ] No mock theater: tests verify behavior, not mock.toHaveBeenCalled
- [ ] No `any` types anywhere
- [ ] Immutability patterns used
- [ ] No premature abstraction
- [ ] Self-documenting code (no comments explaining what code does)
- [ ] Single responsibility
- [ ] Explicit dependencies

#### 3. Full Verification Cycle:
Run these commands in order, all must pass:

```bash
# Kill any existing vitest instances
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true

npm run lint:ci
npm run typecheck
npm run format
npm run build
npm run bundle
```

#### 4. Test Suite:
```bash
# Kill any existing vitest instances
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true

npm run test -- --run

# Kill vitest after tests
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
```

All tests must pass, especially:
- packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts
- packages/cli/src/ui/commands/__tests__/profileCommand.failover.test.ts
- packages/cli/src/runtime/__tests__/profileApplication.failover.test.ts

#### 5. CRITICAL FINAL STEP - Happy Path Test:

Create failover test profile (CORRECT FORMAT with all required fields):
```bash
cat > ~/.llxprt/profiles/syntheticfailover.json << 'EOF'
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["syntheticglm46", "key2syntheticglm"],
  "provider": "",
  "model": "",
  "modelParams": {},
  "ephemeralSettings": {
    "context-limit": 190000,
    "shell-replacement": true
  }
}
EOF
```

Run the exact validation command:
```bash
LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile-load syntheticfailover "look through this code and tell me what it does, do not use a subagent"
```

#### 6. VERIFY Happy Path (Explicit Checks):

```bash
# Save output to log file
LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile-load syntheticfailover "look through this code and tell me what it does, do not use a subagent" 2>&1 | tee /tmp/failover-happy.log

# VERIFY HAPPY PATH:
# 1. First backend used:
grep "Selected sub-profile: syntheticglm46\|Trying backend: syntheticglm46" /tmp/failover-happy.log && echo "PASS: First profile selected" || echo "FAIL: First profile not selected"

# 2. No failover occurred (on happy path):
if grep -i "failover.*failed\|trying next backend\|failed:.*syntheticglm46" /tmp/failover-happy.log; then
  echo "WARNING: Failover occurred - check if first backend is healthy"
else
  echo "PASS: No failover on happy path (first backend succeeded)"
fi

# 3. Strategy is failover:
grep -i "strategy.*failover\|failover.*strategy" /tmp/failover-happy.log && echo "PASS: Failover strategy in use" || echo "INFO: Strategy log may not be visible"

# 4. Response returned (check for model output):
if grep -q "model\|function\|code\|import\|export" /tmp/failover-happy.log; then
  echo "PASS: Response received from backend"
else
  echo "FAIL: No response content detected"
fi
```

#### 7. Failover Behavior Test (Optional - Requires Breaking First Profile):

To verify failover works:
1. Temporarily rename syntheticglm46.json to syntheticglm46.json.bak
2. Run the same command
3. Verify: system fails over to key2syntheticglm
4. Verify: debug logs show failover attempt
5. Restore syntheticglm46.json.bak

```bash
# OPTIONAL: Test failover path
mv ~/.llxprt/profiles/syntheticglm46.json ~/.llxprt/profiles/syntheticglm46.json.bak

LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile-load syntheticfailover "hello" 2>&1 | tee /tmp/failover-actual.log

# Check for failover
grep -i "failed\|trying.*key2syntheticglm\|failover" /tmp/failover-actual.log

# Restore
mv ~/.llxprt/profiles/syntheticglm46.json.bak ~/.llxprt/profiles/syntheticglm46.json
```

### REPORT FORMAT:

Provide structured report:

1. **Requirements Met**: List each requirement and status
2. **RULES.md Violations**: List any violations found
3. **Test Results**: Pass/fail summary
4. **Build Results**: Pass/fail for lint/typecheck/build/bundle
5. **Happy Path Validation**: Did first backend stay selected?
6. **Failover Validation**: Did failover work when first backend failed?
7. **Issues Found**: Any bugs or problems discovered
8. **Ready for PR**: Yes/No with reasoning
```

---

## Files to Modify Summary

| File | Changes |
|------|---------|
| `packages/core/src/types/modelParams.ts` | Extend policy type to include 'failover' |
| `packages/core/src/types/modelParams.test.ts` | Add tests for failover policy type |
| `packages/core/src/providers/LoadBalancingProvider.ts` | Add failover strategy execution, update constructor validation |
| `packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts` | **NEW** - Failover strategy tests |
| `packages/core/src/providers/errors.ts` | Add LoadBalancerFailoverError class |
| `packages/cli/src/ui/commands/profileCommand.ts` | Parse optional policy parameter, update help text |
| `packages/cli/src/ui/commands/__tests__/profileCommand.failover.test.ts` | **NEW** - CLI policy parsing tests |
| `packages/cli/src/runtime/profileApplication.ts` | Map policy to strategy, pass ephemeral settings |
| `packages/cli/src/runtime/__tests__/profileApplication.failover.test.ts` | **NEW** - Profile application tests |
| `packages/core/src/index.ts` | Export LoadBalancerFailoverError |

---

## Ephemeral Settings for Failover

The following ephemeral settings control failover behavior (aligned with issue #488 naming):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `failover_retry_count` | number | 1 | Per-backend retry attempts before failover (max: 100) |
| `failover_retry_delay_ms` | number | 0 | Delay between retries in milliseconds |
| `failover_on_network_errors` | boolean | true | Whether network errors trigger failover |
| `failover_status_codes` | number[] | undefined | Specific HTTP status codes that trigger failover (undefined = 429 + 5xx) |

---

## Success Criteria

1. All tests pass (including new failover tests)
2. `npm run lint:ci` passes with zero warnings
3. `npm run typecheck` passes
4. `npm run build` succeeds
5. `npm run bundle` succeeds
6. Happy path: First backend used when it succeeds
7. Failover path: Second backend used when first fails
8. No `any` types
9. TDD was followed (tests first, then implementation)
10. No mock theater in tests
11. CRITICAL: syntheticfailover.json loads and first backend (syntheticglm46) is used on happy path

---

## Critical Files for Implementation

- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/providers/LoadBalancingProvider.ts` - Core logic: add failover strategy execution, update constructor validation, implement executeWithFailover and helper methods
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/types/modelParams.ts` - Type definitions: extend policy union type from 'roundrobin' to 'roundrobin' | 'failover'
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/providers/errors.ts` - Error class: add LoadBalancerFailoverError alongside existing error classes
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/runtime/profileApplication.ts` - Profile loading: map 'failover' policy to 'failover' strategy, pass ephemeral settings
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/ui/commands/profileCommand.ts` - CLI command: parse optional policy parameter with case-insensitive matching
