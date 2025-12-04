# Phase 03b: Ephemeral Settings Registration

## Phase ID

`PLAN-20251202-THINKING.P03b`

## Prerequisites

- Required: Phase 03a completed (ThinkingBlock interface verified)
- Verification: `cat project-plans/20251202thinking/.completed/P03a.md`
- Expected: ThinkingBlock interface enhanced with sourceField and signature

## Purpose

Register reasoning-related ephemeral settings so they can be accessed via:
- `/set reasoning.enabled true|false`
- `/set reasoning.includeInContext true|false`
- `/set reasoning.includeInResponse true|false`
- `/set reasoning.format native|field`
- `/set reasoning.stripFromContext all|allButLast|none`
- `/set reasoning.effort minimal|low|medium|high`
- `/set reasoning.maxTokens <number>`

## Requirements Implemented (Expanded)

### REQ-THINK-006: Ephemeral Settings

**Full Text**: All reasoning.* settings must be accessible via ephemeral settings system
**Behavior**:
- GIVEN: User runs `/set reasoning.includeInContext true`
- WHEN: Settings are accessed during message building
- THEN: `ephemerals.reasoning.includeInContext()` returns `true`
**Why This Matters**: Enables user control over reasoning behavior without hardcoding model capabilities

## Implementation Tasks

### Files to Modify

#### 1. `packages/core/src/runtime/AgentRuntimeContext.ts`

**Location**: Lines ~166-170 (ephemerals interface definition)

**Add to ephemerals interface**:
```typescript
/**
 * @plan PLAN-20251202-THINKING.P03b
 * @requirement REQ-THINK-006
 */
// Reasoning settings
reasoning: {
  enabled(): boolean;
  includeInContext(): boolean;
  includeInResponse(): boolean;
  format(): 'native' | 'field';
  stripFromContext(): 'all' | 'allButLast' | 'none';
  effort(): 'minimal' | 'low' | 'medium' | 'high' | undefined;
  maxTokens(): number | undefined;
};
```

#### 2. `packages/core/src/runtime/AgentRuntimeContext.ts`

**Location**: Lines ~15-35 (ReadonlySettingsSnapshot interface)

**Add reasoning settings to ReadonlySettingsSnapshot interface**:
```typescript
export interface ReadonlySettingsSnapshot {
  /** Compression threshold for history (0.0-1.0), default 0.8 */
  compressionThreshold?: number;
  /** Context window limit in tokens (provider default when unspecified) */
  contextLimit?: number;
  /** Preserve threshold for compression (0.0-1.0), default 0.2 */
  preserveThreshold?: number;
  /** Override for tool format string, optional */
  toolFormatOverride?: string;
  /** Telemetry configuration */
  telemetry?: {
    enabled: boolean;
    target: TelemetryTarget | null;
    redaction?: TelemetryRedactionConfig;
  };
  /** Tool governance derived from profile ephemerals */
  tools?: {
    allowed?: string[];
    disabled?: string[];
  };
  // NEW: Reasoning settings
  'reasoning.enabled'?: boolean;
  'reasoning.includeInContext'?: boolean;
  'reasoning.includeInResponse'?: boolean;
  'reasoning.format'?: 'native' | 'field';
  'reasoning.stripFromContext'?: 'all' | 'allButLast' | 'none';
  'reasoning.effort'?: 'minimal' | 'low' | 'medium' | 'high';
  'reasoning.maxTokens'?: number;
}
```

**Note**: The `ReadonlySettingsSnapshot` interface is used by `createAgentRuntimeContext` to pass ephemeral settings. This is NOT a SettingsService instance - it's a plain object with property access.

**CRITICAL: Two Different Settings Contexts**:

1. **In createAgentRuntimeContext** (this file):
   - Settings passed as `options.settings` object (ReadonlySettingsSnapshot type)
   - Access via property syntax: `options.settings['reasoning.enabled']`
   - This is a plain JavaScript object with properties

2. **In OpenAIProvider** (phases P12/P14):
   - Settings accessed via SettingsService instance: `options.settings.get('reasoning.includeInContext')`
   - Access via method call: `.get('key')` with string keys
   - This is a SettingsService instance with methods

These are TWO DIFFERENT contexts. The createAgentRuntimeContext uses property access on a plain object, while providers use SettingsService.get() method calls. Do NOT confuse them.

**RESOLUTION OF GAP 2: Settings Access Pattern Compatibility**

The SettingsService `.get()` method CAN retrieve ephemeral values because:

1. When NormalizedGenerateChatOptions is created, it receives a SettingsService instance
2. SettingsService has access to the current runtime context's ephemeral settings
3. When `options.settings.get('reasoning.includeInContext')` is called, SettingsService:
   - First checks persistent settings
   - Then falls back to ephemeral settings from runtime context
   - Returns the value (or undefined if not set)

**Data Flow Verification:**
```
/set command
  → SettingsService.set('reasoning.includeInContext', true)
    → Stores in ephemeral settings for current session
      → createAgentRuntimeContext reads from options.settings['reasoning.includeInContext']
        → Exposes via runtimeContext.ephemerals.reasoning.includeInContext()
          → OpenAIProvider reads via options.settings.get('reasoning.includeInContext')
            → SettingsService.get() retrieves from ephemerals
              → Value is used in message building
```

The system works because SettingsService bridges both contexts. No additional phase needed.

#### 3. `packages/core/src/runtime/createAgentRuntimeContext.ts`

**Location**: Lines ~23-27 (EPHEMERAL_DEFAULTS)

**Add reasoning defaults**:
```typescript
const EPHEMERAL_DEFAULTS = {
  compressionThreshold: 0.8,
  contextLimit: 60_000,
  preserveThreshold: 0.2,
  // Reasoning defaults per REQ-THINK-006
  reasoning: {
    enabled: true,           // REQ-THINK-006.1
    includeInContext: false, // REQ-THINK-006.2
    includeInResponse: true, // REQ-THINK-006.3
    format: 'field' as const, // REQ-THINK-006.4
    stripFromContext: 'none' as const, // REQ-THINK-006.5
  },
} as const;
```

**Location**: Lines ~55-73 (ephemerals object)

**Add reasoning ephemeral accessors**:
```typescript
/**
 * @plan PLAN-20251202-THINKING.P03b
 * @requirement REQ-THINK-006
 */
reasoning: {
  enabled: (): boolean =>
    options.settings['reasoning.enabled'] ??
    EPHEMERAL_DEFAULTS.reasoning.enabled,
  includeInContext: (): boolean =>
    options.settings['reasoning.includeInContext'] ??
    EPHEMERAL_DEFAULTS.reasoning.includeInContext,
  includeInResponse: (): boolean =>
    options.settings['reasoning.includeInResponse'] ??
    EPHEMERAL_DEFAULTS.reasoning.includeInResponse,
  format: (): 'native' | 'field' =>
    (options.settings['reasoning.format'] as 'native' | 'field') ??
    EPHEMERAL_DEFAULTS.reasoning.format,
  stripFromContext: (): 'all' | 'allButLast' | 'none' =>
    (options.settings['reasoning.stripFromContext'] as 'all' | 'allButLast' | 'none') ??
    EPHEMERAL_DEFAULTS.reasoning.stripFromContext,
  effort: (): 'minimal' | 'low' | 'medium' | 'high' | undefined =>
    options.settings['reasoning.effort'] as 'minimal' | 'low' | 'medium' | 'high' | undefined,
  maxTokens: (): number | undefined =>
    typeof options.settings['reasoning.maxTokens'] === 'number'
      ? options.settings['reasoning.maxTokens']
      : undefined,
},
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -r "@plan.*THINKING.P03b" packages/core/src/runtime/

# Check reasoning settings in interface
grep -A 10 "reasoning:" packages/core/src/runtime/AgentRuntimeContext.ts

# Check reasoning defaults
grep -A 10 "reasoning:" packages/core/src/runtime/createAgentRuntimeContext.ts

# TypeScript compiles
npm run typecheck
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check for TODO/FIXME/HACK markers left in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/runtime/ | grep -i reasoning | grep -v ".test.ts"
# Expected: No matches (or only in comments explaining WHY, not WHAT to do)

# Check for "cop-out" comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/runtime/ | grep -i reasoning | grep -v ".test.ts"
# Expected: No matches

# Verify all 7 reasoning settings have getters
grep -A 30 "reasoning:" packages/core/src/runtime/createAgentRuntimeContext.ts | grep -c "(): "
# Expected: 7 (one for each setting)

# Verify defaults are specified
grep -A 10 "reasoning:" packages/core/src/runtime/createAgentRuntimeContext.ts | grep -E "(enabled|includeInContext|includeInResponse|format|stripFromContext)"
# Expected: All 5 default values present
```

### Semantic Verification Checklist (MANDATORY)

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read REQ-THINK-006 and verified all 7 reasoning.* settings are accessible
   - [ ] I verified reasoning.enabled default is true (REQ-THINK-006.1)
   - [ ] I verified reasoning.includeInContext default is false (REQ-THINK-006.2)
   - [ ] I verified reasoning.includeInResponse default is true (REQ-THINK-006.3)
   - [ ] I verified reasoning.format default is 'field' (REQ-THINK-006.4)
   - [ ] I verified reasoning.stripFromContext default is 'none' (REQ-THINK-006.5)

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] All 7 getters return actual values, not undefined
   - [ ] No "will be implemented" comments in getters
   - [ ] Defaults are actual values, not placeholders

3. **Would the test FAIL if implementation was removed?**
   - [ ] Test would fail if reasoning object was removed from ephemerals
   - [ ] Test would fail if any getter returned wrong default
   - [ ] Test would fail if settings couldn't be set via /set command

4. **Is the feature REACHABLE by users?**
   - [ ] Path exists from /set command to ephemeral settings storage
   - [ ] Getters accessible from runtimeContext.ephemerals.reasoning.*()
   - [ ] Settings persist for session duration
   - [ ] OpenAIProvider can access these settings when building messages

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

#### Feature Actually Works

```bash
# Manual verification: Show the reasoning ephemeral interface
grep -A 10 "reasoning:" packages/core/src/runtime/AgentRuntimeContext.ts | head -15
# Expected: All 7 methods with correct return types

# Verify defaults
grep -A 10 "EPHEMERAL_DEFAULTS" packages/core/src/runtime/createAgentRuntimeContext.ts | grep -A 8 "reasoning:"
# Expected: All 5 defaults with correct values
```

#### GAP 3 RESOLUTION: Data Flow Verification from /set Command

**Verification Tasks:**

1. **Verify /set command can store reasoning settings:**
   ```bash
   # Check that SettingsService.set() method exists and can handle reasoning.* keys
   grep -n "set(" packages/core/src/services/settings/SettingsService.ts | head -5
   # Expected: Method definition for set(key: string, value: unknown)
   ```

2. **Verify settings flow to createAgentRuntimeContext:**
   ```bash
   # Check that createAgentRuntimeContext receives settings parameter
   grep -A 5 "export function createAgentRuntimeContext" packages/core/src/runtime/createAgentRuntimeContext.ts
   # Expected: Function signature with options parameter containing settings
   ```

3. **Verify ephemeral accessors can read from settings:**
   ```bash
   # Check that ephemeral getters read from options.settings
   grep -A 3 "reasoning: {" packages/core/src/runtime/createAgentRuntimeContext.ts | grep "options.settings"
   # Expected: Each getter accesses options.settings['reasoning.*']
   ```

4. **Integration test simulation (manual):**
   ```typescript
   // Pseudo-test to verify flow (add to integration tests if needed)
   // 1. Call settingsService.set('reasoning.includeInContext', true)
   // 2. Create runtime context with settings
   // 3. Verify runtimeContext.ephemerals.reasoning.includeInContext() returns true
   // 4. Verify options.settings.get('reasoning.includeInContext') also returns true
   ```

These verification tasks ensure the complete data flow from `/set` command through to provider access.

#### Integration Points Verified

- [ ] Settings interface in AgentRuntimeContextSettings has all reasoning.* keys
- [ ] Ephemerals interface has reasoning sub-object with all getters
- [ ] createAgentRuntimeContext implements all getters correctly
- [ ] Getters fall back to defaults when setting not explicitly set
- [ ] No breaking changes to existing ephemeral settings

### Structural Verification Checklist

- [ ] ReadonlySettingsSnapshot interface has reasoning.* properties (lines ~15-35 in AgentRuntimeContext.ts)
- [ ] AgentRuntimeContext.ephemerals interface has reasoning sub-object (lines ~166-170 in AgentRuntimeContext.ts)
- [ ] createAgentRuntimeContext has EPHEMERAL_DEFAULTS.reasoning (lines ~23-27 in createAgentRuntimeContext.ts)
- [ ] All 7 reasoning settings have getters in ephemerals object (lines ~55-73 in createAgentRuntimeContext.ts)
- [ ] Defaults match specification (enabled=true, includeInContext=false, etc.)
- [ ] TypeScript compiles without errors

## Success Criteria

- All reasoning.* settings accessible via ephemerals
- Default values match REQ-THINK-006
- Existing code continues to work (backward compatible)
- TypeScript compiles

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/runtime/`
2. Review existing ephemerals pattern
3. Re-attempt with corrected approach

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P03b.md`
