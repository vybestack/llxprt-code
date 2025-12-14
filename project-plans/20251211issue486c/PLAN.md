# PLAN-20251211issue486c: Load Balancing Profiles - Correct Implementation

## Issue Reference
GitHub Issue #486 - Load Balancing Profiles

## Problem Statement
The previous implementation (PLAN-20251211issue486b) created a broken design that:
1. Invented a new inline profile format requiring duplicated settings
2. Broke the existing `type: loadbalancer` format
3. Broke `/profile save loadbalancer` workflow
4. Lost ephemeralSettings, context-limit, and other profile settings
5. Made profiles unmaintainable

## Correct Design

### Profile Format (Existing - Must Support)
```json
{
  "version": 1,
  "type": "loadbalancer",
  "policy": "roundrobin",
  "profiles": ["syntheticglm46", "syntheticm2maxstreaming"],
  "ephemeralSettings": {
    "context-limit": 190000
  }
}
```

### Architecture
1. **At profile-load time:**
   - Detect LB profile (`type === "loadbalancer"` AND `profiles` is array of strings)
   - Load each referenced profile by name using ProfileManager
   - Cache their full resolved configs (provider, model, apiKey, baseURL, ephemeralSettings, modelParams, everything)
   - Create LoadBalancingProvider with cached configs
   - Register as "load-balancer" provider

2. **At request time:**
   - Round-robin SELECT which cached config to use
   - Apply dumb merge: `{...subProfileSettings, ...lbProfileEphemeralSettings}`
   - Delegate to appropriate provider with merged settings

3. **Settings Precedence:**
   ```
   CLI flags > LB profile ephemeralSettings > Sub-profile settings > Defaults
   ```

4. **Dumb Merge Algorithm (explicit):**
   ```typescript
   const mergedSettings = {
     ...selectedSubProfile.ephemeralSettings,
     ...lbProfile.ephemeralSettings,
   };
   // Provider, model, apiKey ALWAYS come from selectedSubProfile
   // Only ephemeralSettings merge
   ```

5. **`/profile save loadbalancer` behavior:**
   - Strip protected settings: auth-key, auth-keyfile, base-url, apiKey, apiKeyfile, model, GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION
   - Save everything else from current ephemerals

### Key Files to Modify
- `packages/cli/src/runtime/profileApplication.ts` - Profile loading and LB detection
- `packages/core/src/providers/LoadBalancingProvider.ts` - Round-robin provider
- `packages/cli/src/ui/commands/profileCommand.ts` - `/profile save loadbalancer`

### Key Files for Reference
- `packages/cli/src/runtime/runtimeSettings.ts` - loadProfileByName function
- `packages/cli/src/config/profileManager.ts` - ProfileManager.loadProfile

---

## Type Definitions

### LoadBalancerProfile Type Guard
```typescript
export interface LoadBalancerProfile extends Profile {
  type: 'loadbalancer';
  policy: 'roundrobin';
  profiles: string[]; // Array of profile NAMES
}

export function isLoadBalancerProfileFormat(profile: Profile): profile is LoadBalancerProfile {
  return (
    'type' in profile &&
    profile.type === 'loadbalancer' &&
    'profiles' in profile &&
    Array.isArray(profile.profiles) &&
    profile.profiles.every(p => typeof p === 'string')
  );
}
```

### ResolvedSubProfile (Full Profile Config)
```typescript
export interface ResolvedSubProfile {
  name: string;                    // Profile name for logging
  providerName: string;            // e.g., "openai", "anthropic"
  model: string;                   // e.g., "gpt-4", "claude-3"
  baseURL?: string;                // API endpoint
  authToken?: string;              // Resolved API key
  authKeyfile?: string;            // Path to keyfile (if applicable)
  ephemeralSettings: Record<string, unknown>;  // Full ephemeral settings
  modelParams: Record<string, unknown>;        // Temperature, max_tokens, etc.
}
```

---

## Implementation Phases

### Phase 1: Type Definitions and Interfaces

**Tests (separate subagent invocation):**
- Test `isLoadBalancerProfileFormat` type guard correctly identifies LB profiles
- Test it rejects non-LB profiles (standard profiles, inline format)
- Test ResolvedSubProfile captures all necessary settings

**Implementation (separate subagent invocation):**
- Add `LoadBalancerProfile` interface
- Add `isLoadBalancerProfileFormat` type guard
- Expand `ResolvedSubProfile` to hold full profile config
- Update `LoadBalancingProviderConfig` to use `ResolvedSubProfile[]`

**Verification (separate subagent invocation):**
Run tests, verify compilation.

---

### Phase 2: Profile Detection for `type: loadbalancer`

**Tests (separate subagent invocation):**
- Test profileApplication detects `{type: "loadbalancer", profiles: [...]}` format
- Test it loads sub-profiles using ProfileManager
- Test error when referenced profile doesn't exist (fail-fast)
- Test error when circular reference detected (if A references LB-B which references A)
- Test full config extraction from loaded profiles

**Implementation (separate subagent invocation):**
Modify `profileApplication.ts` to:
1. Import/instantiate ProfileManager (use `new ProfileManager()`)
2. Check `isLoadBalancerProfileFormat(profile)` BEFORE checking 486b inline format
3. For each profile name in `profiles` array:
   - Call `profileManager.loadProfile(name)`
   - Extract provider, model, apiKey, baseURL, ephemeralSettings, modelParams
   - Build ResolvedSubProfile
4. Create LoadBalancingProvider with resolved configs
5. Register as "load-balancer" provider

**Verification (separate subagent invocation):**
Run tests, verify they pass.

---

### Phase 3: Round-Robin with Settings Merge

**Tests (separate subagent invocation):**
- Test round-robin cycles through sub-profiles on each request
- Test sub-profile's provider, model, apiKey are used (not overridden)
- Test LB profile ephemeralSettings override sub-profile ephemeralSettings
- Test modelParams from sub-profile are preserved
- Test different sub-profiles have isolated auth (correct API key per request)

**Implementation (separate subagent invocation):**
Modify `LoadBalancingProvider.generateChatCompletion`:
1. Round-robin select next ResolvedSubProfile
2. Build merged options:
   ```typescript
   const mergedEphemerals = {
     ...selectedSubProfile.ephemeralSettings,
     ...this.lbProfileEphemeralSettings,  // LB overrides
   };
   ```
3. Set `options.resolved` with sub-profile's provider settings:
   - `model`: from sub-profile
   - `baseURL`: from sub-profile
   - `authToken`: from sub-profile
4. Apply merged ephemeralSettings to the request
5. Delegate to provider

**Verification (separate subagent invocation):**
Run tests, verify they pass.

---

### Phase 4: /profile save loadbalancer Protection

**Tests (separate subagent invocation):**
- Test `/profile save loadbalancer name prof1 prof2` saves profile
- Test protected settings are STRIPPED: auth-key, auth-keyfile, base-url, apiKey, apiKeyfile, model, GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION
- Test non-protected settings are saved: context-limit, streaming, tool-format, etc.
- Test profile names array is saved correctly

**Implementation (separate subagent invocation):**
Modify `profileCommand.ts`:
```typescript
const PROTECTED_SETTINGS = [
  'auth-key',
  'auth-keyfile',
  'base-url',
  'apiKey',
  'apiKeyfile',
  'model',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
];

// When saving LB profile, filter out protected settings
const filteredEphemerals = Object.fromEntries(
  Object.entries(currentEphemerals)
    .filter(([key]) => !PROTECTED_SETTINGS.includes(key))
);
```

**Verification (separate subagent invocation):**
Run tests, verify they pass.

---

### Phase 5: Remove 486b Inline Format Code

**Tests (separate subagent invocation):**
- Verify all existing LB tests still pass
- Verify inline format `{loadBalancer: {subProfiles: [...]}}` is NO LONGER supported (should be ignored or error)

**Implementation (separate subagent invocation):**
Remove the 486b inline format detection code from `profileApplication.ts`:
- Remove check for `loadBalancer.subProfiles`
- Remove inline config building
- Keep ONLY `type: loadbalancer` format support

**Verification (separate subagent invocation):**
Run tests, verify they pass.

---

### Phase 6: CI-Aligned Verification

**Verification (separate subagent invocation):**
Run full CI checks:
```bash
npm run lint:ci
npm run typecheck
npm run format
npm run build
npm run bundle
```

---

### Phase 7: Final Integration Test (MANDATORY - DO NOT SKIP OR SIMPLIFY)

**Verification (separate subagent invocation):**

This step MUST run the EXACT command below. DO NOT change to a simpler prompt.

**Pre-checks:**
1. Verify `~/.llxprt/profiles/syntheticlb.json` exists and has format:
   ```json
   {
     "type": "loadbalancer",
     "policy": "roundrobin",
     "profiles": ["synthetic-key1-profile", "synthetic-key2-profile"]
   }
   ```
   (or similar - must be `type: loadbalancer` with `profiles` array)

2. If syntheticlb doesn't exist or is wrong format, create valid sub-profiles first

3. Clear debug logs: `rm -rf ~/.llxprt/debug/*.log ~/.llxprt/debug/*.jsonl`

**Run the EXACT command:**
```bash
LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile-load syntheticlb "analyze this codebase and tell me what it does do not use a subagent"
```

**Verify in debug logs (`~/.llxprt/debug/*.jsonl`):**
1. Multiple `Selected sub-profile:` entries showing DIFFERENT sub-profiles
2. At least 2 different sub-profile names appear across the session
3. Each request uses the correct authToken for its sub-profile (check prefix matches expected)

**Success Criteria:**
- Debug logs show at least 2 DIFFERENT sub-profiles selected during the multi-turn conversation
- The prompt completes without error
- Round-robin selection is happening per-request, NOT just once at startup

**Failure Criteria (implementation is WRONG if any of these):**
- Only ONE sub-profile is ever selected
- Auth errors occur
- Wrong API key used for a sub-profile

---

## Subagent Prompt Requirements

All subagent prompts MUST include:

```
REQUIREMENTS:
1. Follow dev-docs/RULES.md strictly - TDD is mandatory
2. Write correct, production-ready code
3. Actually implement the functionality - no placeholder implementations
4. NO TODO comments
5. NO HACK comments
6. NO STUB implementations
7. NO "will be implemented later" code
8. All code must compile (npm run typecheck)
9. All code must pass lint (npm run lint)
10. All tests must pass
11. Use proper TypeScript types - no `any`
12. Use the project's DebugLogger, NOT console.log
13. Before running vitest, kill any existing vitest processes: ps -ef | grep vitest | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
```

---

## Test File Locations

- `packages/core/src/providers/__tests__/LoadBalancingProvider.test.ts`
- `packages/cli/src/runtime/__tests__/profileApplication.lb.test.ts`
- `packages/cli/src/ui/commands/__tests__/profileCommand.lb.test.ts` (new if needed)

---

## ProfileManager Access

In `profileApplication.ts`, get ProfileManager via:
```typescript
import { ProfileManager } from '../config/profileManager.js';
// ...
const profileManager = new ProfileManager();
const subProfile = await profileManager.loadProfile(profileName);
```

---

## Error Handling

1. **Missing sub-profile:** Fail-fast with clear error message
   ```
   Error: Load balancer profile "myLB" references profile "nonexistent" which does not exist
   ```

2. **Circular reference:** ProfileManager already handles this - let it throw

3. **Auth failure on one sub-profile:** Let the provider error propagate (don't skip to next)

---

## Definition of Done

1. All tests pass
2. `npm run lint:ci` passes (zero warnings)
3. `npm run typecheck` passes
4. `npm run build` succeeds
5. `npm run bundle` succeeds
6. Phase 7 integration test passes - debug logs show multiple DIFFERENT sub-profiles selected
7. Old format `{type: "loadbalancer", profiles: [...]}` works
8. `/profile save loadbalancer` strips protected settings
9. EphemeralSettings from LB profile override sub-profile settings (dumb merge)
10. Each sub-profile uses its own auth credentials
