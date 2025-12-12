# Load Balancing Profiles - Phase 1: Round Robin

**Issue**: #486
**Related**: #485 (design), #488 (failover/429 handling - separate)
**Date**: 2025-12-11

## Scope

Phase 1 implements round-robin load balancing across multiple saved profiles. Out of scope:
- Failover on 429 (issue #488)
- Weighted round-robin
- Nested LB profiles (error if LB profile references another LB profile)
- State persistence (in-memory counter only)

## Subagent Workflow

Each phase follows this pattern:
1. **IMPLEMENT** (`typescript-coder`): Write tests first (RED), then minimal implementation (GREEN)
2. **VERIFY** (`typescript-code-reviewer`): Check RULES.md compliance, no `any`, no stubs, tests pass

## Architecture

### Profile Type Extension

```typescript
// packages/core/src/types/modelParams.ts

// Rename existing Profile to StandardProfile
export interface StandardProfile {
  version: 1;
  type?: 'standard';  // Optional for backward compat
  provider: string;
  model: string;
  modelParams: ModelParams;
  ephemeralSettings: EphemeralSettings;
}

export interface LoadBalancerProfile {
  version: 1;
  type: 'loadbalancer';
  policy: 'roundrobin';  // Phase 1 only supports roundrobin
  profiles: string[];    // Names of StandardProfiles to balance across
}

// Union type for loading
export type Profile = StandardProfile | LoadBalancerProfile;

// Type guard
export function isLoadBalancerProfile(p: Profile): p is LoadBalancerProfile {
  return 'type' in p && p.type === 'loadbalancer';
}
```

### Profile Resolution

```typescript
// packages/core/src/config/loadBalancerResolver.ts

export class LoadBalancerResolver {
  private counters: Map<string, number> = new Map();

  resolveProfile(lbProfile: LoadBalancerProfile, profileName: string): string {
    const count = this.counters.get(profileName) ?? 0;
    const selectedIndex = count % lbProfile.profiles.length;
    this.counters.set(profileName, count + 1);
    return lbProfile.profiles[selectedIndex];
  }

  resetCounter(profileName: string): void {
    this.counters.delete(profileName);
  }
}
```

---

## Phase 1: Types and Type Guards

### 1A. IMPLEMENT (typescript-coder)

**Prompt**:
```
Implement load balancer profile types following TDD per dev-docs/RULES.md.

TASK: Add StandardProfile, LoadBalancerProfile types and type guards to packages/core/src/types/modelParams.ts

TEST FILE: Create packages/core/src/types/modelParams.test.ts

TESTS TO WRITE FIRST:
1. isLoadBalancerProfile returns false for profile without type field (backward compat)
2. isLoadBalancerProfile returns false for profile with type: 'standard'
3. isLoadBalancerProfile returns true for profile with type: 'loadbalancer'
4. isStandardProfile returns true for profile without type field
5. isStandardProfile returns true for profile with type: 'standard'
6. isStandardProfile returns false for profile with type: 'loadbalancer'

IMPLEMENTATION:
- Keep existing Profile interface, rename conceptually to StandardProfile
- Add type?: 'standard' | 'loadbalancer' to Profile (optional for backward compat)
- Add LoadBalancerProfile interface with: version: 1, type: 'loadbalancer', policy: 'roundrobin', profiles: string[]
- Add type guards: isLoadBalancerProfile(), isStandardProfile()
- Export from packages/core/src/index.ts

CONSTRAINTS:
- No `any` types
- Tests must fail first (RED), then pass (GREEN)
- Run: npm run test -- packages/core/src/types/modelParams.test.ts
```

### 1B. VERIFY (typescript-code-reviewer)

**Prompt**:
```
Review Phase 1 implementation for RULES.md compliance.

CHECK:
1. Tests written BEFORE implementation (verify git history or test structure)
2. No `any` types in modelParams.ts or modelParams.test.ts
3. No stub implementations or TODO comments
4. Type guards use proper type predicates (`: p is LoadBalancerProfile`)
5. All tests pass: npm run test -- packages/core/src/types/modelParams.test.ts
6. No lint errors: npm run lint
7. Types exported from packages/core/src/index.ts
8. Backward compatibility: existing profiles without `type` field work

REPORT: List any violations found. If clean, confirm ready for Phase 2.
```

---

## Phase 2: LoadBalancerResolver Core Logic

### 2A. IMPLEMENT (typescript-coder)

**Prompt**:
```
Implement LoadBalancerResolver following TDD per dev-docs/RULES.md.

TASK: Create packages/core/src/config/loadBalancerResolver.ts

TEST FILE: Create packages/core/src/config/loadBalancerResolver.test.ts

TESTS TO WRITE FIRST:
1. resolveProfile returns first profile on first call
2. resolveProfile cycles through profiles in order (a, b, c, a, b, c...)
3. resolveProfile maintains separate counters per LB profile name
4. resetCounter resets counter for specific profile name
5. resolveProfile handles single-profile LB (always returns same profile)

IMPLEMENTATION:
- Class LoadBalancerResolver with private counters: Map<string, number>
- resolveProfile(lbProfile: LoadBalancerProfile, profileName: string): string
- resetCounter(profileName: string): void
- Use modulo arithmetic for round robin
- Export from packages/core/src/index.ts

CONSTRAINTS:
- No `any` types
- Pure logic, no file I/O
- Immutable where possible
- Run: npm run test -- packages/core/src/config/loadBalancerResolver.test.ts
```

### 2B. VERIFY (typescript-code-reviewer)

**Prompt**:
```
Review Phase 2 LoadBalancerResolver implementation for RULES.md compliance.

CHECK:
1. Tests written BEFORE implementation
2. No `any` types
3. No mutation of input parameters
4. Counter logic is correct (modulo arithmetic)
5. Separate counters per profile name verified by test
6. All tests pass: npm run test -- packages/core/src/config/loadBalancerResolver.test.ts
7. No lint errors: npm run lint
8. Exported from packages/core/src/index.ts

REPORT: List any violations found. If clean, confirm ready for Phase 3.
```

---

## Phase 3: ProfileManager LB Profile Loading

### 3A. IMPLEMENT (typescript-coder)

**Prompt**:
```
Implement LB profile loading in ProfileManager following TDD per dev-docs/RULES.md.

TASK: Modify packages/core/src/config/profileManager.ts to handle LB profiles

TEST FILE: Add to packages/core/src/config/profileManager.test.ts

TESTS TO WRITE FIRST:
1. loadProfile returns LB profile when file has type: 'loadbalancer'
2. loadProfile rejects LB profile with empty profiles array
3. loadProfile rejects LB profile referencing non-existent profile
4. loadProfile rejects LB profile referencing another LB profile (no nesting)
5. loadProfile still works for standard profiles (backward compat)

IMPLEMENTATION:
- Modify loadProfile() to detect LB profiles via isLoadBalancerProfile()
- Add validation: profiles array not empty
- Add validation: all referenced profiles exist (call listProfiles())
- Add validation: referenced profiles are not LB profiles themselves
- Return appropriate error messages for each validation failure

CONSTRAINTS:
- No `any` types
- Validation errors must be descriptive
- Run: npm run test -- packages/core/src/config/profileManager.test.ts
```

### 3B. VERIFY (typescript-code-reviewer)

**Prompt**:
```
Review Phase 3 ProfileManager LB loading implementation for RULES.md compliance.

CHECK:
1. Tests written BEFORE implementation
2. No `any` types
3. All validation cases covered with descriptive errors
4. Backward compatibility with existing standard profiles
5. Nested LB profile detection works correctly
6. All tests pass: npm run test -- packages/core/src/config/profileManager.test.ts
7. No lint errors: npm run lint
8. Error messages are user-friendly

REPORT: List any violations found. If clean, confirm ready for Phase 4.
```

---

## Phase 4: ProfileManager LB Profile Saving

### 4A. IMPLEMENT (typescript-coder)

**Prompt**:
```
Implement LB profile saving in ProfileManager following TDD per dev-docs/RULES.md.

TASK: Add saveLoadBalancerProfile() to packages/core/src/config/profileManager.ts

TEST FILE: Add to packages/core/src/config/profileManager.test.ts

TESTS TO WRITE FIRST:
1. saveLoadBalancerProfile saves valid LB profile to file
2. saveLoadBalancerProfile rejects if member profile doesn't exist
3. saveLoadBalancerProfile rejects if member profile is an LB profile
4. saveLoadBalancerProfile rejects empty profiles array
5. Saved LB profile can be loaded back correctly

IMPLEMENTATION:
- Add saveLoadBalancerProfile(name: string, profile: LoadBalancerProfile): Promise<void>
- Validate all member profiles exist before saving
- Validate no member profiles are LB profiles
- Write JSON to ~/.llxprt/profiles/{name}.json
- Export from packages/core/src/index.ts if needed

CONSTRAINTS:
- No `any` types
- Reuse validation logic from loadProfile where possible
- Run: npm run test -- packages/core/src/config/profileManager.test.ts
```

### 4B. VERIFY (typescript-code-reviewer)

**Prompt**:
```
Review Phase 4 ProfileManager LB saving implementation for RULES.md compliance.

CHECK:
1. Tests written BEFORE implementation
2. No `any` types
3. Validation happens BEFORE writing to disk
4. Same validation rules as loadProfile (DRY principle)
5. File written to correct location
6. All tests pass: npm run test -- packages/core/src/config/profileManager.test.ts
7. No lint errors: npm run lint
8. Round-trip test (save then load) passes

REPORT: List any violations found. If clean, confirm ready for Phase 5.
```

---

## Phase 5: CLI `/profile save loadbalancer` Command

### 5A. IMPLEMENT (typescript-coder)

**Prompt**:
```
Implement /profile save loadbalancer command following TDD per dev-docs/RULES.md.

TASK: Modify packages/cli/src/ui/commands/profileCommand.ts

TEST FILE: Add to packages/cli/src/ui/commands/profileCommand.test.ts

TESTS TO WRITE FIRST:
1. /profile save shows type selection (model/loadbalancer)
2. Selecting 'loadbalancer' prompts for profile name
3. Profile selection shows only standard profiles (filters out LB profiles)
4. Requires at least 2 profiles to be selected
5. Saves LB profile with correct structure via profileManager

IMPLEMENTATION:
- Modify saveCommand to prompt: "What type of profile? (model/loadbalancer)"
- If loadbalancer:
  - Prompt for LB profile name
  - Show checkbox list of available standard profiles
  - Filter out any existing LB profiles from selection
  - Require minimum 2 profiles selected
  - Call profileManager.saveLoadBalancerProfile()
- Success message: "Load balancer profile '{name}' saved with {n} profiles"

CONSTRAINTS:
- No `any` types
- Use existing inquirer patterns from profileCommand.ts
- Run: npm run test -- packages/cli/src/ui/commands/profileCommand.test.ts
```

### 5B. VERIFY (typescript-code-reviewer)

**Prompt**:
```
Review Phase 5 CLI command implementation for RULES.md compliance.

CHECK:
1. Tests written BEFORE implementation
2. No `any` types
3. User prompts are clear and consistent with existing UI
4. LB profiles filtered from selection list
5. Minimum 2 profiles validation with helpful error
6. All tests pass: npm run test -- packages/cli/src/ui/commands/profileCommand.test.ts
7. No lint errors: npm run lint
8. Success/error messages are user-friendly

REPORT: List any violations found. If clean, confirm ready for Phase 6.
```

---

## Phase 6: Profile Application with LB Resolution

### 6A. IMPLEMENT (typescript-coder)

**Prompt**:
```
Integrate LoadBalancerResolver into profile application following TDD per dev-docs/RULES.md.

TASK: Modify packages/cli/src/runtime/profileApplication.ts

TEST FILE: Add to packages/cli/src/runtime/profileApplication.test.ts

TESTS TO WRITE FIRST:
1. applyProfileWithGuards resolves LB profile to standard profile
2. applyProfileWithGuards uses round robin across multiple calls
3. applyProfileWithGuards passes resolved standard profile to provider
4. applyProfileWithGuards logs which profile was selected from LB
5. Standard profiles still work unchanged (backward compat)

IMPLEMENTATION:
- Create singleton LoadBalancerResolver instance (or inject via context)
- In applyProfileWithGuards, check if profile is LB via isLoadBalancerProfile()
- If LB: resolve to standard profile name, load that profile, apply it
- Log: "Load balancer '{lbName}' selected profile '{resolvedName}'"
- Use debug logger (llxprt:loadbalancer category)

CONSTRAINTS:
- No `any` types
- Resolver must be reusable across session (maintains counter)
- Run: npm run test -- packages/cli/src/runtime/profileApplication.test.ts
```

### 6B. VERIFY (typescript-code-reviewer)

**Prompt**:
```
Review Phase 6 profile application integration for RULES.md compliance.

CHECK:
1. Tests written BEFORE implementation
2. No `any` types
3. Resolver instance properly managed (singleton or injected)
4. Round robin counter persists across calls within session
5. Debug logging uses proper logger (not console.log)
6. Backward compatibility with standard profiles
7. All tests pass: npm run test -- packages/cli/src/runtime/profileApplication.test.ts
8. No lint errors: npm run lint

REPORT: List any violations found. If clean, confirm ready for Phase 7.
```

---

## Phase 7: Integration Test and Acceptance Testing

### 7A. IMPLEMENT (typescript-coder)

**Prompt**:
```
Create integration test for load balancing following TDD per dev-docs/RULES.md.

TASK: Create packages/cli/src/integration-tests/loadbalancer.integration.test.ts

TESTS TO WRITE:
1. CLI accepts LB profile via --profile-load
2. CLI accepts inline LB profile via --profile with JSON
3. Round robin alternates between profiles (verify via debug logs)

IMPLEMENTATION:
- Use existing integration test patterns from cli-args.integration.test.ts
- Create temp LB profile JSON pointing to test profiles
- Run CLI with --profile-load or --profile
- Verify no errors, successful completion
- Check debug logs for profile selection

ALSO RUN ACCEPTANCE TESTS manually:
- Scenario 1: synthetic / key2syntheticglm with "write me a haiku"
- Scenario 2: synthetic / chutes with "write me a haiku"
- Scenario 3: syntheticm2maxstreaming / synthetick2streaming with "write me a haiku"
- Scenario 4: synthetick2 / synthetick2streaming with "write me a haiku"

Command pattern:
LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile-load <lb-profile> --prompt "write me a haiku"

CONSTRAINTS:
- Integration test must work in CI (use OPENAI_API_KEY)
- No `any` types
```

### 7B. VERIFY (typescript-code-reviewer)

**Prompt**:
```
Final review of complete load balancer implementation for RULES.md compliance.

FULL VERIFICATION:
1. Run full test suite: npm run test
2. Run lint: npm run lint
3. Run typecheck: npm run typecheck
4. Run build: npm run build
5. Run bundle: npm run bundle

CHECK ALL FILES:
- packages/core/src/types/modelParams.ts
- packages/core/src/types/modelParams.test.ts
- packages/core/src/config/loadBalancerResolver.ts
- packages/core/src/config/loadBalancerResolver.test.ts
- packages/core/src/config/profileManager.ts
- packages/core/src/config/profileManager.test.ts
- packages/cli/src/ui/commands/profileCommand.ts
- packages/cli/src/ui/commands/profileCommand.test.ts
- packages/cli/src/runtime/profileApplication.ts
- packages/cli/src/runtime/profileApplication.test.ts
- packages/cli/src/integration-tests/loadbalancer.integration.test.ts
- packages/core/src/index.ts

VERIFY:
1. No `any` types anywhere
2. No stub implementations
3. No TODO/FIXME comments
4. All tests follow TDD pattern (behavior, not implementation)
5. No console.log (use debug logger)
6. Exports are correct
7. Error messages are descriptive

REPORT: Comprehensive compliance report. List all issues or confirm ready for PR.
```

---

## Acceptance Test Scenarios

Run these manually during development after each phase completes:

### Scenario 1: Same provider, different keys
```bash
LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile '{"type":"loadbalancer","version":1,"policy":"roundrobin","profiles":["synthetic","key2syntheticglm"]}' --prompt "write me a haiku"
```

### Scenario 2: Same model, different providers
```bash
LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile '{"type":"loadbalancer","version":1,"policy":"roundrobin","profiles":["synthetic","chutes"]}' --prompt "write me a haiku"
```

### Scenario 3: Two thinking models, same provider
```bash
LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile '{"type":"loadbalancer","version":1,"policy":"roundrobin","profiles":["syntheticm2maxstreaming","synthetick2streaming"]}' --prompt "write me a haiku"
```

### Scenario 4: Same model, thinking vs non-thinking
```bash
LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile '{"type":"loadbalancer","version":1,"policy":"roundrobin","profiles":["synthetick2","synthetick2streaming"]}' --prompt "write me a haiku"
```

### Extended test for each scenario
```bash
LLXPRT_DEBUG=llxprt:* node scripts/start.js --profile-load <lb-profile-name> --prompt "analyze this codebase and tell me what it does"
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/types/modelParams.ts` | Add types, type guards |
| `packages/core/src/types/modelParams.test.ts` | **NEW** - type guard tests |
| `packages/core/src/config/loadBalancerResolver.ts` | **NEW** - resolver class |
| `packages/core/src/config/loadBalancerResolver.test.ts` | **NEW** - resolver tests |
| `packages/core/src/config/profileManager.ts` | Add LB loading/saving |
| `packages/core/src/config/profileManager.test.ts` | Add LB tests |
| `packages/cli/src/ui/commands/profileCommand.ts` | Add `save loadbalancer` |
| `packages/cli/src/ui/commands/profileCommand.test.ts` | Add command tests |
| `packages/cli/src/runtime/profileApplication.ts` | Integrate resolver |
| `packages/cli/src/runtime/profileApplication.test.ts` | Add integration logic tests |
| `packages/cli/src/integration-tests/loadbalancer.integration.test.ts` | **NEW** - e2e test |
| `packages/core/src/index.ts` | Export new types |

---

## Success Criteria

1. All unit tests pass
2. All acceptance scenarios work manually
3. Integration test passes in CI
4. `npm run lint`, `npm run typecheck`, `npm run build` all pass
5. No `any` types
6. Round robin distributes evenly across profiles
7. All phases pass verification review
