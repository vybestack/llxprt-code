# Phase 18: auth-key-name + --key-name Implementation

## Phase ID

`PLAN-20260211-SECURESTORE.P18`

## Prerequisites

- Required: Phase 17a completed
- Verification: `ls .completed/P17a.md`
- Expected files:
  - `packages/cli/src/config/profileBootstrap.ts` (stub from P16)
  - `packages/cli/src/config/config.ts` (stub from P16)
  - `packages/cli/src/runtime/runtimeSettings.ts` (stub from P16)
  - Test files from P17

## Requirements Implemented (Expanded)

### R21: auth-key-name Profile Field

#### R21.1 — Event-Driven
**Full Text**: When a profile containing `auth-key-name` is loaded, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()` and use it as the provider API key for the session.
**Behavior**:
- GIVEN: A profile with `"auth-key-name": "myanthropic"` and key `myanthropic` stored in keyring
- WHEN: Profile is loaded and `applyCliArgumentOverrides()` runs
- THEN: The named key is resolved via `ProviderKeyStorage.getKey('myanthropic')` and set as the session API key
**Why This Matters**: Core feature — profiles can reference named keys instead of embedding raw keys.

#### R21.2 — Ubiquitous
**Full Text**: `auth-key-name` shall be recognized as a valid ephemeral setting in profile definitions.
**Behavior**:
- GIVEN: A profile JSON containing `"auth-key-name": "mykey"`
- WHEN: Profile validation runs
- THEN: `auth-key-name` is accepted as a valid ephemeral setting (not rejected as unknown)
**Why This Matters**: Without this, profiles with `auth-key-name` would fail validation.

#### R21.3 — Ubiquitous
**Full Text**: Profile bootstrap shall parse `auth-key-name` from profile JSON and pass it through as metadata. It shall not resolve the named key — resolution happens in `runtimeSettings.ts` `applyCliArgumentOverrides()`.
**Behavior**:
- GIVEN: Profile bootstrap encounters `auth-key-name` in profile JSON
- WHEN: Bootstrap parsing runs
- THEN: The value is passed through as metadata; NO keyring lookup happens in bootstrap
**Why This Matters**: Separation of concerns — bootstrap is parsing only, runtime does resolution.

### R22: --key-name CLI Flag

#### R22.1 — Event-Driven
**Full Text**: When `--key-name <name>` is provided on the CLI, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()` and use it as the provider API key for the session.
**Behavior**:
- GIVEN: CLI invoked with `--key-name myanthropic` and key `myanthropic` stored in keyring
- WHEN: Bootstrap parses args and `applyCliArgumentOverrides()` runs
- THEN: `keyNameOverride` is set and resolved to the stored API key
**Why This Matters**: CLI-level named key support — users can reference saved keys by name.

#### R22.2 — Ubiquitous
**Full Text**: `--key-name` shall be parsed by the bootstrap argument parser alongside `--key` and `--keyfile`, and stored in `BootstrapProfileArgs` as `keyNameOverride`.
**Behavior**:
- GIVEN: CLI args include `--key-name mykey`
- WHEN: Bootstrap argument parser runs
- THEN: `BootstrapProfileArgs.keyNameOverride` is set to `'mykey'`
**Why This Matters**: Integrates with existing argument parsing infrastructure.

### R23: API Key Precedence

#### R23.1 — Ubiquitous
**Full Text**: The system shall determine the API key for a session using this precedence order (highest first): 1. `--key` (CLI flag, raw key), 2. `--key-name` (CLI flag, named key from keyring), 3. `auth-key-name` (profile field, named key from keyring), 4. `auth-keyfile` (profile field, read from file), 5. `auth-key` (profile field, inline in profile JSON), 6. Environment variables (`GEMINI_API_KEY`, etc.)
**Behavior**:
- GIVEN: Multiple auth sources configured at different precedence levels
- WHEN: `applyCliArgumentOverrides()` resolves the API key
- THEN: The highest-precedence source wins
**Why This Matters**: Defines the authoritative precedence chain — the most critical contract for multi-source auth.

#### R23.2 — Event-Driven
**Full Text**: When both `--key` and `--key-name` are specified on the CLI, `--key` shall win (explicit raw key beats named key lookup).
**Behavior**:
- GIVEN: CLI invoked with `--key raw-sk-abc --key-name mykey`
- WHEN: Precedence resolution runs
- THEN: `raw-sk-abc` is used (--key wins); `--key-name` is ignored with debug log
**Why This Matters**: Explicit raw key is the most direct specification — it must always win.

#### R23.3 — Ubiquitous
**Full Text**: All precedence resolution shall happen in `runtimeSettings.ts` `applyCliArgumentOverrides()`. Profile bootstrap passes metadata only and does not resolve named keys.
**Behavior**:
- GIVEN: Any combination of auth sources
- WHEN: Resolution occurs
- THEN: All resolution logic is in `applyCliArgumentOverrides()`, nowhere else
**Why This Matters**: Single authoritative resolution stage prevents inconsistencies and bugs from duplicated logic.

### R24: Named Key — Error Handling

#### R24.1 — Unwanted Behavior
**Full Text**: If `auth-key-name` or `--key-name` references a named key that does not exist in the keyring, the system shall fail with an actionable error: `Named key '<name>' not found. Use '/key save <name> <key>' to store it.` It shall NOT silently fall through to lower-precedence auth sources.
**Behavior**:
- GIVEN: `--key-name notexist` and key `notexist` is not stored
- WHEN: Resolution runs
- THEN: Throws error: `Named key 'notexist' not found. Use '/key save notexist <key>' to store it.` — does NOT try auth-keyfile, auth-key, or env vars
**Why This Matters**: Silent fallthrough would mask configuration errors — users must know their named key reference is broken.

#### R24.2 — State-Driven
**Full Text**: While the session is non-interactive and a named key is not found, the system shall fail fast with an exit code and the same error message.
**Behavior**:
- GIVEN: Non-interactive session with `--key-name notexist`
- WHEN: Named key resolution fails
- THEN: Process exits with code 1 and error message to stderr
**Why This Matters**: CI/scripted environments need fast, clear failure signals.

### R25: Named Key — Startup Diagnostics

#### R25.1 — State-Driven
**Full Text**: While debug mode is enabled, the system shall emit a log line identifying the selected auth source by type (without the key value): `[auth] Using API key from: --key-name '<name>' (keyring)`, `[auth] Using API key from: profile '<profile>' auth-keyfile '<path>'`, `[auth] Using API key from: environment variable GEMINI_API_KEY`.
**Behavior**:
- GIVEN: Debug mode enabled and `--key-name mykey` used
- WHEN: Resolution runs successfully
- THEN: Log line: `[auth] Using API key from: --key-name 'mykey' (keyring)`
**Why This Matters**: Users debugging auth issues need to know which source was selected.

#### R25.2 — State-Driven
**Full Text**: While debug mode is enabled and a lower-precedence auth source is present but overridden, the system shall log at debug level: `[auth] Ignoring profile auth-key (overridden by --key-name)`.
**Behavior**:
- GIVEN: Debug mode enabled, `--key-name mykey` and profile `auth-key` both set
- WHEN: Resolution runs
- THEN: Log line: `[auth] Ignoring profile auth-key (overridden by --key-name)`
**Why This Matters**: Users need to see which sources were intentionally skipped.

### R26: No Deprecations

#### R26.1 — Ubiquitous
**Full Text**: `--key`, `--keyfile`, `auth-key`, and `auth-keyfile` shall remain fully supported and unchanged in behavior. The new `--key-name` and `auth-key-name` options are purely additive.
**Behavior**:
- GIVEN: Existing CLI invocations using `--key`, `--keyfile`, `auth-key`, or `auth-keyfile`
- WHEN: The auth-key-name feature is deployed
- THEN: All existing auth mechanisms work identically to before
**Why This Matters**: Zero regressions — existing users must not be broken by new features.

### R27.3: Precedence Test Matrix

#### R27.3 — Ubiquitous
**Full Text**: The API key precedence resolution shall have a test matrix covering every combination of auth sources: CLI flags only (`--key`, `--key-name`), profile fields only (`auth-key-name`, `auth-keyfile`, `auth-key`), environment variables only, and combinations of multiple sources at different precedence levels (per #1356 acceptance criteria).
**Behavior**:
- GIVEN: A test matrix of auth source combinations
- WHEN: Each combination is run through `applyCliArgumentOverrides()`
- THEN: The correct winner is determined per R23.1 precedence order for every combination
**Why This Matters**: Explicit acceptance criterion from #1356 — ensures no precedence edge cases are missed.

## Implementation Tasks

### MANDATORY: Follow Pseudocode Line-by-Line

From `analysis/pseudocode/auth-key-name.md`:

#### Bootstrap Arg Parsing (pseudocode lines 1–24)
- Lines 3–9: `--key-name` case in switch statement
- Lines 11–16: Validate value present
- Lines 18–24: Store in `keyNameOverride`

#### Profile Field Recognition (pseudocode lines 26–40)
- Lines 28–34: `auth-key-name` in ephemeral settings
- Lines 36–40: Synthetic profile creation with `keyNameOverride`

#### API Key Precedence Resolution (pseudocode lines 42–82)
- Lines 44–52: Check `--key` first (highest precedence)
- Lines 54–62: Check `--key-name` / `keyNameOverride`
- Lines 64–68: Check `auth-key-name` from profile ephemeral settings
- Lines 70–74: Check `auth-keyfile`
- Lines 76–78: Check `auth-key`
- Lines 80–82: Fall through to env vars

#### Named Key Resolution (pseudocode lines 84–108)
- Lines 86–92: Call `ProviderKeyStorage.getKey(name)`
- Lines 94–100: Key not found → throw with actionable message
- Lines 102–108: Key found → call `updateActiveProviderApiKey(resolvedKey)`

#### Startup Diagnostics (pseudocode lines 110–128)
- Lines 112–120: Debug log for selected auth source
- Lines 122–128: Debug log for overridden sources

#### Non-Interactive Failure (pseudocode lines 130–140)
- Lines 132–136: Detect non-interactive mode
- Lines 138–140: Fast fail with exit code

### Files to Modify

#### 1. `packages/cli/src/config/profileBootstrap.ts`
- COMPLETE the `--key-name` parsing (from stub to working)
- Lines ~222–232: full implementation of case
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P18`
- MUST include: `@pseudocode lines 1-24`

#### 2. `packages/cli/src/config/config.ts`
- COMPLETE `auth-key-name` ephemeral setting handling
- COMPLETE synthetic profile creation with `keyNameOverride`
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P18`
- MUST include: `@pseudocode lines 26-40`

#### 3. `packages/cli/src/runtime/runtimeSettings.ts`
- COMPLETE `applyCliArgumentOverrides()` with full precedence resolution
- Import `ProviderKeyStorage` / `getProviderKeyStorage`
- Add named key resolution: `getKey(name)` → `updateActiveProviderApiKey()`
- Add error handling for key not found
- Add debug logging for auth source selection
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P18`
- MUST include: `@pseudocode lines 42-140`

### Key Design Decisions

1. **Resolution in one place**: `applyCliArgumentOverrides()` is the ONLY place named keys are resolved. Profile bootstrap passes metadata only.
2. **Precedence order**: `--key` → `--key-name` → `auth-key-name` → `auth-keyfile` → `auth-key` → env vars
3. **No silent fallthrough**: If `--key-name` or `auth-key-name` is set but key not found, error immediately (R24.1). Do NOT try lower-precedence sources.
4. **Debug logging**: Use existing debug infrastructure. Log auth source type, not key value.

### Implementation Adaptation Notes

**ISSUE-1: `applyCliArgumentOverrides()` Signature Adaptation**

The pseudocode (auth-key-name.md lines 40–44) defines `applyCliArgumentOverrides(runtime, bootstrapArgs, profile)`. The actual function in `runtimeSettings.ts` (lines ~2289–2302) has a different signature: `applyCliArgumentOverrides(argv, bootstrapArgs?)` where `argv` has `{ key?, keyfile?, set?, baseurl? }` and `bootstrapArgs` has `{ keyOverride?, keyfileOverride?, ... }`. The implementer MUST:
- Add `keyNameOverride` to the existing `bootstrapArgs` parameter type (not introduce a new `profile` parameter)
- Read `auth-key-name` from `config.getEphemeralSetting('auth-key-name')` or the equivalent config service call, NOT from a `profile` parameter
- Insert `--key-name` resolution between the existing `--key` (step 1) and `--keyfile` (step 2) in the function body

**ISSUE-2: Ephemeral Settings Variable Name**

The plan references `VALID_EPHEMERAL_SETTINGS` at `config.ts:1710-1721`. The actual variable in the codebase is named `ephemeralKeys` (a local array, not a module-level constant). The implementer MUST add `'auth-key-name'` to the `ephemeralKeys` array at that location, and verify that any separate validation list is also updated. Use the actual variable name found in the code, not the name referenced here.

## Verification Commands

```bash
# 1. All auth/precedence tests pass
npm test -- runtimeSettings 2>&1 | tail -20

# 2. All profile bootstrap tests pass  
npm test -- profileBootstrap 2>&1 | tail -20

# 3. No test modifications
git diff packages/cli/src/runtime/runtimeSettings.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}"

# 4. Plan markers
grep -c "@plan.*SECURESTORE.P18" packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts

# 5. Pseudocode references
grep -c "@pseudocode" packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts

# 6. TypeScript compiles
npm run typecheck

# 7. Full test suite
npm test

# 8. Lint
npm run lint

# 9. Deferred implementation detection
for f in packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts; do
  grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" "$f"
  grep -rn -E "(in a real|in production|ideally|for now|placeholder)" "$f"
done

# 10. ProviderKeyStorage imported in runtimeSettings
grep "ProviderKeyStorage\|getProviderKeyStorage" packages/cli/src/runtime/runtimeSettings.ts

# 11. Build succeeds
npm run build
```

## Structural Verification Checklist

- [ ] All P17 tests pass
- [ ] Tests not modified
- [ ] Plan markers present in all three files
- [ ] Pseudocode references present
- [ ] TypeScript compiles
- [ ] No deferred implementation patterns
- [ ] ProviderKeyStorage imported in runtimeSettings
- [ ] Build succeeds

## Semantic Verification Checklist (MANDATORY)

1. **Does --key-name parsing work?**
   - [ ] `--key-name mykey` stores `keyNameOverride = 'mykey'`
   - [ ] Missing value → error

2. **Does auth-key-name work in profiles?**
   - [ ] Recognized as valid ephemeral setting
   - [ ] Passed through synthetic profile

3. **Does precedence resolution work?**
   - [ ] `--key` beats everything
   - [ ] `--key-name` beats `auth-key-name`, `auth-keyfile`, `auth-key`, env
   - [ ] `auth-key-name` beats `auth-keyfile`, `auth-key`, env
   - [ ] All resolved in `applyCliArgumentOverrides()`, nowhere else

4. **Does error handling work?**
   - [ ] Named key not found → specific error with `/key save` hint
   - [ ] No silent fallthrough to lower-precedence sources

5. **Do diagnostics work?**
   - [ ] Debug log shows auth source type
   - [ ] Debug log shows overridden sources
   - [ ] Key values NEVER logged

6. **No regressions?**
   - [ ] `--key`, `--keyfile`, `auth-key`, `auth-keyfile` all still work

## Holistic Functionality Assessment

### What was implemented?
[Describe the full auth resolution pipeline]

### Does it satisfy R21-R27?
[Explain precedence, error handling, diagnostics]

### Data flow
[Trace: `--key-name mykey` → bootstrap parse → profile metadata → applyCliArgumentOverrides → ProviderKeyStorage.getKey → updateActiveProviderApiKey]

### What could go wrong?
[Edge cases, async issues, race conditions]

### Verdict
[PASS/FAIL]

## Failure Recovery

1. `git checkout -- packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts`
2. Re-run Phase 18

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P18.md`
