# Load Balancing Profiles - Corrected Implementation Plan

**Issue**: #486
**Branch**: issue486
**Date**: 2025-12-11
**Status**: Planning

## Problem Statement

The initial implementation of Load Balancing Profiles (commit 09aa9e5d1) was architecturally flawed. Round-robin selection happened at **profile load time** (in `applyProfileWithGuards`), not at **request time**. This meant:

1. When `--profile-load syntheticlb` was used, a single sub-profile was selected ONCE
2. ALL subsequent LLM requests went to that same profile
3. No actual load balancing occurred during the session

## Correct Behavior

**"Per request" means every Client→Server LLM call**, including:
- Initial user prompt response
- Tool call responses (function calling results)
- Multi-turn conversation continuations
- Any call to `provider.generateChatCompletion()`

Each of these calls should cycle through sub-profiles in round-robin fashion.

## Architecture

### Key Insight: `GenerateChatOptions.resolved`

The `resolved` field in `GenerateChatOptions` takes **highest precedence** in BaseProvider:

```typescript
// packages/core/src/providers/BaseProvider.ts:215-240
protected getBaseURL(): string | undefined {
  const activeOptions = this.activeCallContext.getStore();
  if (activeOptions) {
    return activeOptions.resolved.baseURL;  // HIGHEST PRIORITY
  }
  // ...fallback chain
}
```

This allows a `LoadBalancingProvider` to delegate to any provider while overriding model/baseURL/authToken per-request.

### Solution: `LoadBalancingProvider implements IProvider`

A new provider that:
1. Wraps multiple provider configurations (sub-profiles)
2. On each `generateChatCompletion()` call, selects next sub-profile via round-robin
3. Delegates to the appropriate provider with `resolved` containing the sub-profile's settings
4. Tracks stats (request count per sub-profile)

### Request Flow

```
User Input
    ↓
Turn.run()
    ↓
GeminiChat.sendMessageStream()
    ↓
LoadBalancingProvider.generateChatCompletion()  ← Round-robin selection HERE
    ↓
Delegate to actual provider (Gemini/OpenAI/Anthropic) with resolved={baseURL, authToken, model}
    ↓
LLM API Call
```

## Implementation Phases

### Phase 1: LoadBalancingProvider Skeleton (TDD)

**Test File**: `packages/core/src/providers/__tests__/LoadBalancingProvider.test.ts`

Write tests FIRST:
```typescript
describe('LoadBalancingProvider', () => {
  it('should implement IProvider interface', () => {});
  it('should accept array of sub-profile configurations', () => {});
  it('should expose provider name as "load-balancer"', () => {});
});
```

**Implementation File**: `packages/core/src/providers/LoadBalancingProvider.ts`

```typescript
export interface LoadBalancerSubProfile {
  name: string;
  providerName: string;
  modelId?: string;
  baseURL?: string;
  authToken?: string;
}

export interface LoadBalancingProviderConfig {
  profileName: string;
  strategy: 'round-robin'; // Future: 'weighted', 'random', 'least-connections'
  subProfiles: LoadBalancerSubProfile[];
}

export class LoadBalancingProvider implements IProvider {
  readonly name = 'load-balancer';
  private config: LoadBalancingProviderConfig;
  private providerManager: ProviderManager;

  constructor(config: LoadBalancingProviderConfig, providerManager: ProviderManager) {
    this.config = config;
    this.providerManager = providerManager;
  }

  // Stub methods initially
}
```

### Phase 2: Round-Robin Selection Logic (TDD)

**Tests**:
```typescript
describe('round-robin selection', () => {
  it('should select first sub-profile on first request', () => {});
  it('should cycle through sub-profiles in order', () => {});
  it('should wrap around after last sub-profile', () => {});
  it('should maintain counter across multiple generateChatCompletion calls', () => {});
});
```

**Implementation**:
```typescript
private roundRobinIndex = 0;

private selectNextSubProfile(): LoadBalancerSubProfile {
  const subProfile = this.config.subProfiles[this.roundRobinIndex];
  this.roundRobinIndex = (this.roundRobinIndex + 1) % this.config.subProfiles.length;
  return subProfile;
}
```

### Phase 3: Request Delegation (TDD)

**Tests**:
```typescript
describe('request delegation', () => {
  it('should delegate to correct provider based on sub-profile', () => {});
  it('should pass resolved settings (baseURL, authToken, model) to delegate', () => {});
  it('should handle sub-profiles with different provider types', () => {});
  it('should propagate streaming responses correctly', () => {});
});
```

**Implementation**:
```typescript
async *generateChatCompletion(
  messages: Message[],
  options: GenerateChatOptions
): AsyncGenerator<ChatCompletionChunk> {
  const subProfile = this.selectNextSubProfile();

  // Get the delegate provider
  const delegateProvider = this.providerManager.getProvider(subProfile.providerName);
  if (!delegateProvider) {
    throw new Error(`Provider ${subProfile.providerName} not found for sub-profile ${subProfile.name}`);
  }

  // Override options with sub-profile settings via resolved
  const resolvedOptions: GenerateChatOptions = {
    ...options,
    resolved: {
      baseURL: subProfile.baseURL ?? options.resolved?.baseURL,
      authToken: subProfile.authToken ?? options.resolved?.authToken,
      model: subProfile.modelId ?? options.resolved?.model,
    },
  };

  // Track stats
  this.incrementStats(subProfile.name);

  // Delegate
  yield* delegateProvider.generateChatCompletion(messages, resolvedOptions);
}
```

### Phase 4: Profile Loading Integration

**Test File**: `packages/cli/src/runtime/__tests__/profileApplication.lb.test.ts`

**Tests**:
```typescript
describe('load balancer profile loading', () => {
  it('should detect LB profile by presence of subProfiles array', () => {});
  it('should create LoadBalancingProvider when LB profile loaded', () => {});
  it('should register LoadBalancingProvider with ProviderManager', () => {});
  it('should set LoadBalancingProvider as active provider', () => {});
});
```

**Implementation** in `profileApplication.ts`:
```typescript
// In applyProfileWithGuards or profile loading logic
if (profile.loadBalancer?.subProfiles && profile.loadBalancer.subProfiles.length > 0) {
  // This is a load-balancing profile
  const lbConfig: LoadBalancingProviderConfig = {
    profileName: profileKey,
    strategy: profile.loadBalancer.strategy || 'round-robin',
    subProfiles: profile.loadBalancer.subProfiles.map(sp => ({
      name: sp.name,
      providerName: sp.provider,
      modelId: sp.model,
      baseURL: sp.baseURL,
      authToken: sp.apiKey, // Resolved from profile or env
    })),
  };

  const lbProvider = new LoadBalancingProvider(lbConfig, providerManager);
  providerManager.registerProvider('load-balancer', lbProvider);
  providerManager.switchProvider('load-balancer');
}
```

### Phase 5: Stats Integration

**Tests**:
```typescript
describe('stats tracking', () => {
  it('should track request count per sub-profile', () => {});
  it('should expose stats via getStats() method', () => {});
  it('should report last selected sub-profile', () => {});
  it('should calculate percentage distribution', () => {});
});
```

**Implementation**:
```typescript
// In LoadBalancingProvider
private stats: Map<string, number> = new Map();
private lastSelected: string | null = null;

private incrementStats(subProfileName: string): void {
  this.stats.set(subProfileName, (this.stats.get(subProfileName) || 0) + 1);
  this.lastSelected = subProfileName;
}

getStats(): LoadBalancerStats {
  const profileCounts: Record<string, number> = {};
  let totalRequests = 0;
  for (const [name, count] of this.stats) {
    profileCounts[name] = count;
    totalRequests += count;
  }
  return {
    profileName: this.config.profileName,
    lastSelected: this.lastSelected,
    totalRequests,
    profileCounts,
  };
}
```

Update `diagnosticsCommand.ts` to fetch stats from `LoadBalancingProvider` instance.

### Phase 6: Remove Old LB Resolution Code

Remove or refactor:
- `packages/core/src/config/loadBalancerResolver.ts` - Move stats logic to LoadBalancingProvider
- Profile resolution in `applyProfileWithGuards` that was doing resolution at load time

Keep:
- Types from loadBalancerResolver.ts (move to types file)
- ProfileManager (still useful for profile CRUD)

### Phase 7: Export from Core Index

Update `packages/core/src/index.ts`:
```typescript
export { LoadBalancingProvider, type LoadBalancingProviderConfig, type LoadBalancerSubProfile } from './providers/LoadBalancingProvider.js';
```

### Phase 8: Integration Test (REQUIRED - Not Optional)

**This phase MUST be executed by the implementing subagent before declaring success.**

**Step 1: Clear debug logs**
```bash
rm -f ~/.llxprt/debug/*.log
```

**Step 2: Run CLI with debug enabled using a prompt that triggers multiple tool calls**
```bash
cd /Users/acoliver/projects/llxprt-code-branches/llxprt-code-2
LLXPRT_DEBUG=1 node scripts/start.js --profile-load syntheticlb "analyze this codebase and tell me what it does
do not use a subagent"
```

This prompt will trigger many tool calls (file reads, greps, etc.) and each tool response requires a separate `generateChatCompletion` call - exercising the load balancer multiple times in a single conversation.

**Step 3: Analyze debug logs**
```bash
grep -r "load-balancer\|sub-profile\|round-robin" ~/.llxprt/debug/*.log
```

**Expected output pattern** (sub-profiles should alternate):
```
[load-balancer] Selected sub-profile: gemini-flash for request #1
[load-balancer] Selected sub-profile: gemini-pro for request #2
[load-balancer] Selected sub-profile: gemini-flash for request #3
```

**Verification criteria**:
1. Each `--prompt` should trigger AT LEAST one `generateChatCompletion` call
2. Sub-profiles should cycle in round-robin order
3. If a prompt triggers tool calls, EACH tool response should also show a sub-profile selection
4. Stats in `/diagnostics` should show requests distributed across sub-profiles

**FAIL CONDITIONS** (implementation is NOT complete if any occur):
- All requests go to the same sub-profile
- Debug logs show no sub-profile selection
- Stats show 100% to one profile

## Files to Create/Modify

### Create
- `packages/core/src/providers/LoadBalancingProvider.ts`
- `packages/core/src/providers/__tests__/LoadBalancingProvider.test.ts`
- `packages/cli/src/runtime/__tests__/profileApplication.lb.test.ts`

### Modify
- `packages/core/src/index.ts` - Add exports
- `packages/cli/src/runtime/profileApplication.ts` - LB profile detection and provider creation
- `packages/cli/src/ui/commands/diagnosticsCommand.ts` - Fetch stats from LB provider

### Potentially Remove/Refactor
- `packages/core/src/config/loadBalancerResolver.ts` - Consolidate into LoadBalancingProvider

## Subagent Workflow

1. **Test Subagent** (typescript-coder): Write tests for each phase
2. **Implementation Subagent** (typescript-coder): Implement to pass tests
3. **Review Subagent** (typescript-code-reviewer): Verify implementation quality
4. **Repeat** for each phase

## Success Criteria

1. All unit tests pass
2. Integration test shows round-robin across multiple prompts
3. Debug logs confirm per-request selection (not per-profile-load)
4. `npm run lint:ci && npm run typecheck && npm run build` all pass
5. Diagnostics command shows accurate stats after multiple requests
